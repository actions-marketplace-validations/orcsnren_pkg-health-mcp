import type { HealthReport, PackageFacts, SubScore } from "./types.js";

export const WEIGHTS = {
  activity: 0.3,
  maintainers: 0.2,
  issues: 0.15,
  downloads: 0.15,
  scorecard: 0.1,
  license: 0.1,
} as const;

const DAY = 86_400_000;

export function daysSince(iso: string | undefined, now = Date.now()): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : undefined;
}

function step(value: number, table: Array<[number, number]>, fallback: number): number {
  for (const [limit, score] of table) if (value <= limit) return score;
  return fallback;
}

export function scoreActivity(f: PackageFacts, now = Date.now()): SubScore {
  const release = daysSince(f.latestReleaseAt, now);
  const commit = daysSince(f.github?.lastCommitAt, now);
  const candidates = [release, commit].filter((d): d is number => d !== undefined);
  const base: SubScore = { key: "activity", label: "Recent activity", weight: WEIGHTS.activity, score: null, detail: "" };
  if (f.github?.archived) {
    return { ...base, score: 0, detail: "Repository is archived (read-only)" };
  }
  if (!candidates.length) return { ...base, detail: "No release or commit dates available" };
  const freshest = Math.min(...candidates);
  const score = step(freshest, [[30, 100], [90, 90], [180, 75], [365, 55], [730, 30]], 10);
  const parts = [];
  if (release !== undefined) parts.push(`last release ${release}d ago`);
  if (commit !== undefined) parts.push(`last commit ${commit}d ago`);
  return { ...base, score, detail: parts.join(", ") };
}

export function scoreMaintainers(f: PackageFacts): SubScore {
  const base: SubScore = { key: "maintainers", label: "Maintainer diversity", weight: WEIGHTS.maintainers, score: null, detail: "" };
  const active = f.github?.activeContributors12m;
  if (active === undefined) {
    if (f.registryMaintainers === undefined) return { ...base, detail: "No contributor data" };
    const score = step(f.registryMaintainers, [[1, 35], [2, 55], [4, 70]], 80);
    return { ...base, score, detail: `${f.registryMaintainers} registry maintainer(s); no GitHub data` };
  }
  const score = step(active, [[0, 5], [1, 25], [2, 45], [4, 65], [9, 85]], 100);
  return { ...base, score, detail: `${active} active committer(s) in the last 12 months` };
}

export function scoreIssues(f: PackageFacts): SubScore {
  const base: SubScore = { key: "issues", label: "Issue responsiveness", weight: WEIGHTS.issues, score: null, detail: "" };
  const g = f.github;
  if (!g || g.closedIssuesSampled === undefined) return { ...base, detail: "No issue data" };
  if (g.closedIssuesSampled === 0) {
    if ((g.openIssues ?? 0) === 0) return { ...base, detail: "No issues opened or closed recently" };
    return { ...base, score: 15, detail: `No issues closed in 12 months, ${g.openIssues} open` };
  }
  const d = g.medianIssueCloseDays!;
  const score = step(d, [[3, 100], [14, 85], [45, 65], [120, 45], [270, 25]], 10);
  return { ...base, score, detail: `median ${d}d to close (${g.closedIssuesSampled} issues sampled)` };
}

export function scoreDownloads(f: PackageFacts): SubScore {
  const base: SubScore = { key: "downloads", label: "Download trend", weight: WEIGHTS.downloads, score: null, detail: "" };
  const d = f.downloads;
  if (!d) return { ...base, detail: "No download statistics" };
  if (d.previous === 0 && d.recent === 0) return { ...base, score: 10, detail: "No downloads in 6 months" };
  if (d.previous === 0) return { ...base, score: 90, detail: `${fmt(d.recent)} downloads in 90d (new package)` };
  const ratio = d.recent / d.previous;
  const score = step(-ratio, [[-1.15, 100], [-0.95, 85], [-0.8, 65], [-0.6, 45], [-0.4, 25]], 10);
  const pct = Math.round((ratio - 1) * 100);
  return {
    ...base,
    score,
    detail: `${fmt(d.recent)} downloads in last 90d (${pct >= 0 ? "+" : ""}${pct}% vs previous 90d)`,
  };
}

export function scoreScorecard(f: PackageFacts): SubScore {
  const base: SubScore = { key: "scorecard", label: "OpenSSF Scorecard", weight: WEIGHTS.scorecard, score: null, detail: "" };
  if (f.scorecard === undefined) return { ...base, detail: "Not scanned by OpenSSF Scorecard" };
  return { ...base, score: Math.round(f.scorecard * 10), detail: `${f.scorecard.toFixed(1)}/10` };
}

const PERMISSIVE = /^(MIT|MIT-0|ISC|0BSD|BSD-[0-9]-Clause.*|Apache-2\.0|Unlicense|Zlib|CC0-1\.0|BlueOak-1\.0\.0|WTFPL|Python-2\.0|PSF-2\.0|BSD|BSD License|MIT License|Apache Software License|ISC License.*|The Unlicense.*|Python Software Foundation License)$/i;
const WEAK_COPYLEFT = /^(MPL-2\.0|LGPL.*|EPL-.*|Mozilla Public License.*|GNU Lesser General Public License.*|GNU Library or Lesser General Public License.*|Eclipse Public License.*)$/i;
const STRONG_COPYLEFT = /^(GPL.*|GNU General Public License.*)$/i;
const NETWORK_COPYLEFT = /^(AGPL.*|SSPL.*|GNU Affero General Public License.*|Server Side Public License.*)$/i;

