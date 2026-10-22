export type Ecosystem = "npm" | "pypi" | "github";

/** Raw facts gathered from registries and GitHub. Any field may be missing. */
export interface PackageFacts {
  name: string;
  ecosystem: Ecosystem;
  found: boolean;
  latestVersion?: string;
  latestReleaseAt?: string; // ISO date
  deprecated?: boolean;
  deprecationMessage?: string;
  license?: string;
  registryMaintainers?: number;
  repoUrl?: string;
  github?: GitHubFacts;
  downloads?: DownloadFacts;
  scorecard?: number; // OpenSSF Scorecard, 0-10
  warnings: string[];
}

export interface GitHubFacts {
  owner: string;
  repo: string;
  archived: boolean;
  stars?: number;
  openIssues?: number;
  lastCommitAt?: string;
  /** SPDX id from GitHub's license detection, if any. */
  license?: string;
  /** Latest GitHub release (only fetched when the repository itself is the target). */
  latestRelease?: { tag: string; publishedAt: string };
  /** Unique human commit authors in the last 12 months (sampled from up to 500 commits). */
  activeContributors12m?: number;
  /** True when the commit sample hit its page limit, so the author count is a lower bound. */
  contributorsSampleCapped?: boolean;
  /** Median days from open to close, for issues closed in the last 12 months. */
  medianIssueCloseDays?: number;
  closedIssuesSampled?: number;
  /**
   * Median days until a maintainer first replied to (or closed) an issue, over recent issues.
   * Issues still waiting count with their current age. Needs GITHUB_TOKEN (GraphQL).
   */
  medianFirstResponseDays?: number;
  responseIssuesSampled?: number;
  /** Share of sampled issues that got a maintainer reply or were closed (0-1). */
  responseRate?: number;
}

export interface DownloadFacts {
  /** Downloads in the most recent 90 days. */
  recent: number;
  /** Downloads in the 90 days before that. */
  previous: number;
}

export interface SubScore {
  key: "activity" | "maintainers" | "issues" | "downloads" | "scorecard" | "license";
  label: string;
  weight: number;
  score: number | null; // 0-100, null when data unavailable
  detail: string;
}

export interface HealthReport {
  package: string;
  ecosystem: Ecosystem;
  version?: string;
  score: number | null; // 0-100
  grade: "A" | "B" | "C" | "D" | "F" | "?";
  /** Share of the scoring weight backed by real data (0-1). */
  confidence: number;
  summary: string;
  risks: string[];
  subscores: SubScore[];
  repository?: string;
  warnings: string[];
}
