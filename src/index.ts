#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { analyzeMany } from "./analyze.js";
import { parseManifest } from "./manifest.js";
import { createServer, VERSION } from "./server.js";
import type { Ecosystem, HealthReport } from "./types.js";

const USAGE = `pkg-health-mcp ${VERSION}

Usage:
  pkg-health-mcp                         Start the MCP server on stdio
  pkg-health-mcp check <pkg...> [--pypi] Score packages from the command line
  pkg-health-mcp scan <manifest> [--dev] Score every dependency in a manifest
  Add --json for machine-readable output.

Environment:
  GITHUB_TOKEN   Raises the GitHub API limit from 60 to 5,000 requests/hour`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    const server = createServer();
    await server.connect(new StdioServerTransport());
    return;
  }
  if (cmd === "--help" || cmd === "-h") return void console.log(USAGE);
  if (cmd === "--version" || cmd === "-v") return void console.log(VERSION);

  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));
  let reports: HealthReport[];

  if (cmd === "check" && args.length) {
    const eco: Ecosystem = flags.has("--pypi") ? "pypi" : "npm";
    reports = await analyzeMany(args.map((name) => ({ name, ecosystem: eco })));
  } else if (cmd === "scan" && args.length === 1) {
    const deps = parseManifest(await readFile(args[0], "utf8"), args[0], flags.has("--dev"));
    reports = await analyzeMany(deps);
    reports.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  } else {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (flags.has("--json")) return void console.log(JSON.stringify(reports, null, 2));
  for (const r of reports) printReport(r);
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
