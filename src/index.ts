#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { analyzeMany } from "./analyze.js";
import { disableDiskCache } from "./http.js";
import { detectManifest, isLockFile, parseManifest } from "./manifest.js";
import { createServer, VERSION } from "./server.js";
import type { Ecosystem, HealthReport } from "./types.js";

const USAGE = `pkg-health-mcp ${VERSION}

Usage:
  pkg-health-mcp                          Start the MCP server on stdio
  pkg-health-mcp check <name...>          Score npm packages, PyPI packages or GitHub repositories
  pkg-health-mcp scan <file>              Score every dependency in a manifest or lock file

Files:
  package.json, package-lock.json, npm-shrinkwrap.json, yarn.lock, pnpm-lock.yaml,
  requirements.txt, pyproject.toml, poetry.lock, uv.lock

Options:
  --pypi              check: look the names up on PyPI instead of npm
  --github            check: treat the names as GitHub repositories (owner/repo or
                      a github.com URL is detected without this flag)
  --dev               scan: include dev dependencies
  --max <n>           scan: score at most n packages
  --fail-under <n>    Exit with code 1 if any package scores below n (0-100)
  --json              Print JSON
  --markdown          Print a Markdown table (e.g. for $GITHUB_STEP_SUMMARY)
  --no-cache          Skip the on-disk cache for this run
  -h, --help          Show this help
  -v, --version       Show the version

Environment:
  GITHUB_TOKEN                 Raises the GitHub API limit from 60 to 5,000 requests/hour
                               and enables the time-to-first-response signal
  PKG_HEALTH_CACHE_DIR         Cache location (default ~/.cache/pkg-health-mcp); "off" disables it
  PKG_HEALTH_CACHE_TTL_HOURS   How long cached API responses stay fresh (default 12)`;

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    const server = createServer();
    await server.connect(new StdioServerTransport());
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        pypi: { type: "boolean" },
        github: { type: "boolean" },
        dev: { type: "boolean" },
        max: { type: "string" },
        "fail-under": { type: "string" },
        json: { type: "boolean" },
        markdown: { type: "boolean" },
        "no-cache": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    return usageError((err as Error).message);
  }
  const { values: flags, positionals } = parsed;
  if (flags.help) return void console.log(USAGE);
  if (flags.version) return void console.log(VERSION);

  const failUnder = flags["fail-under"] === undefined ? undefined : Number(flags["fail-under"]);
  if (failUnder !== undefined && !(failUnder >= 0 && failUnder <= 100)) {
    return usageError("--fail-under expects a number from 0 to 100");
  }
  const max = flags.max === undefined ? undefined : Number(flags.max);
  if (max !== undefined && !(Number.isInteger(max) && max > 0)) {
    return usageError("--max expects a positive integer");
  }
  if (flags["no-cache"]) disableDiskCache();

  const [cmd, ...args] = positionals;
  let reports: HealthReport[];
  let title: string;

  if (cmd === "check" && args.length) {
    const eco: Ecosystem = flags.github ? "github" : flags.pypi ? "pypi" : "npm";
    reports = await analyzeMany(args.map((name) => ({ name, ecosystem: eco })));
    title = "Package health";
  } else if (cmd === "scan" && args.length === 1) {
    const content = await readFile(args[0], "utf8");
    const lock = isLockFile(detectManifest(content, args[0]));
    let deps = parseManifest(content, args[0], flags.dev);
    const total = deps.length;
    if (max !== undefined) deps = deps.slice(0, max);
    if (lock && !flags.json && !flags.markdown) {
      console.error(`Scoring ${deps.length}${total > deps.length ? ` of ${total}` : ""} packages from ${args[0]}...`);
    }
    reports = await analyzeMany(deps);
    reports.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
    title = `Dependency health: ${args[0]}${total > deps.length ? ` (first ${deps.length} of ${total})` : ""}`;
  } else {
    return usageError();
  }

  const failing = failUnder === undefined ? [] : reports.filter((r) => r.score !== null && r.score < failUnder);

  if (flags.json) console.log(JSON.stringify(reports, null, 2));
  else if (flags.markdown) console.log(markdown(title, reports, failUnder, failing));
  else for (const r of reports) printReport(r);

  if (failUnder !== undefined) {
    const unscored = reports.filter((r) => r.score === null).length;
    const note = unscored ? ` (${unscored} could not be scored and were not counted)` : "";
    if (failing.length) {
      console.error(
        `\n${failing.length} package(s) scored below ${failUnder}: ` +
          `${failing.map((r) => `${r.package} (${r.score})`).join(", ")}${note}`,
      );
      process.exitCode = 1;
    } else if (!flags.json) {
      console.error(`\nAll scored packages are at or above ${failUnder}${note}.`);
    }
  }
}

function usageError(message?: string): void {
  if (message) console.error(`${message}\n`);
  console.error(USAGE);
  process.exitCode = 2;
}

function printReport(r: HealthReport): void {
  const score = r.score === null ? "  ?" : String(r.score).padStart(3);
  console.log(`\n${r.grade}  ${score}/100  ${r.package}${r.version ? `@${r.version}` : ""}  [${r.ecosystem}]`);
  for (const s of r.subscores) {
    const v = s.score === null ? "  -" : String(s.score).padStart(3);
    console.log(`     ${v}  ${s.label.padEnd(22)} ${s.detail}`);
  }
  for (const risk of r.risks) console.log(`     !  ${risk}`);
  for (const w of r.warnings) console.log(`     ~  ${w}`);
}

function markdown(title: string, reports: HealthReport[], failUnder: number | undefined, failing: HealthReport[]): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [`## ${title}`, ""];
  if (failUnder !== undefined) {
    lines.push(
      failing.length
        ? `**${failing.length} package(s) below ${failUnder}.**`
        : `All scored packages are at or above ${failUnder}.`,
      "",
    );
  }
  lines.push("| Grade | Score | Package | Ecosystem | Main risk |", "| :---: | ---: | --- | --- | --- |");
  for (const r of reports) {
    const name = `${r.package}${r.version ? `@${r.version}` : ""}`;
    lines.push(
      `| ${r.grade} | ${r.score ?? "?"} | ${cell(name)} | ${r.ecosystem} | ${cell(r.risks[0] ?? r.warnings[0] ?? "")} |`,
    );
  }
  lines.push("", `<sub>pkg-health-mcp ${VERSION}</sub>`);
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
