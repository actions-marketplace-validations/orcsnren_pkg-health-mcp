export type Ecosystem = "npm" | "pypi";

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
  /** Unique commit authors in the last 12 months (sampled from up to 100 commits). */
  activeContributors12m?: number;
  /** Median days from open to close, for issues closed in the last 12 months. */
  medianIssueCloseDays?: number;
  closedIssuesSampled?: number;
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
