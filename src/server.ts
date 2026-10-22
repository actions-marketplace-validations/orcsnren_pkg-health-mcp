import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeMany, analyzePackage } from "./analyze.js";
import { detectManifest, isLockFile, isManifestFilename, MANIFEST_FILES, parseManifest } from "./manifest.js";
import type { HealthReport } from "./types.js";

export const VERSION = "0.2.0";

const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;

const ecosystem = z
  .enum(["npm", "pypi", "github"])
  .default("npm")
  .describe(
    "Where to look: 'npm' (JavaScript/TypeScript), 'pypi' (Python) or 'github' (any GitHub repository, " +
      "name given as 'owner/repo'). A GitHub URL or 'owner/repo' is detected automatically.",
  );

const readOnly = { readOnlyHint: true, openWorldHint: true, idempotentHint: true } as const;

function respond(text: string, data: unknown) {
  return {
    content: [{ type: "text" as const, text: `${text}\n\n${JSON.stringify(data, null, 2)}` }],
  };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "pkg-health-mcp", version: VERSION });

  server.registerTool(
    "check_package",
    {
      title: "Check package health",
      description:
        "Score how well an npm or PyPI package, or any GitHub repository, is maintained (0-100, graded A-F). " +
        "Looks at release and commit recency, number of active committers, time to first maintainer response, " +
        "issue close time, download trend, OpenSSF Scorecard and license. " +
        "Use before adding a new dependency, when asked whether a library or project is abandoned, " +
        "or to vet a GitHub project that is not published to a registry.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(
            "Package name ('express', '@types/node', 'requests') or GitHub repository ('owner/repo' or a github.com URL)",
          ),
        ecosystem,
      },
      annotations: readOnly,
    },
    async ({ name, ecosystem }) => {
      const report = await analyzePackage(name, ecosystem);
      return respond(report.summary, report);
    },
  );

  server.registerTool(
    "scan_manifest",
    {
      title: "Scan dependency manifest",
      description:
        "Score every dependency in a manifest or lock file and list the riskiest first. Supports package.json, " +
        "requirements.txt, pyproject.toml, and the lock files package-lock.json, yarn.lock, pnpm-lock.yaml, " +
        "poetry.lock and uv.lock (which include transitive dependencies). GitHub-hosted dependencies are scored " +
        "as repositories. Prefer `path` for local files, especially large lock files; otherwise pass `content`. " +
        "Use to audit a project's dependencies for abandoned or risky packages.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(`Path to a local manifest or lock file, relative to the server's working directory. One of: ${MANIFEST_FILES.join(", ")}, requirements*.txt`),
        content: z.string().optional().describe("Full text of the manifest file, if not passing `path`"),
        filename: z
          .string()
          .optional()
          .describe("File name for `content`, used to detect the format (e.g. package.json, yarn.lock)"),
        include_dev: z.boolean().default(false).describe("Also score devDependencies / optional dependencies"),
        max_packages: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(50)
          .describe("Upper limit on packages scored; lock files often list several hundred"),
      },
      annotations: readOnly,
    },
    async ({ path, content, filename, include_dev, max_packages }) => {
      let deps;
      let lock = false;
      try {
        if (path) {
          if (!isManifestFilename(path)) {
            return fail(`Not a supported manifest file name: ${path}. Expected one of ${MANIFEST_FILES.join(", ")}.`);
          }
          const file = resolve(path);
          if ((await stat(file)).size > MAX_MANIFEST_BYTES) return fail(`${path} is larger than 20 MB.`);
          content = await readFile(file, "utf8");
          filename = path;
        }
        if (!content) return fail("Pass either `path` or `content`.");
        lock = isLockFile(detectManifest(content, filename));
        deps = parseManifest(content, filename, include_dev);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        return fail(e.code === "ENOENT" ? `File not found: ${path}` : e.message);
      }
      if (!deps.length) return fail("No registry dependencies found in the manifest.");
      const truncated = deps.length > max_packages;
      const reports = await analyzeMany(deps.slice(0, max_packages));
      const ranked = [...reports].sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
      const counts = countGrades(reports);
      const risky = ranked.filter((r) => r.grade === "D" || r.grade === "F" || r.grade === "?");
      const header =
        `Scanned ${reports.length} package(s)${truncated ? ` (first ${max_packages} of ${deps.length})` : ""}` +
        `${lock ? ", including transitive dependencies from the lock file" : ""}. ` +
        `Grades: ${Object.entries(counts).map(([g, n]) => `${g}=${n}`).join(", ")}. ` +
        (risky.length
          ? `Needs attention: ${risky.slice(0, 10).map((r) => `${r.package} (${r.score ?? "?"})`).join(", ")}.`
          : "No packages graded D or F.");
      return respond(header, {
        lock_file: lock,
        scanned: reports.length,
        total_dependencies: deps.length,
        grades: counts,
        packages: ranked.map(compact),
      });
    },
  );

  server.registerTool(
    "compare_packages",
    {
      title: "Compare alternative packages",
      description:
        "Compare 2-5 alternative packages from the same registry (e.g. 'moment' vs 'dayjs' vs 'date-fns'), or GitHub " +
        "repositories, and rank them by maintenance health. Use when choosing between libraries.",
      inputSchema: {
        packages: z
          .array(z.string().min(1))
          .min(2)
          .max(5)
          .describe("Package names or GitHub repositories ('owner/repo') to compare"),
        ecosystem,
      },
      annotations: readOnly,
    },
    async ({ packages, ecosystem }) => {
      const reports = await analyzeMany(packages.map((name) => ({ name, ecosystem })));
      const ranked = [...reports].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      const best = ranked[0];
      const header =
        best.score === null
          ? "Could not score any of the packages."
          : `Healthiest: ${best.package} (${best.score}/100, ${best.grade}). Ranking: ` +
            ranked.map((r) => `${r.package} ${r.score ?? "?"}`).join(" > ");
      return respond(header, { ranking: ranked.map(compact) });
    },
  );

  return server;
}

function compact(r: HealthReport) {
  return {
    package: r.package,
    version: r.version,
    score: r.score,
    grade: r.grade,
    confidence: r.confidence,
    risks: r.risks,
    signals: Object.fromEntries(r.subscores.map((s) => [s.key, { score: s.score, detail: s.detail }])),
    repository: r.repository,
    ...(r.warnings.length ? { warnings: r.warnings } : {}),
  };
}

function countGrades(reports: HealthReport[]): Record<string, number> {
  const order = ["A", "B", "C", "D", "F", "?"];
  const counts: Record<string, number> = {};
  for (const g of order) {
    const n = reports.filter((r) => r.grade === g).length;
    if (n) counts[g] = n;
  }
  return counts;
}
