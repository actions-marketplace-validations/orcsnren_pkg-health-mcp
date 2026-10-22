import { getJson } from "../http.js";

/** OpenSSF Scorecard overall score (0-10) via deps.dev, if the project has been scanned. */
export async function fetchScorecard(owner: string, repo: string): Promise<number | undefined> {
  const id = encodeURIComponent(`github.com/${owner}/${repo}`.toLowerCase());
  const res = await getJson<any>(`https://api.deps.dev/v3/projects/${id}`);
  const score = res.data?.scorecard?.overallScore;
  return typeof score === "number" ? score : undefined;
}
