import { parseGitHubRepo } from "./sources/repo-url.js";
import type { Ecosystem } from "./types.js";

export interface ManifestDependency {
  name: string;
  ecosystem: Ecosystem;
  spec?: string;
  dev?: boolean;
}

export type ManifestKind =
  | "package.json"
  | "requirements.txt"
  | "pyproject.toml"
  | "package-lock.json"
  | "yarn.lock"
  | "pnpm-lock.yaml"
  | "poetry.lock"
  | "uv.lock";

export const MANIFEST_FILES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
] as const;

/** Guess the manifest type from a file name or, failing that, its contents. */
export function detectManifest(content: string, filename?: string): ManifestKind {
  const base = filename?.split(/[\\/]/).pop()?.toLowerCase();
  if (base === "package.json") return "package.json";
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return "package-lock.json";
  if (base === "yarn.lock") return "yarn.lock";
  if (base === "pnpm-lock.yaml") return "pnpm-lock.yaml";
  if (base === "poetry.lock") return "poetry.lock";
  if (base === "uv.lock") return "uv.lock";
  if (base === "pyproject.toml") return "pyproject.toml";
  if (base && /requirements.*\.(txt|in)$/.test(base)) return "requirements.txt";
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) return /"lockfileVersion"\s*:/.test(content) ? "package-lock.json" : "package.json";
  if (/^lockfileVersion:/m.test(content)) return "pnpm-lock.yaml";
  if (/^# yarn lockfile v1|^__metadata:/m.test(content)) return "yarn.lock";
  if (/^\[\[package\]\]/m.test(content)) return /^requires-python\s*=/m.test(content) ? "uv.lock" : "poetry.lock";
  if (/^\s*\[(project|tool\.poetry)/m.test(content)) return "pyproject.toml";
  return "requirements.txt";
}

const PARSERS: Record<ManifestKind, (content: string) => ManifestDependency[]> = {
  "package.json": parsePackageJson,
  "requirements.txt": parseRequirements,
  "pyproject.toml": parsePyproject,
  "package-lock.json": parsePackageLock,
  "yarn.lock": parseYarnLock,
  "pnpm-lock.yaml": parsePnpmLock,
  "poetry.lock": parseTomlLock,
  "uv.lock": parseTomlLock,
};

/** True for file names scan_manifest knows how to read (used to keep the MCP tool from reading arbitrary files). */
export function isManifestFilename(filename: string): boolean {
  const base = filename.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return (MANIFEST_FILES as readonly string[]).includes(base) || /^requirements.*\.(txt|in)$/.test(base);
}

/** Lock files list every installed package, including transitive dependencies. */
export function isLockFile(kind: ManifestKind): boolean {
  return kind.endsWith(".lock") || kind === "package-lock.json" || kind === "pnpm-lock.yaml";
}

export function parseManifest(content: string, filename?: string, includeDev = false): ManifestDependency[] {
  const deps = PARSERS[detectManifest(content, filename)](content);
  const filtered = includeDev ? deps : deps.filter((d) => !d.dev);
  // De-duplicate by ecosystem + normalized name.
  const seen = new Set<string>();
  return filtered.filter((d) => {
    const name =
      d.ecosystem === "pypi" ? normalizePyName(d.name) : d.ecosystem === "github" ? d.name.toLowerCase() : d.name;
    const key = `${d.ecosystem}:${name}`;
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
    for (const [name, raw] of Object.entries(obj ?? {})) {
      const spec = String(raw);
      // GitHub references are scored as repositories.
      const gh = githubSpec(spec);
      if (gh) {
        out.push({ name: gh, ecosystem: "github", spec, dev });
        continue;
      }
      // Skip local, other git hosts, tarballs and workspace references: they are not registry packages.
      if (/^(file:|link:|workspace:|portal:|git\+|git:|https?:)/.test(spec)) continue;
      const alias = spec.match(/^npm:(@?[^@]+)/);
      out.push({ name: alias ? alias[1] : name, ecosystem: "npm", spec, dev });
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
  if (!clean || clean.startsWith("#")) return null;
  // Direct references: "git+https://github.com/o/r.git@v1#egg=x", "-e git+...", "name @ git+https://...".
  const url = clean.match(/(?:^|\s@\s|^-e\s+)((?:git\+)?(?:https?|ssh):\/\/\S+)/)?.[1];
  if (url) {
    const gh = githubSpec(url);
    return gh ? { name: gh, ecosystem: "github", spec: url } : null;
  }
  if (clean.startsWith("-")) return null;
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

/** "owner/repo" when a dependency spec points at a GitHub repository, otherwise null. */
export function githubSpec(spec: string): string | null {
  const s = spec.trim();
  // Bare "owner/repo" or "github:owner/repo", with an optional "#ref".
  const short = s.match(/^(?:github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?(?:#.*)?$/);
  if (short && !s.startsWith(".")) {
    const ref = parseGitHubRepo(short[1]);
    return ref ? `${ref.owner}/${ref.repo}` : null;
  }
  if (!/github\.com[/:]/i.test(s)) return null;
  // Drop pip's "@ref" and "#egg=" suffixes, which the URL parser does not expect.
  const cleaned = s.replace(/#.*$/, "").replace(/(github\.com[/:][\w.-]+\/[\w.-]+?)(?:\.git)?@[^/]*$/i, "$1");
  const ref = parseGitHubRepo(cleaned);
  return ref ? `${ref.owner}/${ref.repo}` : null;
}

// ---------------------------------------------------------------------------
// Lock files. These list every installed package, so scans include transitive dependencies.

/** npm package-lock.json / npm-shrinkwrap.json, lockfile versions 1, 2 and 3. */
export function parsePackageLock(content: string): ManifestDependency[] {
  let lock: any;
  try {
    lock = JSON.parse(content);
  } catch {
    throw new Error("package-lock.json is not valid JSON");
  }
  const out: ManifestDependency[] = [];
  const add = (name: string, entry: any) => {
    if (!entry || entry.link || entry.inBundle) return;
    const version = String(entry.version ?? "");
    const resolved = String(entry.resolved ?? "");
    const dev = Boolean(entry.dev || entry.devOptional);
    const gh = githubSpec(resolved) ?? githubSpec(version);
    if (gh) return void out.push({ name: gh, ecosystem: "github", spec: version, dev });
    if (/^(file:|link:|git\+|git:)/.test(version) || /^(file:|git\+|git:)/.test(resolved)) return;
    out.push({ name: entry.name ?? name, ecosystem: "npm", spec: version || undefined, dev });
  };

  if (lock.packages && typeof lock.packages === "object") {
    for (const [path, entry] of Object.entries<any>(lock.packages)) {
      const i = path.lastIndexOf("node_modules/");
      if (i === -1) continue; // the root project or a workspace folder
      add(path.slice(i + "node_modules/".length), entry);
    }
  } else {
    const walk = (deps: Record<string, any> | undefined) => {
      for (const [name, entry] of Object.entries(deps ?? {})) {
        add(name, entry);
        walk(entry?.dependencies);
      }
    };
    walk(lock.dependencies);
  }
  return out;
}

/** Yarn classic (v1) and Berry (v2+) yarn.lock. Neither records which packages are dev-only. */
export function parseYarnLock(content: string): ManifestDependency[] {
  const out: ManifestDependency[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line || /^[\s#]/.test(line) || !line.endsWith(":") || line.startsWith("__metadata")) continue;
    // A header lists every range that resolved to this entry; the first one is enough.
    const first = line.slice(0, -1).split(/,\s*/)[0].replace(/^"|"$/g, "");
    const at = first.indexOf("@", 1);
    if (at === -1) continue;
    let name = first.slice(0, at);
    let spec = first.slice(at + 1);
    if (/^(workspace:|file:|link:|portal:|exec:)/.test(spec)) continue;
    const gh = githubSpec(spec.replace(/^(?:git\+)?/, ""));
    if (gh) {
      out.push({ name: gh, ecosystem: "github", spec });
      continue;
    }
    if (/^(git[+:]|https?:|ssh:)/.test(spec)) continue;
    if (spec.startsWith("npm:")) {
      spec = spec.slice(4);
      const alias = spec.match(/^(@?[^@]+)@(.*)$/);
      if (alias) [, name, spec] = alias;
    }
    if (spec.startsWith("patch:")) {
      const inner = spec.match(/^patch:(@?[^@]+)@/);
      if (inner) name = decodeURIComponent(inner[1]);
    }
    out.push({ name, ecosystem: "npm", spec });
  }
  return out;
}

/** pnpm-lock.yaml, lockfile versions 5, 6 and 9. Only the "packages:" section is read. */
export function parsePnpmLock(content: string): ManifestDependency[] {
  const v5 = /^lockfileVersion:\s*['"]?5/m.test(content);
  const out: ManifestDependency[] = [];
  let inPackages = false;
  let current: ManifestDependency | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inPackages) continue;
    const key = line.match(/^ {2}(\S.*):\s*$/);
    if (key) {
      current = pnpmKey(key[1].replace(/^['"]|['"]$/g, ""), v5);
      if (current) out.push(current);
      continue;
    }
    if (current && /^ {4}dev:\s*true\s*$/.test(line)) current.dev = true;
  }
  return out;
}

function pnpmKey(raw: string, v5: boolean): ManifestDependency | null {
  // Drop the peer-dependency suffix: "(react@18.2.0)" in v6+, "_react@18.2.0" in v5.
  const key = raw.replace(/^\//, "").replace(/\(.*$/, "");
  // Git dependencies in v5/v6 are keyed by host path: "github.com/owner/repo/<sha>".
  if (key.startsWith("github.com/")) {
    const gh = githubSpec(key);
    return gh ? { name: gh, ecosystem: "github", spec: key } : null;
  }
  let name: string;
  let version: string;
  if (v5) {
    const parts = key.split("/");
    version = parts.pop()!.replace(/_.*$/, "");
    name = parts.join("/");
  } else {
    const at = key.indexOf("@", 1);
    if (at === -1) return null;
    name = key.slice(0, at);
    version = key.slice(at + 1);
  }
  const gh = githubSpec(version);
  if (gh) return { name: gh, ecosystem: "github", spec: version };
  if (!name || /^(file:|link:|git[+:]|https?:)/.test(version) || version.includes("://")) return null;
  return { name, ecosystem: "npm", spec: version };
}

/**
 * poetry.lock and uv.lock: one [[package]] table per installed package.
 * Poetry before 1.5 marks dev packages with category = "dev"; uv does not record it.
 */
export function parseTomlLock(content: string): ManifestDependency[] {
  const out: ManifestDependency[] = [];
  for (const block of content.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    // Stop at the next top-level table so nested [package.*] data does not leak in.
    const body = block.split(/^\[(?!package\.)/m)[0];
    const name = body.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (!name) continue;
    const dev = /^category\s*=\s*"dev"/m.test(body);
    const git =
      body.match(/^source\s*=\s*\{[^}]*\bgit\s*=\s*"([^"]+)"/m)?.[1] ??
      (/^type\s*=\s*"git"/m.test(body) ? body.match(/^url\s*=\s*"([^"]+)"/m)?.[1] : undefined);
    if (git) {
      const gh = githubSpec(git.replace(/\?.*$/, ""));
      if (gh) out.push({ name: gh, ecosystem: "github", dev });
      continue;
    }
    // Local and URL sources (uv: editable/virtual/directory/path/url; Poetry: directory/file/url).
    if (/^source\s*=\s*\{[^}]*\b(editable|virtual|directory|path|url)\s*=/m.test(body)) continue;
    if (/^type\s*=\s*"(directory|file|url)"/m.test(body)) continue;
    const version = body.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    out.push({ name, ecosystem: "pypi", spec: version, dev });
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
