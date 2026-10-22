const TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "pkg-health-mcp (+https://github.com/orcsnren/pkg-health-mcp)";

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  headers: Headers | null;
}

const cache = new Map<string, { at: number; value: HttpResult<unknown> }>();

/** GET a JSON endpoint with timeout and a 1-hour in-memory cache. Never throws. */
export async function getJson<T = any>(
  url: string,
  headers: Record<string, string> = {},
): Promise<HttpResult<T>> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as HttpResult<T>;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let result: HttpResult<T>;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
      signal: controller.signal,
    });
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

  // Cache successes and definitive "not found"s; retry transient failures next time.
  if (result.ok || result.status === 404) cache.set(url, { at: Date.now(), value: result });
  return result;
}

export function clearCache(): void {
  cache.clear();
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
