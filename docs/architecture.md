# Architecture

```
            MCP client (Claude, Cursor, VS Code…)          CLI (pkg-health-mcp check …)
                          │ stdio                                   │
                          ▼                                         ▼
                   src/server.ts  ── tools ──┐              src/index.ts
                                             ▼                      │
                                      src/analyze.ts  ◄─────────────┘
                     gatherFacts()  ──►  PackageFacts  ──►  buildReport()  (src/score.ts)
                          │
     ┌──────────────┬─────┴────────┬──────────────────┬───────────────────┐
     ▼              ▼              ▼                  ▼                   ▼
 sources/npm    sources/pypi   sources/github    sources/scorecard   src/manifest.ts
 registry +     PyPI JSON +    repo, commits,    deps.dev            package.json,
 downloads API  pypistats      closed issues     (OpenSSF)           requirements.txt,
                                                                     pyproject.toml
```

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| Transport | `src/index.ts`, `src/server.ts` | Start the stdio MCP server or run CLI commands; define tool schemas with zod |
| Orchestration | `src/analyze.ts` | Fetch everything for one package in parallel, follow the repository link, collect warnings |
| Data sources | `src/sources/*.ts` | One file per external API; each exposes a fetcher and a pure parser |
| Scoring | `src/score.ts` | Pure functions from `PackageFacts` to `HealthReport`; no I/O |
| Parsing | `src/manifest.ts` | Turn manifest files into a list of `{ name, ecosystem }` |
| HTTP | `src/http.ts` | `fetch` with a 15 s timeout, 1-hour in-memory cache, concurrency limiter |

## Design decisions

- **Pure parsers and scorers.** Every source has a `parse…`/`summarize…` function that takes raw API JSON. Tests feed recorded shapes into those functions, so the suite runs offline and fast.
- **Missing data is `null`, never zero.** Network failures, rate limits and unscanned projects reduce `confidence` rather than the score.
- **No API keys required.** Everything works anonymously; `GITHUB_TOKEN` only raises GitHub's rate limit.
- **Runs on the user's machine.** The MCP server has no backend. Requests go straight from the user's computer to the public APIs.
- **Cache per process.** Successful responses and 404s are cached for an hour, so an agent that checks the same package several times in a session costs one set of API calls.
- **Bounded concurrency.** `scan_manifest` and `compare_packages` analyse at most 4 packages at a time to stay polite to public APIs.

## Adding an ecosystem

1. Add a value to `Ecosystem` in `src/types.ts`.
2. Create `src/sources/<ecosystem>.ts` with a fetcher that returns registry facts and, if possible, download statistics.
3. Branch on the new ecosystem in `gatherFacts()` in `src/analyze.ts`.
4. Teach `src/manifest.ts` to read its manifest format.
5. Add the value to the `ecosystem` enum in `src/server.ts` and a flag in `src/index.ts`.
6. Add parser tests with a recorded API response.
