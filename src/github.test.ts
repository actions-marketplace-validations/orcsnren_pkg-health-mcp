import { describe, expect, it } from "vitest";
import { resolveTarget } from "./analyze.js";
import { cacheDir } from "./http.js";
import { summarizeFirstResponses } from "./sources/github.js";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const maintainer = (at: string, login = "maint") => ({
  createdAt: at,
  authorAssociation: "MEMBER",
  author: { __typename: "User", login },
});

describe("resolveTarget", () => {
  it.each([
    [["expressjs/express", "npm"], { name: "expressjs/express", ecosystem: "github" }],
    [["https://github.com/psf/requests", "pypi"], { name: "psf/requests", ecosystem: "github" }],
    [["github:a/b", "npm"], { name: "a/b", ecosystem: "github" }],
    [["a/b", "github"], { name: "a/b", ecosystem: "github" }],
    [["@types/node", "npm"], { name: "@types/node", ecosystem: "npm" }],
    [["  express ", "npm"], { name: "express", ecosystem: "npm" }],
    [["requests", "pypi"], { name: "requests", ecosystem: "pypi" }],
  ] as const)("%j", ([name, eco], expected) => {
    expect(resolveTarget(name, eco)).toEqual(expected);
  });
});

describe("summarizeFirstResponses", () => {
  it("measures time to the first maintainer reply or close", () => {
    const s = summarizeFirstResponses(
      [
        // Answered by a maintainer after 2 days; the opener's own comment and a bot do not count.
        {
          createdAt: daysAgo(30),
          authorAssociation: "NONE",
          author: { login: "user1" },
          comments: {
            nodes: [
              { createdAt: daysAgo(29.5), authorAssociation: "NONE", author: { __typename: "User", login: "user1" } },
              { createdAt: daysAgo(29.5), authorAssociation: "MEMBER", author: { __typename: "Bot", login: "helper" } },
              maintainer(daysAgo(28)),
            ],
          },
        },
        // Closed after 4 days without a comment.
        { createdAt: daysAgo(40), closedAt: daysAgo(36), authorAssociation: "NONE", comments: { nodes: [] } },
        // Never answered: counts with its age so far (20 days).
        { createdAt: daysAgo(20), authorAssociation: "CONTRIBUTOR", comments: { nodes: [] } },
        // Ignored: opened by a maintainer, too fresh, older than a year.
        { createdAt: daysAgo(50), authorAssociation: "OWNER", comments: { nodes: [] } },
        { createdAt: daysAgo(2), authorAssociation: "NONE", comments: { nodes: [] } },
        { createdAt: daysAgo(400), authorAssociation: "NONE", comments: { nodes: [] } },
      ],
      NOW,
    );
    expect(s).toEqual({ medianFirstResponseDays: 4, responseIssuesSampled: 3, responseRate: 0.67 });
  });

  it("returns an empty sample when nothing qualifies", () => {
    expect(summarizeFirstResponses([], NOW)).toEqual({ responseIssuesSampled: 0 });
  });
});

describe("cacheDir", () => {
  it("defaults to XDG_CACHE_HOME and can be overridden or turned off", () => {
    expect(cacheDir({ XDG_CACHE_HOME: "/x" })).toBe("/x/pkg-health-mcp");
    expect(cacheDir({ PKG_HEALTH_CACHE_DIR: "/tmp/c" })).toBe("/tmp/c");
    expect(cacheDir({ PKG_HEALTH_CACHE_DIR: "off" })).toBeNull();
    expect(cacheDir({ PKG_HEALTH_CACHE_DIR: "0" })).toBeNull();
    expect(cacheDir({})).toMatch(/\.cache[/\\]pkg-health-mcp$/);
  });
});
