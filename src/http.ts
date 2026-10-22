import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MEMORY_TTL_MS = 60 * 60 * 1000;
const DEFAULT_DISK_TTL_HOURS = 12;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "pkg-health-mcp (+https://github.com/orcsnren/pkg-health-mcp)";

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  headers: Headers | null;
}

const memory = new Map<string, { at: number; value: HttpResult<unknown> }>();

/**
 * Directory for the on-disk cache, or null when disabled.
 * PKG_HEALTH_CACHE_DIR overrides the location; set it to "off" (or "0", "false") to disable.
 */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const custom = env.PKG_HEALTH_CACHE_DIR;
  if (custom !== undefined) return /^(off|0|false|)$/i.test(custom.trim()) ? null : custom;
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "pkg-health-mcp");
}

function diskTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(env.PKG_HEALTH_CACHE_TTL_HOURS);
  return (Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_DISK_TTL_HOURS) * 3_600_000;
}

let diskDisabled = false;

/** Turn the disk cache off for this process (e.g. the CLI's --no-cache flag). */
export function disableDiskCache(): void {
  diskDisabled = true;
}

async function readDisk<T>(key: string): Promise<HttpResult<T> | undefined> {
  const dir = diskDisabled ? null : cacheDir();
  if (!dir) return undefined;
  try {
    const entry = JSON.parse(await readFile(join(dir, `${hash(key)}.json`), "utf8"));
    if (Date.now() - entry.at > diskTtlMs()) return undefined;
    return { ok: entry.ok, status: entry.status, data: entry.data, headers: null };
  } catch {
    return undefined;
  }
}

async function writeDisk(key: string, value: HttpResult<unknown>): Promise<void> {
  const dir = diskDisabled ? null : cacheDir();
  if (!dir) return;
  try {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${hash(key)}.json`);
    // Write then rename so concurrent processes never read a half-written file.
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ at: Date.now(), ok: value.ok, status: value.status, data: value.data }));
    await rename(tmp, file);
  } catch {
    // A read-only or full disk only costs us the cache.
  }
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/**
 * Fetch JSON with a timeout, a 1-hour in-memory cache and an on-disk cache shared across runs.
 * Only successes and 404s are cached; transient failures are retried next time. Never throws.
 */
async function cachedFetch<T>(
  key: string,
  url: string,
  init: RequestInit,
  cacheable: (data: T | null) => boolean = () => true,
): Promise<HttpResult<T>> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return hit.value as HttpResult<T>;
  const disk = await readDisk<T>(key);
  if (disk) {
    memory.set(key, { at: Date.now(), value: disk });
    return disk;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let result: HttpResult<T>;
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let data: T | null = null;
    if (res.ok) {
      try {
        data = (await res.json()) as T;
      } catch {
        data = null;
      }
    }
    result = { ok: res.ok, status: res.status, data, headers: res.headers };
  } catch {
    result = { ok: false, status: 0, data: null, headers: null };
  } finally {
    clearTimeout(timer);
  }

  if ((result.ok && cacheable(result.data)) || result.status === 404) {
    memory.set(key, { at: Date.now(), value: result });
    await writeDisk(key, result);
  }
  return result;
}

export function getJson<T = any>(url: string, headers: Record<string, string> = {}): Promise<HttpResult<T>> {
  return cachedFetch<T>(url, url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
  });
}

/**
 * POST a JSON body (used for GitHub GraphQL). Cached by URL + body, like getJson,
 * except that GraphQL responses carrying `errors` (e.g. rate limits) are never cached.
 */
export function postJson<T = any>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult<T>> {
  const payload = JSON.stringify(body);
  return cachedFetch<T>(`POST ${url} ${payload}`, url, {
    method: "POST",
    body: payload,
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json",
      "content-type": "application/json",
      ...headers,
    },
  }, (data) => !(data as any)?.errors);
}

export function clearCache(): void {
  memory.clear();
}

/** Run async tasks over items with a concurrency limit, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
