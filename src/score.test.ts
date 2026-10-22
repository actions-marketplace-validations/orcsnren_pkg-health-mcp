import { describe, expect, it } from "vitest";
import { buildReport, classifyLicense } from "./score.js";
import type { PackageFacts } from "./types.js";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function facts(overrides: Partial<PackageFacts> = {}): PackageFacts {
  return {
    name: "demo",
    ecosystem: "npm",
    found: true,
    latestVersion: "1.0.0",
    latestReleaseAt: daysAgo(10),
    license: "MIT",
    registryMaintainers: 3,
    repoUrl: "https://github.com/acme/demo",
    github: {
      owner: "acme",
      repo: "demo",
      archived: false,
      lastCommitAt: daysAgo(2),
      activeContributors12m: 12,
      medianIssueCloseDays: 2,
      closedIssuesSampled: 40,
      openIssues: 5,
    },
    downloads: { recent: 1_200_000, previous: 1_000_000 },
    scorecard: 8,
    warnings: [],
    ...overrides,
  };
}

describe("buildReport", () => {
  it("grades a well-maintained package A", () => {
    const r = buildReport(facts(), NOW);
    expect(r.grade).toBe("A");
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.confidence).toBe(1);
    expect(r.risks).toEqual([]);
  });

  it("grades an abandoned package F and explains why", () => {
    const r = buildReport(
      facts({
        latestReleaseAt: daysAgo(1500),
        license: "GPL-3.0",
        github: {
          owner: "acme",
          repo: "demo",
          archived: false,
          lastCommitAt: undefined,
          activeContributors12m: 0,
          closedIssuesSampled: 0,
          openIssues: 80,
        },
        downloads: { recent: 1000, previous: 5000 },
        scorecard: 2,
      }),
      NOW,
    );
    expect(r.grade).toBe("F");
    expect(r.risks.join(" ")).toMatch(/No release in 4\+ years/);
    expect(r.risks.join(" ")).toMatch(/No commits in the last 12 months/);
    expect(r.risks.join(" ")).toMatch(/Downloads dropped/);
  });

  it("caps deprecated and archived packages", () => {
    expect(buildReport(facts({ deprecated: true, deprecationMessage: "use x" }), NOW).score).toBe(10);
    const archived = facts();
    archived.github!.archived = true;
    expect(buildReport(archived, NOW).score).toBeLessThanOrEqual(15);
  });

  it("re-weights when data is missing and lowers confidence", () => {
    const r = buildReport(facts({ github: undefined, scorecard: undefined, repoUrl: undefined }), NOW);
    expect(r.score).not.toBeNull();
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.risks.join(" ")).toMatch(/No linked GitHub repository/);
  });

  it("flags a single maintainer", () => {
    const f = facts();
    f.github!.activeContributors12m = 1;
    expect(buildReport(f, NOW).risks).toContain("Single active maintainer (bus factor 1)");
  });

  it("handles unknown packages", () => {
    const r = buildReport({ name: "nope", ecosystem: "pypi", found: false, warnings: [] }, NOW);
    expect(r.grade).toBe("?");
    expect(r.score).toBeNull();
  });
});

describe("classifyLicense", () => {
  it.each([
    ["MIT", 100],
    ["Apache-2.0", 100],
    ["BSD License", 100],
    ["MPL-2.0", 70],
    ["GPL-3.0-only", 35],
    ["AGPL-3.0", 20],
    ["(MIT OR GPL-3.0)", 100],
    ["MIT AND GPL-3.0", 35],
    ["GNU Library or Lesser General Public License (LGPL)", 70],
    [undefined, 0],
  ])("%s -> %s", (license, score) => {
    expect(classifyLicense(license as string | undefined).score).toBe(score);
  });
});