export function classifyLicense(license: string | undefined): {
  score: number | null;
  kind: string;
} {
  if (!license) return { score: 0, kind: "missing" };
  const cleaned = license.replace(/[()]/g, "").trim();
  if (/^UNLICENSED$|^SEE LICENSE/i.test(cleaned)) return { score: 20, kind: "proprietary / custom" };
  // SPDX operators are upper-case; "GNU Library or Lesser ..." must not be split.
  // For "A OR B", the most permissive option applies; for "A AND B", the strictest.
  const isOr = /\s+OR\s+/.test(cleaned);
  const parts = cleaned.split(/\s+(?:OR|AND)\s+/);
  const scores = parts.map((p) => {
    const t = p.trim();
    if (PERMISSIVE.test(t)) return 100;
    if (WEAK_COPYLEFT.test(t)) return 70;
    if (NETWORK_COPYLEFT.test(t)) return 20;
    if (STRONG_COPYLEFT.test(t)) return 35;
    return 50;
  });
  const score = isOr ? Math.max(...scores) : Math.min(...scores);
  const kind =
    score === 100 ? "permissive" : score === 70 ? "weak copyleft" : score === 35 ? "strong copyleft" : score === 20 ? "network copyleft" : "unrecognized";
  return { score, kind };
}

export function scoreLicense(f: PackageFacts): SubScore {
  const { score, kind } = classifyLicense(f.license);
  return {
    key: "license",
    label: "License",
    weight: WEIGHTS.license,
    score,
    detail: f.license ? `${f.license} (${kind})` : "No license declared",
  };
}

export function gradeFor(score: number | null): HealthReport["grade"] {
  if (score === null) return "?";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

export function buildReport(f: PackageFacts, now = Date.now()): HealthReport {
  if (!f.found) {
    return {
      package: f.name,
      ecosystem: f.ecosystem,
      score: null,
      grade: "?",
      confidence: 0,
      summary: `Package not found on ${f.ecosystem}`,
      risks: ["Package does not exist in the registry (typo or possible typosquatting target)"],
      subscores: [],
      warnings: f.warnings,
    };
  }

  const subscores = [
    scoreActivity(f, now),
    scoreMaintainers(f),
    scoreIssues(f),
    scoreDownloads(f),
    scoreScorecard(f),
    scoreLicense(f),
  ];

  const scored = subscores.filter((s) => s.score !== null);
  const weightSum = scored.reduce((a, s) => a + s.weight, 0);
  let score =
    weightSum > 0 ? Math.round(scored.reduce((a, s) => a + s.weight * s.score!, 0) / weightSum) : null;

  const risks: string[] = [];
  if (f.deprecated) {
    risks.push(`Deprecated: ${f.deprecationMessage ?? "marked deprecated by its maintainers"}`);
    if (score !== null) score = Math.min(score, 10);
  }
  if (f.github?.archived) {
    risks.push("Source repository is archived");
    if (score !== null) score = Math.min(score, 15);
  }
  const lastRelease = daysSince(f.latestReleaseAt, now);
  if (lastRelease !== undefined && lastRelease > 730) risks.push(`No release in ${Math.floor(lastRelease / 365)}+ years`);
  if (f.github?.activeContributors12m === 0) risks.push("No commits in the last 12 months");
  else if (f.github?.activeContributors12m === 1) risks.push("Single active maintainer (bus factor 1)");
  if (!f.repoUrl) risks.push("No linked GitHub repository; source activity could not be verified");
  const lic = subscores.find((s) => s.key === "license")!;
  if (lic.score !== null && lic.score <= 35) risks.push(`License may restrict commercial use: ${lic.detail}`);
  const dl = f.downloads;
  if (dl && dl.previous > 0 && dl.recent / dl.previous < 0.6) risks.push("Downloads dropped more than 40% in the last 90 days");

  const confidence = Math.round(weightSum * 100) / 100;
  const grade = gradeFor(score);
  return {
    package: f.name,
    ecosystem: f.ecosystem,
    version: f.latestVersion,
    score,
    grade,
    confidence,
    summary: summarize(f.name, score, grade, risks, confidence),
    risks,
    subscores,
    repository: f.repoUrl,
    warnings: f.warnings,
  };
}

function summarize(name: string, score: number | null, grade: string, risks: string[], confidence: number): string {
  if (score === null) return `${name}: not enough data to score`;
  const verdict =
    grade === "A" ? "healthy" : grade === "B" ? "mostly healthy" : grade === "C" ? "some maintenance concerns" : grade === "D" ? "poorly maintained" : "likely abandoned or unsafe to adopt";
  const top = risks[0] ? ` Main risk: ${risks[0]}.` : "";
  const conf = confidence < 0.6 ? " (low confidence: limited data)" : "";
  return `${name}: ${score}/100 (${grade}), ${verdict}${conf}.${top}`;
}

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
