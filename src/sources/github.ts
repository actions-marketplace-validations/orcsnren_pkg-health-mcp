import { getJson, postJson } from "../http.js";
import type { GitHubFacts } from "../types.js";

const API = "https://api.github.com";
const COMMIT_PAGE = 100;
const MAX_COMMIT_PAGES = 5;
/** The maintainer score saturates at 10 committers, so stop paging once we have seen that many. */
const ENOUGH_AUTHORS = 10;
const BOT = /\[bot\]$|^dependabot|^renovate|github-actions/i;

function token(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const t = token();
  if (t) h.authorization = `Bearer ${t}`;
  return h;
}

export class GitHubRateLimitError extends Error {}

export interface FetchGitHubOptions {
  /** Also read the latest GitHub release (used when the repository itself is the target). */
  releases?: boolean;
}

export async function fetchGitHub(
  owner: string,
  repo: string,
  opts: FetchGitHubOptions = {},
): Promise<GitHubFacts | null> {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repoRes = await getJson<any>(base, headers());
  if (repoRes.status === 404) return null;
  if (isRateLimited(repoRes.status, repoRes.headers)) throw new GitHubRateLimitError();
  if (!repoRes.ok || !repoRes.data) return null;
  const r = repoRes.data;

  // Follow renames/transfers: the API returns the canonical name.
  const canonical = r.full_name ? `${API}/repos/${r.full_name}` : base;
  const [canonOwner, canonRepo] = r.full_name ? String(r.full_name).split("/") : [owner, repo];
  // Rounded to the day so the URLs, and therefore the cache keys, stay stable across runs.
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10) + "T00:00:00Z";

  const [commits, issuesRes, release, responses] = await Promise.all([
    fetchCommits(canonical, since),
    getJson<any[]>(
      `${canonical}/issues?state=closed&sort=updated&direction=desc&per_page=100&since=${since}`,
      headers(),
    ),
    opts.releases ? getJson<any>(`${canonical}/releases/latest`, headers()) : Promise.resolve(null),
    fetchFirstResponses(canonOwner, canonRepo),
  ]);

  const facts: GitHubFacts = {
    owner: r.owner?.login ?? owner,
    repo: r.name ?? repo,
    archived: Boolean(r.archived),
    stars: r.stargazers_count,
    openIssues: r.open_issues_count,
    license: githubLicense(r.license),
  };

  if (commits) {
    Object.assign(facts, summarizeCommits(commits.items));
    if (commits.capped) facts.contributorsSampleCapped = true;
  }
  if (facts.lastCommitAt === undefined && r.pushed_at && commits) {
    // No commits in the last year on the default branch.
    facts.activeContributors12m = 0;
  }
  if (Array.isArray(issuesRes.data)) {
    Object.assign(facts, summarizeIssues(issuesRes.data, since));
  }
  if (release?.ok && release.data?.published_at) {
    facts.latestRelease = { tag: release.data.tag_name, publishedAt: release.data.published_at };
  }
  if (responses) Object.assign(facts, responses);
  return facts;
}

/**
 * Page through the last year of commits until we have enough distinct authors to saturate
 * the maintainer score, run out of commits, or hit MAX_COMMIT_PAGES.
 */
async function fetchCommits(
  canonical: string,
  since: string,
): Promise<{ items: any[]; capped: boolean } | null> {
  const items: any[] = [];
  for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
    const res = await getJson<any[]>(
      `${canonical}/commits?per_page=${COMMIT_PAGE}&since=${since}&page=${page}`,
      headers(),
    );
    if (!Array.isArray(res.data)) return page === 1 ? null : { items, capped: true };
    items.push(...res.data);
    if (res.data.length < COMMIT_PAGE) return { items, capped: false };
    if ((summarizeCommits(items).activeContributors12m ?? 0) >= ENOUGH_AUTHORS) {
      return { items, capped: false };
    }
  }
  return { items, capped: true };
}

