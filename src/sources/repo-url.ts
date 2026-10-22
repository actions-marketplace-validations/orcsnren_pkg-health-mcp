/** Extract { owner, repo } from the many shapes a GitHub URL takes in package metadata. */
export function parseGitHubRepo(input: unknown): { owner: string; repo: string } | null {
  if (!input) return null;
  let s = typeof input === "string" ? input : (input as { url?: string }).url;
  if (!s || typeof s !== "string") return null;
  s = s.trim();

  // npm shorthand: "github:owner/repo" or bare "owner/repo"
  const shorthand = s.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (shorthand && !s.includes("://") && !s.includes("@")) {
    return { owner: shorthand[1], repo: shorthand[2] };
  }

  const m = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m) return null;
  const repo = m[2];
  if (!repo || repo === "." || repo === "..") return null;
  return { owner: m[1], repo };
}
