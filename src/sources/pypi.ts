import { getJson } from "../http.js";
import type { DownloadFacts } from "../types.js";

export interface PypiInfo {
  found: boolean;
  latestVersion?: string;
  latestReleaseAt?: string;
  deprecated?: boolean;
  deprecationMessage?: string;
  license?: string;
  repoCandidates: string[];
}

export async function fetchPypi(name: string): Promise<PypiInfo> {
  const res = await getJson<any>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (res.status === 404) return { found: false, repoCandidates: [] };
  if (!res.ok || !res.data) throw new Error(`PyPI request failed (${res.status})`);
  return parsePypiJson(res.data);
}

export function parsePypiJson(doc: any): PypiInfo {
  const info = doc.info ?? {};
  const files: any[] = Array.isArray(doc.urls) ? doc.urls : [];
  const uploadTimes = files
    .map((f) => f.upload_time_iso_8601 ?? f.upload_time)
    .filter(Boolean)
    .sort();
  const classifiers: string[] = info.classifiers ?? [];
  const inactive = classifiers.some((c) => c.startsWith("Development Status :: 7 - Inactive"));

  const urls: string[] = [];
  for (const v of Object.values(info.project_urls ?? {})) if (typeof v === "string") urls.push(v);
  if (typeof info.home_page === "string") urls.push(info.home_page);
  if (typeof info.download_url === "string") urls.push(info.download_url);

  return {
    found: true,
    latestVersion: info.version,
    latestReleaseAt: uploadTimes.at(-1),
    deprecated: inactive || undefined,
    deprecationMessage: inactive ? "Marked 'Development Status :: 7 - Inactive' on PyPI" : undefined,
    license: pypiLicense(info, classifiers),
    repoCandidates: urls,
  };
}

function pypiLicense(info: any, classifiers: string[]): string | undefined {
  if (typeof info.license_expression === "string" && info.license_expression) {
    return info.license_expression;
  }
  const fromClassifier = classifiers
    .filter((c) => c.startsWith("License ::"))
    .map((c) => c.split("::").at(-1)!.trim())
    .filter((c) => c !== "OSI Approved");
  if (fromClassifier.length) return fromClassifier.join(" OR ");
  // `license` is often the full license text; only trust short values.
  if (typeof info.license === "string" && info.license && info.license.length <= 60) {
    return info.license.trim();
  }
  return undefined;
}

/** pypistats "overall" endpoint returns ~180 days of daily downloads. */
export async function fetchPypiDownloads(name: string): Promise<DownloadFacts | undefined> {
  const res = await getJson<any>(
    `https://pypistats.org/api/packages/${encodeURIComponent(name.toLowerCase())}/overall?mirrors=false`,
  );
  if (!res.ok || !Array.isArray(res.data?.data)) return undefined;
  const byDate = new Map<string, number>();
  for (const row of res.data.data) {
    if (row.category && row.category !== "without_mirrors") continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + (row.downloads ?? 0));
  }
  const daily = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, n]) => n);
  if (daily.length < 120) return undefined;
  // pypistats keeps ~180 days; split what we have into two equal halves.
  const half = Math.floor(daily.length / 2);
  const recent = daily.slice(-half).reduce((a, b) => a + b, 0);
  const previous = daily.slice(-2 * half, -half).reduce((a, b) => a + b, 0);
  return { recent, previous };
}
