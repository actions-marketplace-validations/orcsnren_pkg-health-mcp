import { getJson } from "../http.js";
import type { DownloadFacts } from "../types.js";

export interface NpmInfo {
  found: boolean;
  latestVersion?: string;
  latestReleaseAt?: string;
  deprecated?: boolean;
  deprecationMessage?: string;
  license?: string;
  maintainers?: number;
  repository?: unknown;
}

export async function fetchNpm(name: string): Promise<NpmInfo> {
  const res = await getJson<any>(`https://registry.npmjs.org/${encodePkg(name)}`);
  if (res.status === 404) return { found: false };
  if (!res.ok || !res.data) throw new Error(`npm registry request failed (${res.status})`);
  return parseNpmPackument(res.data);
}

export function parseNpmPackument(doc: any): NpmInfo {
  const latest: string | undefined = doc["dist-tags"]?.latest;
  const manifest = latest ? doc.versions?.[latest] : undefined;
  const deprecation: unknown = manifest?.deprecated;
  const license = normalizeLicense(manifest?.license ?? doc.license);
  return {
    found: true,
    latestVersion: latest,
    latestReleaseAt: latest ? doc.time?.[latest] : undefined,
    deprecated: typeof deprecation === "string" && deprecation.length > 0,
    deprecationMessage: typeof deprecation === "string" ? deprecation : undefined,
    license,
    maintainers: Array.isArray(doc.maintainers) ? doc.maintainers.length : undefined,
    repository: manifest?.repository ?? doc.repository,
  };
}

/** Compare the last 90 days of downloads with the 90 days before. */
export async function fetchNpmDownloads(name: string): Promise<DownloadFacts | undefined> {
  const res = await getJson<any>(
    `https://api.npmjs.org/downloads/range/last-year/${encodePkg(name)}`,
  );
  if (!res.ok || !Array.isArray(res.data?.downloads)) return undefined;
  return splitDailyDownloads(res.data.downloads.map((d: any) => d.downloads ?? 0));
}

export function splitDailyDownloads(daily: number[]): DownloadFacts | undefined {
  if (daily.length < 180) return undefined;
  const recent = sum(daily.slice(-90));
  const previous = sum(daily.slice(-180, -90));
  return { recent, previous };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function encodePkg(name: string): string {
  // Scoped packages keep the "@", only the slash is encoded.
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

function normalizeLicense(l: unknown): string | undefined {
  if (!l) return undefined;
  if (typeof l === "string") return l;
  if (typeof l === "object" && typeof (l as any).type === "string") return (l as any).type;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x?.type)).join(" OR ");
  return undefined;
}
