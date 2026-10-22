import { getJson } from "../http.js";
import type { GitHubFacts } from "../types.js";

const API = "https://api.github.com";

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

export class GitHubRateLimitError extends Error {}

export async function fetchGitHub(owner: string, repo: string): Promise<GitHubFacts | null> {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repoRes = await getJson<any>(base, headers());
  if (repoRes.status === 404) return null;
  if (isRateLimited(repoRes.status, repoRes.headers)) throw new GitHubRateLimitError();
  if (!repoRes.ok || !repoRes.data) return null;
  const r = repoRes.data;

  // Follow renames/transfers: the API returns the canonical name.
  const canonical = r.full_name ? `${API}/repos/${r.full_name}` : base;
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();

  const [commitsRes, issuesRes] = await Promise.all([
    getJson<any[]>(`${canonical}/commits?per_page=100&since=${since}`, headers()),
    getJson<any[]>(
      `${canonical}/issues?state=closed&sort=updated&direction=desc&per_page=100&since=${since}`,
      headers(),
    ),
  ]);

  const facts: GitHubFacts = {
    owner: r.owner?.login ?? owner,
    repo: r.name ?? repo,
    archived: Boolean(r.archived),
    stars: r.stargazers_count,
    openIssues: r.open_issues_count,
  };

  if (Array.isArray(commitsRes.data)) {
    Object.assign(facts, summarizeCommits(commitsRes.data));
  }
  if (facts.lastCommitAt === undefined && r.pushed_at && commitsRes.ok) {
    // No commits in the last year on the default branch.
    facts.activeContributors12m = 0;
  }
  if (Array.isArray(issuesRes.data)) {
    Object.assign(facts, summarizeIssues(issuesRes.data, since));
  }
  return facts;
}

export function summarizeCommits(commits: any[]): Partial<GitHubFacts> {
  if (!commits.length) return { activeContributors12m: 0 };
  const authors = new Set<string>();
  for (const c of commits) {
    const id = c.author?.login ?? c.commit?.author?.email ?? c.commit?.author?.name;
    if (id && !/\[bot\]$|^dependabot|^renovate|github-actions/i.test(String(id))) authors.add(id);
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
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  if (!durations.length) return { closedIssuesSampled: 0 };
  const mid = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
  return { medianIssueCloseDays: Math.round(median * 10) / 10, closedIssuesSampled: durations.length };
}

function isRateLimited(status: number, h: Headers | null): boolean {
  return (status === 403 || status === 429) && h?.get("x-ratelimit-remaining") === "0";
}
