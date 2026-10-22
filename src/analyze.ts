import { mapLimit } from "./http.js";
import { buildReport } from "./score.js";
import { fetchGitHub, GitHubRateLimitError } from "./sources/github.js";
import { fetchNpm, fetchNpmDownloads } from "./sources/npm.js";
import { fetchPypi, fetchPypiDownloads } from "./sources/pypi.js";
import { parseGitHubRepo } from "./sources/repo-url.js";
import { fetchScorecard } from "./sources/scorecard.js";
import type { Ecosystem, HealthReport, PackageFacts } from "./types.js";

export async function gatherFacts(name: string, ecosystem: Ecosystem): Promise<PackageFacts> {
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
    const [gh, sc] = await Promise.all([
      fetchGitHub(repoRef.owner, repoRef.repo).catch((err) => {
        if (err instanceof GitHubRateLimitError) {
          facts.warnings.push(
            "GitHub API rate limit reached; set GITHUB_TOKEN for 5,000 requests/hour",
          );
        } else {
          facts.warnings.push("GitHub lookup failed");
        }
        return null;
      }),
      fetchScorecard(repoRef.owner, repoRef.repo).catch(() => undefined),
    ]);
    if (gh) {
      facts.github = gh;
      facts.repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
    } else if (!facts.warnings.some((w) => w.startsWith("GitHub"))) {
      facts.warnings.push("GitHub repository could not be read");
    }
    facts.scorecard = sc;
  }
  return facts;
}

export async function analyzePackage(name: string, ecosystem: Ecosystem): Promise<HealthReport> {
  return buildReport(await gatherFacts(name.trim(), ecosystem));
}

export async function analyzeMany(
  packages: Array<{ name: string; ecosystem: Ecosystem }>,
  concurrency = 4,
): Promise<HealthReport[]> {
  return mapLimit(packages, concurrency, (p) => analyzePackage(p.name, p.ecosystem));
}
