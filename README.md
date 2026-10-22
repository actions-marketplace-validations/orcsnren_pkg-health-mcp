# pkg-health-mcp

**Is this dependency still maintained? Find out before you install it.**

[![CI](https://github.com/orcsnren/pkg-health-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/orcsnren/pkg-health-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pkg-health-mcp)](https://www.npmjs.com/package/pkg-health-mcp)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)

`pkg-health-mcp` scores **npm packages, PyPI packages and GitHub repositories** from 0 to 100 for maintenance health. It combines release and commit activity, active maintainers, issue response times, download trends, [OpenSSF Scorecard](https://securityscorecards.dev) and license into **an A–F grade and a plain-language list of risks**.

Use it three ways, all built on the same engine:

- **MCP server** for Claude Code, Claude Desktop, Cursor, VS Code and any other MCP client, so your AI agent checks a package *before* it suggests one.
- **CLI** to audit a manifest or lock file, including transitive dependencies.
- **GitHub Action** to add a health report to every pull request and fail the build below a threshold.

```console
$ npx -y pkg-health-mcp scan package.json

F   10/100  request@2.88.2  [npm]
      10  Recent activity        last release 2444d ago
       5  Maintainer diversity   0 active committer(s) in the last 12 months
      10  Issue responsiveness   median 113.2d to first maintainer response, 38% answered (8 issues)
      65  Download trend         171.5M downloads in last 90d (-5% vs previous 90d)
      34  OpenSSF Scorecard      3.4/10
     100  License                Apache-2.0 (permissive)
     !  Deprecated: request has been deprecated, see https://github.com/request/request/issues/3142
     !  No release in 6+ years
     !  No commits in the last 12 months
     !  62% of recent issues got no maintainer response

F   10/100  left-pad@1.3.0  [npm]
     !  Deprecated: use String.prototype.padStart()
     !  Source repository is archived

A   99/100  express@5.3.0  [npm]
     100  Recent activity        last release 12d ago, last commit 4d ago
     100  Maintainer diversity   42 active committer(s) in the last 12 months
     100  Issue responsiveness   median 0.2d to first maintainer response, 87% answered (53 issues)
     100  Download trend         1.6B downloads in last 90d (+22% vs previous 90d)
      85  OpenSSF Scorecard      8.5/10
     100  License                MIT (permissive)
```

---

## Contents

- [Why](#why)
- [Features](#features)
- [Quick start](#quick-start)
- [GitHub token](#github-token)
- [Tools](#tools)
- [Using it with an AI agent](#using-it-with-an-ai-agent)
- [Command line](#command-line)
- [GitHub Action](#github-action)
- [How the score works](#how-the-score-works)
- [Data sources](#data-sources)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Why

A typical project pulls in hundreds of open-source packages. Some of them are quietly abandoned: no releases for years, one maintainer who moved on, issues piling up unanswered. When a vulnerability shows up in one of those, nobody fixes it.

Checking this by hand means opening each package's GitHub page and reading commit dates, issue lists and contributor graphs. Nobody does that for every dependency, and AI coding assistants never do it: they happily suggest whatever library was popular in their training data, including ones deprecated years ago.

`pkg-health-mcp` makes that check a single tool call, so:

- **AI agents** can avoid recommending abandoned libraries and flag risky ones in existing code.
- **Engineering leads** can audit a project's dependencies in seconds.
- **Security and compliance teams** get a repeatable, explainable maintenance signal alongside vulnerability scanners.

## Features

- **Three MCP tools:** score one package, scan a whole manifest, or compare alternatives.
- **npm, PyPI and any GitHub repository.** Pass `owner/repo` or a GitHub URL to score a project that is not published to a registry.
- **Manifests and lock files:** `package.json`, `requirements.txt`, `pyproject.toml` (PEP 621 and Poetry), plus `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock` and `uv.lock` for **transitive dependencies**. Git dependencies on GitHub are scored as repositories.
- **Six signals:** release and commit recency, active committers, time to first maintainer response, download trend, OpenSSF Scorecard, license.
- **CI gating:** `--fail-under <score>`, Markdown output for job summaries, and a ready-made GitHub Action.
- **Disk cache** shared across runs (12 hours by default), so repeated scans cost almost no API calls.
- **Explainable output:** every score comes with per-signal details and a list of concrete risks, not just a number.
- **Honest about missing data:** unreachable APIs lower a `confidence` value instead of the score.
- **No account or API key needed.** An optional `GITHUB_TOKEN` raises GitHub's rate limit.
- **Local and private:** runs on your machine, talks directly to public APIs, no backend and no telemetry.
- **Human, JSON and Markdown output** for terminals, scripts and CI job summaries.

## Quick start

Requires **Node.js 20 or later**. Nothing to install globally: `npx` downloads the package on first run.

### Claude Code

```bash
claude mcp add pkg-health -e GITHUB_TOKEN=github_pat_xxx -- npx -y pkg-health-mcp
```

Leave out `-e GITHUB_TOKEN=…` to run without a token.

### Claude Desktop

Open **Settings → Developer → Edit Config**, or edit the file directly:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pkg-health": {
      "command": "npx",
      "args": ["-y", "pkg-health-mcp"],
      "env": { "GITHUB_TOKEN": "github_pat_xxx" }
    }
  }
}
```

Restart Claude Desktop. The three tools appear under the tools icon.

### Cursor

Add the same block to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project). See [examples/cursor-mcp.json](examples/cursor-mcp.json).

### VS Code

Add to `.vscode/mcp.json`. VS Code asks for the token the first time the server starts, so it never sits in the file. See [examples/vscode-mcp.json](examples/vscode-mcp.json).

```json
{
  "inputs": [
    { "type": "promptString", "id": "github-token", "description": "GitHub token (optional)", "password": true }
  ],
  "servers": {
    "pkg-health": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "pkg-health-mcp"],
      "env": { "GITHUB_TOKEN": "${input:github-token}" }
    }
  }
}
```

### Any other MCP client

The server speaks MCP over **stdio**. Start it with:

```bash
npx -y pkg-health-mcp
```

## GitHub token

The token is optional, but strongly recommended for anything beyond a handful of packages.

| | Without token | With token |
| --- | --- | --- |
| GitHub API limit | 60 requests/hour | 5,000 requests/hour |
| Packages per hour (≈3–5 GitHub calls each) | about 15 | about 1,000+ |
| Time to first maintainer response | not measured (needs GraphQL) | measured |

When the limit is hit, packages are still scored from registry data and the report includes a warning saying so. Responses are cached on disk, so a second scan of the same project within 12 hours makes no GitHub calls at all.

**Creating one:** GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) → *Public repositories (read-only)*, no additional permissions. The token is sent only to `api.github.com`. `GH_TOKEN` is accepted as well.

## Tools

All tools are **read-only** and annotated as such (`readOnlyHint`, `idempotentHint`), so clients can run them without asking for confirmation.

### `check_package`

Score one package.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | — | Package name (`express`, `@types/node`, `requests`) or GitHub repository (`owner/repo` or a `github.com` URL) |
| `ecosystem` | `"npm"` \| `"pypi"` \| `"github"` | `"npm"` | Where to look. `owner/repo` and GitHub URLs are detected automatically |

Returns a one-line summary followed by the full report:

```text
left-pad: 10/100 (F), likely abandoned or unsafe to adopt. Main risk: Deprecated: use String.prototype.padStart().
```

```jsonc
{
  "package": "left-pad",
  "ecosystem": "npm",
  "version": "1.3.0",
  "score": 10,
  "grade": "F",
  "confidence": 1,                // share of the scoring weight backed by real data
  "summary": "left-pad: 10/100 (F), likely abandoned or unsafe to adopt. ...",
  "risks": [
    "Deprecated: use String.prototype.padStart()",
    "Source repository is archived",
    "No release in 8+ years",
    "No commits in the last 12 months"
  ],
  "subscores": [
    { "key": "activity",    "label": "Recent activity",      "weight": 0.3,  "score": 0,   "detail": "Repository is archived (read-only)" },
    { "key": "maintainers", "label": "Maintainer diversity", "weight": 0.2,  "score": 5,   "detail": "0 active committer(s) in the last 12 months" },
    { "key": "issues",      "label": "Issue responsiveness", "weight": 0.15, "score": 15,  "detail": "No issues closed in 12 months, 10 open" },
    { "key": "downloads",   "label": "Download trend",       "weight": 0.15, "score": 100, "detail": "25.9M downloads in last 90d (+57% vs previous 90d)" },
    { "key": "scorecard",   "label": "OpenSSF Scorecard",    "weight": 0.1,  "score": 39,  "detail": "3.9/10" },
    { "key": "license",     "label": "License",              "weight": 0.1,  "score": 100, "detail": "WTFPL (permissive)" }
  ],
  "repository": "https://github.com/left-pad/left-pad",
  "warnings": []
}
```

A deprecated package is capped at 10 even when its downloads are still growing: popularity does not mean anyone is fixing it.

A GitHub repository is scored the same way, with its latest GitHub release as the version. There are no download statistics for a repository, so that signal is left out:

```text
expressjs/express: 98/100 (A), healthy.
```

### `scan_manifest`

Score every dependency in a manifest or lock file and list the riskiest first.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | — | Path to a local manifest or lock file. Only the file names listed below are accepted |
| `content` | string | — | Full text of the file, if not passing `path` |
| `filename` | string | — | Optional, with `content`; used to detect the format. Content sniffing is used otherwise |
| `include_dev` | boolean | `false` | Also score `devDependencies` / optional dependencies |
| `max_packages` | integer | `50` | Upper limit (1–1000) on packages scored |

Pass `path` for lock files: they are often too large to paste into a tool call.

Supported formats:

| File | What is read | What is skipped |
| --- | --- | --- |
| `package.json` | `dependencies`, `peerDependencies`, `optionalDependencies`, `devDependencies` (with `include_dev`), `npm:` aliases, GitHub specs (`owner/repo`, `github:`) | `file:`, `link:`, `workspace:`, non-GitHub git and URL specs |
| `requirements*.txt`, `requirements*.in` | Package names with extras, version specifiers and environment markers; `git+https://github.com/…` URLs | `-r`, `--index-url` and other options, other URLs, local paths |
| `pyproject.toml` | PEP 621 `[project] dependencies` and `optional-dependencies`; Poetry `[tool.poetry.dependencies]` and dev groups | `python` itself |
| `package-lock.json`, `npm-shrinkwrap.json` | Every installed package (lockfile v1, v2, v3), with `dev` flags | Linked workspaces, bundled packages |
| `yarn.lock` | Every entry (Yarn 1 and Berry), `npm:` aliases, patches | Workspaces, `file:`, `link:`, `portal:`. Yarn does not record dev-only packages |
| `pnpm-lock.yaml` | The `packages:` section (lockfile v5, v6, v9), with `dev` flags where recorded | Local and tarball dependencies |
| `poetry.lock`, `uv.lock` | Every `[[package]]`, Poetry's `category = "dev"` | The project itself, editable, path and URL sources |

Lock files include transitive dependencies, so they often list several hundred packages. Raise `max_packages`, and set a GitHub token.

Example response header:

```text
Scanned 5 package(s). Grades: A=2, B=1, F=2. Needs attention: request (10), left-pad (10).
```

followed by `{ scanned, total_dependencies, grades, packages: [...] }`, with each package in a compact form (`score`, `grade`, `confidence`, `risks`, `signals`, `repository`).

### `compare_packages`

Rank 2–5 alternatives from the same registry, or GitHub repositories.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `packages` | string[] | — | 2 to 5 package names or `owner/repo` repositories |
| `ecosystem` | `"npm"` \| `"pypi"` \| `"github"` | `"npm"` | Where to look |

```text
Healthiest: axios (92/100, A). Ranking: axios 92 > got 86 > request 10
```

followed by `{ ranking: [...] }` in the same compact form.

## Using it with an AI agent

Once the server is connected, ask in plain language. Some prompts that work well:

- *"Before you add a date library, compare dayjs, date-fns and luxon with pkg-health."*
- *"Scan this project's package.json and tell me which dependencies look abandoned."*
- *"Is the `nose` package still maintained? If not, what should I migrate to?"*
- *"Is github.com/some-org/some-tool still alive? I want to vendor it."*
- *"Scan package-lock.json, including transitive dependencies, and list everything graded F."*
- *"Check every package in requirements.txt and make a checklist of the ones graded D or F."*

To make it automatic, add a line to your project instructions (`CLAUDE.md`, `.cursorrules`, Copilot instructions…):

```markdown
Before adding a new npm or PyPI dependency, call the pkg-health `check_package` tool.
Do not add packages graded D or F without asking me first, and mention any risks it reports.
```

## Command line

The same engine runs without an MCP client.

```bash
# Score one or more npm packages
npx -y pkg-health-mcp check express lodash

# PyPI packages
npx -y pkg-health-mcp check requests flask --pypi

# Any GitHub repository (owner/repo or URL)
npx -y pkg-health-mcp check expressjs/express https://github.com/pallets/flask

# Every dependency in a manifest, worst first
npx -y pkg-health-mcp scan ./package.json
npx -y pkg-health-mcp scan ./pyproject.toml --dev

# Transitive dependencies from a lock file
npx -y pkg-health-mcp scan ./package-lock.json
npx -y pkg-health-mcp scan ./uv.lock --max 300

# Fail (exit code 1) if anything scores below 50
npx -y pkg-health-mcp scan ./package.json --fail-under 50

# Machine-readable or Markdown output
npx -y pkg-health-mcp check express --json
npx -y pkg-health-mcp scan ./package.json --markdown >> "$GITHUB_STEP_SUMMARY"
```

| Command / flag | Description |
| --- | --- |
| *(no arguments)* | Start the MCP server on stdio |
| `check <name...>` | Score packages (npm unless `--pypi`) or GitHub repositories (`owner/repo`, URLs) |
| `scan <file>` | Score every dependency in a manifest or lock file |
| `--pypi` | Treat `check` arguments as PyPI packages |
| `--github` | Treat `check` arguments as GitHub repositories (only needed for unusual inputs) |
| `--dev` | Include dev and optional dependencies in `scan` |
| `--max <n>` | Score at most `n` packages in `scan` |
| `--fail-under <n>` | Exit with code 1 if any package scores below `n`. Packages that could not be scored do not fail the run, but are counted in the message |
| `--json` | Print the full reports as JSON |
| `--markdown` | Print a Markdown table, e.g. for `$GITHUB_STEP_SUMMARY` |
| `--no-cache` | Ignore the on-disk cache for this run |
| `--help`, `--version` | |

In the human-readable output, `!` marks a risk and `~` a data warning. Exit codes: `0` success, `1` a package fell below `--fail-under` (or an error), `2` invalid arguments.

### Cache

API responses are cached on disk for **12 hours** in `~/.cache/pkg-health-mcp` (or `$XDG_CACHE_HOME/pkg-health-mcp`), shared by the CLI and the MCP server. Only successful responses and 404s are cached.

| Variable | Default | Description |
| --- | --- | --- |
| `PKG_HEALTH_CACHE_DIR` | `~/.cache/pkg-health-mcp` | Cache location. Set to `off` to disable the disk cache |
| `PKG_HEALTH_CACHE_TTL_HOURS` | `12` | How long cached responses are reused |

## GitHub Action

Add a dependency health report to every pull request, and optionally fail the job:

```yaml
name: Dependency health
on: [pull_request]

jobs:
  pkg-health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: orcsnren/pkg-health-mcp@v0.2.0
        with:
          manifest: package-lock.json   # or package.json, yarn.lock, pnpm-lock.yaml, requirements.txt, poetry.lock, uv.lock …
          fail-under: 40                # leave out to report without failing
          max-packages: 300
```

| Input | Default | Description |
| --- | --- | --- |
| `manifest` | `package.json` | File to scan |
| `fail-under` | *(empty)* | Fail if any dependency scores below this value |
| `include-dev` | `false` | Also score dev dependencies |
| `max-packages` | *(empty)* | Score at most this many packages |
| `github-token` | `${{ github.token }}` | Token for GitHub API calls |

The table of results is written to the job summary. Without the Action, the CLI does the same in any CI system:

```yaml
- name: Dependency health
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npx -y pkg-health-mcp scan package.json --fail-under 40 --markdown >> "$GITHUB_STEP_SUMMARY"
```

## How the score works

Six signals are scored from 0 to 100 and combined with these weights:

| Signal | Weight | What is measured |
| --- | ---: | --- |
| Recent activity | 30% | Days since the latest release or commit, whichever is more recent |
| Maintainer diversity | 20% | Unique human committers in the last 12 months (bus factor) |
| Issue responsiveness | 15% | Median time to the first maintainer response (with a token), otherwise median time to close |
| Download trend | 15% | Downloads in the last 90 days vs. the 90 days before |
| OpenSSF Scorecard | 10% | Independent security-practice score |
| License | 10% | Permissive, copyleft, proprietary or missing |

- Signals without data are **left out** and the remaining weights are rescaled. `confidence` reports how much of the weight was backed by data.
- **Hard caps:** deprecated packages score at most 10, archived repositories at most 15.
- **Grades:** A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, F below 35.

Every threshold, edge case and known blind spot is documented in **[docs/scoring.md](docs/scoring.md)**.

## Data sources

All public, no authentication required.

| Data | Source | Notes |
| --- | --- | --- |
| npm metadata | `registry.npmjs.org` | Latest version, release date, deprecation, license, maintainers, repository |
| npm downloads | `api.npmjs.org/downloads/range/last-year` | Daily downloads, last 180 days used |
| PyPI metadata | `pypi.org/pypi/<name>/json` | Version, upload time, license, classifiers, project URLs |
| PyPI downloads | `pypistats.org` | Daily downloads without mirrors (~180 days kept) |
| Repository activity | `api.github.com` (REST) | Archived flag, license, latest release, commits of the last 12 months, recently closed issues |
| First maintainer response | `api.github.com/graphql` | Comments on the 60 most recent issues; needs a token |
| OpenSSF Scorecard | `api.deps.dev` | Overall Scorecard result for the repository |

Responses are cached in memory for one hour and on disk for 12 hours (see [Cache](#cache)), and at most four packages are analysed at a time.

## Limitations

- **Maintenance, not security.** This does not look for known vulnerabilities. Pair it with `npm audit`, `pip-audit` or [OSV](https://osv.dev).
- **"Done" is not "dead".** A small, feature-complete utility can be safe with no commits for years. The score will flag it anyway; read the risks before acting.
- **Repository data comes from GitHub.** Packages hosted on GitLab, Codeberg or self-hosted forges are scored from registry data, with lower confidence.
- **Monorepos** share their activity with every package published from them.
- **Large lock files are slow on a cold cache.** A lock file with 800 packages needs a few thousand API calls the first time. Use a token and `--max`, or let the cache warm up.
- **Maintainer responses are attributed by GitHub role.** Only replies from owners, organization members and collaborators count. Projects triaged by community members can look less responsive than they are.

## FAQ

**Does it send my code or manifest anywhere?**
No. Only package names leave your machine, as part of the public API URLs listed above. See [SECURITY.md](SECURITY.md).

**Do I need the MCP server at all?**
No. The CLI and the GitHub Action use the same engine. The MCP server is what lets an AI agent check a package *before* it suggests one, which is where abandoned dependencies usually come from.

**Why did a package I know is fine get a low score?**
Look at `risks` and `subscores`; they say exactly which signal pulled it down. If the score is still wrong, please [open a "wrong score" issue](https://github.com/orcsnren/pkg-health-mcp/issues/new?template=wrong-score.yml). Those reports are how the thresholds get tuned.

**What does `confidence` mean?**
The share of the scoring weight that was backed by real data. 1.0 means all six signals were available. Below 0.6 the summary says "low confidence".

**How is this different from OpenSSF Scorecard, deps.dev or Socket?**
Scorecard grades a repository's security practices; this tool uses it as one input. deps.dev and Socket are excellent websites and services. `pkg-health-mcp` focuses on one question, *is this still maintained?*, and makes the answer available inside AI agents as a tool call, with a single explainable score across ecosystems.

**Can I use it commercially?**
Yes. It is licensed under Apache 2.0.

## Development

Requires Node.js 22+ for the test runner.

```bash
git clone https://github.com/orcsnren/pkg-health-mcp
cd pkg-health-mcp
npm install       # also builds dist/
npm test          # offline unit tests
npm run typecheck
node dist/index.js check express
```

Try the tools interactively with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Project layout:

```
src/
├── index.ts          CLI entry point; starts the MCP server when run without arguments
├── server.ts         MCP tool definitions
├── analyze.ts        Gathers facts for a package from all sources
├── score.ts          Pure scoring functions
├── manifest.ts       Manifest and lock file parsing
├── http.ts           fetch with timeout, memory + disk cache and concurrency limit
├── types.ts
└── sources/
    ├── npm.ts        Registry metadata and download statistics
    ├── pypi.ts       PyPI JSON API and pypistats
    ├── github.ts     Repository, commits, issues, releases, first responses (GraphQL)
    ├── scorecard.ts  OpenSSF Scorecard via deps.dev
    └── repo-url.ts   Normalizes the many shapes of repository URLs
docs/
├── scoring.md        Full scoring methodology
└── architecture.md   How the pieces fit together, and how to add an ecosystem
examples/             Client configurations and sample manifests
```

## Contributing

Bug reports, scoring feedback and pull requests are welcome. If a package you know well gets a grade that feels wrong, a [wrong score report](https://github.com/orcsnren/pkg-health-mcp/issues/new?template=wrong-score.yml) is the most useful thing you can send. New ecosystems (Maven Central, Go modules, crates.io, RubyGems) and repository hosts are good first contributions; [docs/architecture.md](docs/architecture.md#adding-an-ecosystem) lists the steps.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and guidelines.

## License

[Apache License 2.0](LICENSE)
