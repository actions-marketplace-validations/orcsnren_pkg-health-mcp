import { describe, expect, it } from "vitest";
import { detectManifest, parseManifest } from "./manifest.js";
import { summarizeCommits, summarizeIssues } from "./sources/github.js";
import { parseNpmPackument, splitDailyDownloads } from "./sources/npm.js";
import { parsePypiJson } from "./sources/pypi.js";
import { parseGitHubRepo } from "./sources/repo-url.js";

describe("parseGitHubRepo", () => {
  it.each([
    ["git+https://github.com/expressjs/express.git", "expressjs/express"],
    ["https://github.com/psf/requests", "psf/requests"],
    ["git@github.com:sindresorhus/got.git", "sindresorhus/got"],
    ["github:lodash/lodash", "lodash/lodash"],
    ["facebook/react", "facebook/react"],
    ["https://github.com/pallets/flask/tree/main/docs", "pallets/flask"],
    [{ type: "git", url: "https://github.com/vercel/next.js.git", directory: "packages/next" }, "vercel/next.js"],
  ])("%j", (input, expected) => {
    const r = parseGitHubRepo(input);
    expect(r && `${r.owner}/${r.repo}`).toBe(expected);
  });

  it("rejects non-GitHub URLs", () => {
    expect(parseGitHubRepo("https://gitlab.com/a/b")).toBeNull();
    expect(parseGitHubRepo("https://requests.readthedocs.io")).toBeNull();
  });
});

describe("manifest parsing", () => {
  it("parses package.json and skips non-registry specs", () => {
    const deps = parseManifest(
      JSON.stringify({
        dependencies: { express: "^4", local: "file:../x", gh: "github:a/b", alias: "npm:lodash@4" },
        devDependencies: { vitest: "^3" },
      }),
      "package.json",
    );
    expect(deps.map((d) => d.name)).toEqual(["express", "lodash"]);
  });

  it("includes dev dependencies on request", () => {
    const deps = parseManifest('{"devDependencies":{"vitest":"^3"}}', "package.json", true);
    expect(deps).toEqual([{ name: "vitest", ecosystem: "npm", spec: "^3", dev: true }]);
  });

  it("parses requirements.txt", () => {
    const deps = parseManifest(
      [
        "# comment",
        "requests>=2.31  # http",
        "Django==5.0",
        "uvicorn[standard]>=0.30",
        "-r other.txt",
        "-e .",
        "git+https://github.com/a/b.git",
        "numpy; python_version >= '3.10'",
        "requests==2.32",
      ].join("\n"),
      "requirements.txt",
    );
    expect(deps.map((d) => d.name)).toEqual(["requests", "Django", "uvicorn", "numpy"]);
  });

  it("parses PEP 621 pyproject.toml including extras in specs", () => {
    const toml = `
[project]
name = "demo"
dependencies = [
  "httpx>=0.27",
  "requests[socks]>=2",  # with extras
  'pydantic',
]

[project.optional-dependencies]
dev = ["pytest", "ruff"]

[tool.ruff]
line-length = 100
`;
    expect(detectManifest(toml)).toBe("pyproject.toml");
    expect(parseManifest(toml).map((d) => d.name)).toEqual(["httpx", "requests", "pydantic"]);
    expect(parseManifest(toml, "pyproject.toml", true).map((d) => d.name)).toContain("pytest");
  });

  it("parses Poetry pyproject.toml", () => {
    const toml = `
[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.110"

[tool.poetry.group.dev.dependencies]
pytest = "^8"
`;
    expect(parseManifest(toml, "pyproject.toml").map((d) => d.name)).toEqual(["fastapi"]);
  });
});

describe("registry parsers", () => {
  it("reads an npm packument", () => {
    const info = parseNpmPackument({
      "dist-tags": { latest: "2.0.0" },
      time: { "2.0.0": "2026-01-01T00:00:00Z" },
      maintainers: [{ name: "a" }, { name: "b" }],
      versions: {
        "2.0.0": { license: "MIT", deprecated: "Use v3", repository: { url: "git+https://github.com/a/b.git" } },
      },
    });
    expect(info).toMatchObject({
      latestVersion: "2.0.0",
      latestReleaseAt: "2026-01-01T00:00:00Z",
      deprecated: true,
      license: "MIT",
      maintainers: 2,
    });
  });

  it("reads PyPI JSON and prefers license_expression, then classifiers", () => {
    const base = {
      info: {
        version: "1.2.3",
        license: "A very long license text ".repeat(10),
        classifiers: ["License :: OSI Approved :: BSD License"],
        project_urls: { Source: "https://github.com/pallets/flask" },
      },
      urls: [{ upload_time_iso_8601: "2026-05-01T00:00:00Z" }],
    };
    expect(parsePypiJson(base)).toMatchObject({
      latestVersion: "1.2.3",
      latestReleaseAt: "2026-05-01T00:00:00Z",
      license: "BSD License",
    });
    expect(parsePypiJson({ ...base, info: { ...base.info, license_expression: "MIT" } }).license).toBe("MIT");
  });

  it("splits daily downloads into two 90-day windows", () => {
    const daily = [...Array(185).fill(1), ...Array(90).fill(2)];
    expect(splitDailyDownloads(daily.slice(-180))).toEqual({ recent: 180, previous: 90 });
    expect(splitDailyDownloads([1, 2, 3])).toBeUndefined();
  });
});

describe("GitHub summaries", () => {
  it("counts unique human committers", () => {
    const s = summarizeCommits([
      { author: { login: "alice" }, commit: { committer: { date: "2026-09-01T00:00:00Z" } } },
      { author: { login: "bob" }, commit: {} },
      { author: { login: "alice" }, commit: {} },
      { author: { login: "dependabot[bot]" }, commit: {} },
    ]);
    expect(s).toEqual({ lastCommitAt: "2026-09-01T00:00:00Z", activeContributors12m: 2 });
  });

  it("computes median issue close time and ignores pull requests", () => {
    const since = "2026-01-01T00:00:00Z";
    const s = summarizeIssues(
      [
        { created_at: "2026-03-01T00:00:00Z", closed_at: "2026-03-02T00:00:00Z" },
        { created_at: "2026-03-01T00:00:00Z", closed_at: "2026-03-11T00:00:00Z" },
        { created_at: "2026-03-01T00:00:00Z", closed_at: "2026-03-04T00:00:00Z" },
        { created_at: "2026-03-01T00:00:00Z", closed_at: "2026-03-30T00:00:00Z", pull_request: {} },
      ],
      since,
    );
    expect(s).toEqual({ medianIssueCloseDays: 3, closedIssuesSampled: 3 });
  });
});
