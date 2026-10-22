# Architecture

```
            MCP client (Claude, Cursor, VS Code…)          CLI (pkg-health-mcp check …)
                          │ stdio                                   │
                          ▼                                         ▼
                   src/server.ts  ── tools ──┐              src/index.ts   (also used by action.yml)
                                             ▼                      │
                                      src/analyze.ts  ◄─────────────┘
                     gatherFacts()  ──►  PackageFacts  ──►  buildReport()  (src/score.ts)
                          │
     ┌──────────────┬─────┴────────┬──────────────────┬───────────────────┐
     ▼              ▼              ▼                  ▼                   ▼
 sources/npm    sources/pypi   sources/github    sources/scorecard   src/manifest.ts
 registry +     PyPI JSON +    repo, commits,    deps.dev            manifests and
 downloads API  pypistats      issues, releases  (OpenSSF)           lock files
                               (REST) + first
                               responses (GraphQL)
                          │
                          ▼
                     src/http.ts   memory cache (1 h) → disk cache (12 h) → fetch
```

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| Transport | `src/index.ts`, `src/server.ts` | Start the stdio MCP server or run CLI commands; define tool schemas with zod |
| Orchestration | `src/analyze.ts` | Resolve the target (package or repository), fetch everything in parallel, follow the repository link, collect warnings |
| Data sources | `src/sources/*.ts` | One file per external API; each exposes a fetcher and a pure parser |
| Scoring | `src/score.ts` | Pure functions from `PackageFacts` to `HealthReport`; no I/O |
| Parsing | `src/manifest.ts` | Turn manifests and lock files into a deduplicated list of `{ name, ecosystem }`; GitHub git dependencies become `ecosystem: "github"` |
| HTTP | `src/http.ts` | `fetch` with a 15 s timeout, in-memory and on-disk caches, concurrency limiter |

## Design decisions

- **Pure parsers and scorers.** Every source has a `parse…`/`summarize…` function that takes raw API JSON. Tests feed recorded shapes into those functions, so the suite runs offline and fast.
- **Missing data is `null`, never zero.** Network failures, rate limits and unscanned projects reduce `confidence` rather than the score.
- **No API keys required.** Everything works anonymously. `GITHUB_TOKEN` raises GitHub's rate limit and enables the time-to-first-response signal, because GitHub's GraphQL API always needs a token.
- **Runs on the user's machine.** The MCP server has no backend. Requests go straight from the user's computer to the public APIs.
- **Two cache levels.** Successful responses and 404s are kept in memory for an hour and on disk for 12 hours (`~/.cache/pkg-health-mcp`, one JSON file per request, written atomically). Repeated CLI runs and CI jobs reuse each other's results. Rate-limit and network errors are never cached. Time windows in URLs are rounded to the day so cache keys stay stable. `PKG_HEALTH_CACHE_DIR=off` or `--no-cache` turns the disk cache off.
- **Repositories as first-class targets.** `resolveTarget()` recognises `owner/repo` and GitHub URLs, and `gatherFacts()` then skips the registry and reads the repository directly, including its latest release.
- **Bounded concurrency.** `scan_manifest` and `compare_packages` analyse at most 4 packages at a time to stay polite to public APIs.

## Adding an ecosystem

1. Add a value to `Ecosystem` in `src/types.ts`.
2. Create `src/sources/<ecosystem>.ts` with a fetcher that returns registry facts and, if possible, download statistics.
3. Branch on the new ecosystem in `gatherFacts()` in `src/analyze.ts`.
4. Teach `src/manifest.ts` to read its manifest and lock file formats, and add them to `MANIFEST_FILES`.
5. Add the value to the `ecosystem` enum in `src/server.ts` and a flag in `src/index.ts`.
6. Add parser tests with a recorded API response.
