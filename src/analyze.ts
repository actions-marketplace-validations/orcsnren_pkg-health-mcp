import { mapLimit } from "./http.js";
import { buildReport } from "./score.js";
import { type FetchGitHubOptions, fetchGitHub, GitHubRateLimitError } from "./sources/github.js";
import { fetchNpm, fetchNpmDownloads } from "./sources/npm.js";
import { fetchPypi, fetchPypiDownloads } from "./sources/pypi.js";
import { parseGitHubRepo } from "./sources/repo-url.js";
import { fetchScorecard } from "./sources/scorecard.js";
import type { Ecosystem, GitHubFacts, HealthReport, PackageFacts } from "./types.js";

/**
 * A GitHub URL or "owner/repo" is a repository, whatever registry was asked for:
 * npm names only contain "/" when scoped ("@scope/name") and PyPI names never do.
 */
export function resolveTarget(name: string, ecosystem: Ecosystem): { name: string; ecosystem: Ecosystem } {
  const trimmed = name.trim();
  const ref = parseGitHubRepo(trimmed);
  if (ref && (ecosystem === "github" || !trimmed.startsWith("@"))) {
    return { name: `${ref.owner}/${ref.repo}`, ecosystem: "github" };
  }
  return { name: trimmed, ecosystem };
}

export async function gatherFacts(name: string, ecosystem: Ecosystem): Promise<PackageFacts> {
  if (ecosystem === "github") return gatherRepoFacts(name);
  const facts: PackageFacts = { name, ecosystem, found: false, warnings: [] };
  let repoRef: { owner: string; repo: string } | null = null;

  try {
    if (ecosystem === "npm") {
      const [info, downloads] = await Promise.all([fetchNpm(name), fetchNpmDownloads(name)]);
      if (!info.found) return facts;
      Object.assign(facts, {
        found: true,
        latestVersion: info.latestVersion,
        latestReleaseAt: info.latestReleaseAt,
        deprecated: info.deprecated,
        deprecationMessage: info.deprecationMessage,
        license: info.license,
        registryMaintainers: info.maintainers,
        downloads,
      });
      repoRef = parseGitHubRepo(info.repository);
    } else {
      const [info, downloads] = await Promise.all([fetchPypi(name), fetchPypiDownloads(name)]);
      if (!info.found) return facts;
      Object.assign(facts, {
        found: true,
        latestVersion: info.latestVersion,
        latestReleaseAt: info.latestReleaseAt,
        deprecated: info.deprecated,
        deprecationMessage: info.deprecationMessage,
        license: info.license,
        downloads,
      });
      for (const url of info.repoCandidates) {
        repoRef = parseGitHubRepo(url);
        if (repoRef) break;
      }
    }
  } catch (err) {
    facts.warnings.push(`Registry lookup failed: ${(err as Error).message}`);
    return facts;
  }

  if (!facts.downloads) facts.warnings.push("Download statistics unavailable");

  if (repoRef) {
    facts.repoUrl = `https://github.com/${repoRef.owner}/${repoRef.repo}`;
    const { gh, scorecard } = await fetchRepo(repoRef.owner, repoRef.repo, facts.warnings);
    if (gh) {
      facts.github = gh;
      facts.repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    } else if (!facts.warnings.some((w) => w.startsWith("GitHub"))) {
      facts.warnings.push("GitHub repository could not be read");
    }
    facts.scorecard = scorecard;
  }
  return facts;
}

/** Score a GitHub repository directly, without a registry: releases, license and activity all come from GitHub. */
async function gatherRepoFacts(name: string): Promise<PackageFacts> {
  const facts: PackageFacts = { name, ecosystem: "github", found: false, warnings: [] };
  const ref = parseGitHubRepo(name);
  if (!ref) {
    facts.warnings.push(`"${name}" is not a GitHub repository (expected owner/repo or a github.com URL)`);
    return facts;
  }
  const { gh, scorecard } = await fetchRepo(ref.owner, ref.repo, facts.warnings, { releases: true });
  if (!gh) return facts;
  Object.assign(facts, {
    name: `${gh.owner}/${gh.repo}`,
    found: true,
    latestVersion: gh.latestRelease?.tag.replace(/^v(?=\d)/, ""),
    latestReleaseAt: gh.latestRelease?.publishedAt,
    license: gh.license,
    repoUrl: `https://github.com/${gh.owner}/${gh.repo}`,
    github: gh,
    scorecard,
  });
  return facts;
}

async function fetchRepo(
  owner: string,
  repo: string,
  warnings: string[],
  opts: FetchGitHubOptions = {},
): Promise<{ gh: GitHubFacts | null; scorecard?: number }> {
  const [gh, scorecard] = await Promise.all([
    fetchGitHub(owner, repo, opts).catch((err) => {
      warnings.push(
        err instanceof GitHubRateLimitError
          ? "GitHub API rate limit reached; set GITHUB_TOKEN for 5,000 requests/hour"
          : "GitHub lookup failed",
      );
      return null;
    }),
    fetchScorecard(owner, repo).catch(() => undefined),
  ]);
  return { gh, scorecard };
}

export async function analyzePackage(name: string, ecosystem: Ecosystem): Promise<HealthReport> {
  const target = resolveTarget(name, ecosystem);
  return buildReport(await gatherFacts(target.name, target.ecosystem));
}

export async function analyzeMany(
  packages: Array<{ name: string; ecosystem: Ecosystem }>,
  concurrency = 4,
): Promise<HealthReport[]> {
  return mapLimit(packages, concurrency, (p) => analyzePackage(p.name, p.ecosystem));
}
