import type { Ecosystem } from "./types.js";

export interface ManifestDependency {
  name: string;
  ecosystem: Ecosystem;
  spec?: string;
  dev?: boolean;
}

export type ManifestKind = "package.json" | "requirements.txt" | "pyproject.toml";

/** Guess the manifest type from a file name or, failing that, its contents. */
export function detectManifest(content: string, filename?: string): ManifestKind {
  const base = filename?.split(/[\\/]/).pop()?.toLowerCase();
  if (base === "package.json") return "package.json";
  if (base === "pyproject.toml") return "pyproject.toml";
  if (base && /requirements.*\.(txt|in)$/.test(base)) return "requirements.txt";
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) return "package.json";
  if (/^\s*\[(project|tool\.poetry)/m.test(content)) return "pyproject.toml";
  return "requirements.txt";
}

export function parseManifest(content: string, filename?: string, includeDev = false): ManifestDependency[] {
  const kind = detectManifest(content, filename);
  const deps =
    kind === "package.json"
      ? parsePackageJson(content)
      : kind === "pyproject.toml"
        ? parsePyproject(content)
        : parseRequirements(content);
  const filtered = includeDev ? deps : deps.filter((d) => !d.dev);
  // De-duplicate by ecosystem + normalized name.
  const seen = new Set<string>();
  return filtered.filter((d) => {
    const key = `${d.ecosystem}:${d.ecosystem === "pypi" ? normalizePyName(d.name) : d.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parsePackageJson(content: string): ManifestDependency[] {
  let pkg: any;
  try {
    pkg = JSON.parse(content);
  } catch {
    throw new Error("package.json is not valid JSON");
  }
  const out: ManifestDependency[] = [];
  const add = (obj: Record<string, string> | undefined, dev: boolean) => {
    for (const [name, spec] of Object.entries(obj ?? {})) {
      // Skip local, git and workspace references: they are not registry packages.
      if (/^(file:|link:|workspace:|git\+|git:|github:|https?:)/.test(String(spec))) continue;
      const alias = String(spec).match(/^npm:(@?[^@]+)/);
      out.push({ name: alias ? alias[1] : name, ecosystem: "npm", spec: String(spec), dev });
    }
  };
  add(pkg.dependencies, false);
  add(pkg.peerDependencies, false);
  add(pkg.optionalDependencies, false);
  add(pkg.devDependencies, true);
  return out;
}

const PY_REQ = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/;

function parseRequirementLine(line: string): ManifestDependency | null {
  const clean = line.replace(/\s+#.*$/, "").trim();
  if (!clean || clean.startsWith("#") || clean.startsWith("-")) return null;
  if (/^(git\+|https?:|file:|\.|\/)/.test(clean) || clean.includes(" @ ")) return null;
  const m = clean.match(PY_REQ);
  if (!m) return null;
  return { name: m[1], ecosystem: "pypi", spec: m[3].split(";")[0].trim() || undefined };
}

export function parseRequirements(content: string): ManifestDependency[] {
  return content
    .split(/\r?\n/)
    .map(parseRequirementLine)
    .filter((d): d is ManifestDependency => d !== null);
}

/**
 * Minimal pyproject.toml support: PEP 621 `[project] dependencies`,
 * `[project.optional-dependencies]`, and Poetry `[tool.poetry.dependencies]`.
 */
export function parsePyproject(content: string): ManifestDependency[] {
  const out: ManifestDependency[] = [];

  const project = section(content, "project");
  if (project) {
    const m = project.match(/^\s*dependencies\s*=\s*\[/m);
    if (m) {
      const items = arrayStrings(project, m.index! + m[0].length);
      out.push(...items.map(parseRequirementLine).filter(nonNull));
    }
  }

  const optional = section(content, "project.optional-dependencies");
  if (optional) {
    for (const m of optional.matchAll(/=\s*\[/g)) {
      out.push(
        ...arrayStrings(optional, m.index! + m[0].length)
          .map(parseRequirementLine)
          .filter(nonNull)
          .map((d) => ({ ...d, dev: true })),
      );
    }
  }

  for (const [sec, dev] of [
    ["tool.poetry.dependencies", false],
    ["tool.poetry.dev-dependencies", true],
    ["tool.poetry.group.dev.dependencies", true],
  ] as const) {
    const body = section(content, sec);
    if (!body) continue;
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/);
      if (m && m[1].toLowerCase() !== "python") out.push({ name: m[1], ecosystem: "pypi", dev });
    }
  }
  return out;
}

function section(content: string, name: string): string | null {
  const escaped = name.replace(/\./g, "\\.");
  const m = content.match(new RegExp(`^\\[${escaped}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m"));
  return m ? m[1] : null;
}

/** Collect quoted strings from a TOML array starting just after its "[", stopping at the matching "]". */
function arrayStrings(s: string, start: number): string[] {
  const out: string[] = [];
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "]") break;
    if (ch === "#") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = s.indexOf(ch, i + 1);
      if (end === -1) break;
      out.push(s.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}

function nonNull<T>(x: T | null): x is T {
  return x !== null;
}

export function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}