export function summarizeCommits(commits: any[]): Partial<GitHubFacts> {
  if (!commits.length) return { activeContributors12m: 0 };
  const authors = new Set<string>();
  for (const c of commits) {
    const id = c.author?.login ?? c.commit?.author?.email ?? c.commit?.author?.name;
    if (id && !BOT.test(String(id))) authors.add(id);
  }
  return {
    lastCommitAt: commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date,
    activeContributors12m: authors.size,
  };
}

export function summarizeIssues(items: any[], sinceIso: string): Partial<GitHubFacts> {
  const durations = items
    .filter((i) => !i.pull_request && i.closed_at && i.closed_at >= sinceIso)
    .filter((i) => i.state_reason !== "not_planned" || i.comments > 0)
    .map((i) => (Date.parse(i.closed_at) - Date.parse(i.created_at)) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0);
  if (!durations.length) return { closedIssuesSampled: 0 };
  return { medianIssueCloseDays: round1(median(durations)), closedIssuesSampled: durations.length };
}

const FIRST_RESPONSE_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 60, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        createdAt
        closedAt
        authorAssociation
        author { login }
        comments(first: 10) {
          nodes { createdAt authorAssociation author { __typename login } }
        }
      }
    }
  }
}`;

/** Time to first maintainer response via GraphQL. GraphQL always needs a token, so this is skipped without one. */
async function fetchFirstResponses(owner: string, name: string): Promise<Partial<GitHubFacts> | null> {
  if (!token()) return null;
  const res = await postJson<any>(
    `${API}/graphql`,
    { query: FIRST_RESPONSE_QUERY, variables: { owner, name } },
    headers(),
  );
  const nodes = res.data?.data?.repository?.issues?.nodes;
  if (!res.ok || res.data?.errors || !Array.isArray(nodes)) return null;
  return summarizeFirstResponses(nodes);
}

const MAINTAINER_ROLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
/** Issues younger than this are too fresh to judge and are left out. */
const MIN_ISSUE_AGE_DAYS = 7;

export function summarizeFirstResponses(issues: any[], now = Date.now()): Partial<GitHubFacts> {
  const yearAgo = now - 365 * 86_400_000;
  const waits: number[] = [];
  let answered = 0;
  for (const issue of issues) {
    const created = Date.parse(issue.createdAt);
    if (!Number.isFinite(created) || created < yearAgo) continue;
    if ((now - created) / 86_400_000 < MIN_ISSUE_AGE_DAYS) continue;
    // Maintainers' own tracking issues are not requests waiting for an answer.
    if (MAINTAINER_ROLES.has(issue.authorAssociation)) continue;
    const opener = issue.author?.login;
    const reply = (issue.comments?.nodes ?? []).find(
      (c: any) =>
        MAINTAINER_ROLES.has(c.authorAssociation) &&
        c.author?.__typename !== "Bot" &&
        !BOT.test(String(c.author?.login ?? "")) &&
        c.author?.login !== opener,
    );
    const times = [reply?.createdAt, issue.closedAt].map((t) => Date.parse(t)).filter(Number.isFinite);
    if (times.length) {
      answered++;
      waits.push(Math.max(0, Math.min(...times) - created) / 86_400_000);
    } else {
      // Still waiting: count its age so far, which is a lower bound on the real wait.
      waits.push((now - created) / 86_400_000);
    }
  }
  if (!waits.length) return { responseIssuesSampled: 0 };
  return {
    medianFirstResponseDays: round1(median(waits)),
    responseIssuesSampled: waits.length,
    responseRate: Math.round((answered / waits.length) * 100) / 100,
  };
}

function githubLicense(l: any): string | undefined {
  const id = l?.spdx_id;
  if (typeof id === "string" && id && id !== "NOASSERTION") return id;
  return undefined;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isRateLimited(status: number, h: Headers | null): boolean {
  return (status === 403 || status === 429) && h?.get("x-ratelimit-remaining") === "0";
}
