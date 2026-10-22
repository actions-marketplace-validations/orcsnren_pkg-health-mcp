# pkg-health-mcp

[![CI](https://github.com/orcsnren/pkg-health-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/orcsnren/pkg-health-mcp/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)

**Is this package still maintained?** An [MCP](https://modelcontextprotocol.io) server and CLI that answers that question for npm and PyPI packages, before you or your AI agent add one as a dependency.

It reads public data from the package registry, the linked GitHub repository, download statistics and [OpenSSF Scorecard](https://securityscorecards.dev), and turns it into a **0–100 score, an A–F grade and a plain-language list of risks**.

```
$ npx -y github:orcsnren/pkg-health-mcp scan package.json

F   10/100  request@2.88.2  [npm]
      10  Recent activity        last release 2444d ago
      70  Maintainer diversity   4 registry maintainer(s)
     ...
     !  Deprecated: request has been deprecated, see https://github.com/request/request/issues/3142
     !  No release in 6+ years

F   10/100  left-pad@1.3.0  [npm]
     !  Deprecated: use String.prototype.padStart()
     !  No release in 8+ years

...

A   93/100  express@5.3.0  [npm]
     100  Recent activity        last release 12d ago
     ...
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
- [How the score works](#how-the-score-works)
- [Data sources](#data-sources)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Development](#development)
- [Roadmap](#roadmap)
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
- **npm and PyPI**, with manifest parsing for `package.json`, `requirements.txt` and `pyproject.toml` (PEP 621 and Poetry).
- **Six signals:** release and commit recency, active committers, issue close time, download trend, OpenSSF Scorecard, license.
- **Explainable output:** every score comes with per-signal details and a list of concrete risks, not just a number.
- **Honest about missing data:** unreachable APIs lower a `confidence` value instead of the score.
- **No account or API key needed.** An optional `GITHUB_TOKEN` raises GitHub's rate limit.
- **Local and private:** runs on your machine, talks directly to public APIs, no backend and no telemetry.
- **Also a CLI** with human-readable and JSON output, for scripts and CI.

## Quick start

Requires **Node.js 20 or later**. Nothing to install globally: `npx` fetches and builds the server on first run.

### Claude Code

```bash
claude mcp add pkg-health -e GITHUB_TOKEN=github_pat_xxx -- npx -y github:orcsnren/pkg-health-mcp
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
      "args": ["-y", "github:orcsnren/pkg-health-mcp"],
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
      "args": ["-y", "github:orcsnren/pkg-health-mcp"],
      "env": { "GITHUB_TOKEN": "${input:github-token}" }
    }
  }
}
```

### Any other MCP client

The server speaks MCP over **stdio**. Start it with:

```bash
npx -y github:orcsnren/pkg-health-mcp
```

## GitHub token

The token is optional, but strongly recommended for anything beyond a handful of packages.

| | Without token | With token |
| --- | --- | --- |
| GitHub API limit | 60 requests/hour | 5,000 requests/hour |
| Packages per hour (≈3 GitHub calls each) | about 20 | about 1,600 |

When the limit is hit, packages are still scored from registry data and the report includes a warning saying so.

**Creating one:** GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) → *Public repositories (read-only)*, no additional permissions. The token is sent only to `api.github.com`. `GH_TOKEN` is accepted as well.

## Tools

All tools are **read-only** and annotated as such (`readOnlyHint`, `idempotentHint`), so clients can run them without asking for confirmation.

### `check_package`

Score one package.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | — | Package name, e.g. `express`, `@types/node`, `requests` |
| `ecosystem` | `"npm"` \| `"pypi"` | `"npm"` | Registry to look in |

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
  "confidence": 0.6,              // share of the scoring weight backed by real data
  "summary": "left-pad: 10/100 (F), likely abandoned or unsafe to adopt. ...",
  "risks": [
    "Deprecated: use String.prototype.padStart()",
    "No release in 8+ years"
  ],
  "subscores": [
    { "key": "activity",    "label": "Recent activity",      "weight": 0.3,  "score": 10,   "detail": "last release 3117d ago" },
    { "key": "maintainers", "label": "Maintainer diversity", "weight": 0.2,  "score": 55,   "detail": "2 registry maintainer(s); no GitHub data" },
    { "key": "issues",      "label": "Issue responsiveness", "weight": 0.15, "score": null, "detail": "No issue data" },
    { "key": "downloads",   "label": "Download trend",       "weight": 0.15, "score": null, "detail": "No download statistics" },
    { "key": "scorecard",   "label": "OpenSSF Scorecard",    "weight": 0.1,  "score": null, "detail": "Not scanned by OpenSSF Scorecard" },
    { "key": "license",     "label": "License",              "weight": 0.1,  "score": 100,  "detail": "WTFPL (permissive)" }
  ],
  "repository": "https://github.com/stevemao/left-pad",
  "warnings": ["Download statistics unavailable", "GitHub repository could not be read"]
}
```

> The examples in this README were recorded on a network where GitHub and download-statistics APIs were blocked, which is why some signals are `null` and `confidence` is 0.6. On a normal connection those signals are filled in and confidence is usually 0.9–1.0.

### `scan_manifest`

Score every dependency in a manifest file and list the riskiest first.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | string | — | Full text of the manifest |
| `filename` | string | — | Optional; used to detect the format. Content sniffing is used otherwise |
| `include_dev` | boolean | `false` | Also score `devDependencies` / optional dependencies |
| `max_packages` | integer | `50` | Upper limit (1–200) on packages scored |

Supported formats:

| File | What is read | What is skipped |
| --- | --- | --- |
| `package.json` | `dependencies`, `peerDependencies`, `optionalDependencies`, `devDependencies` (with `include_dev`), `npm:` aliases | `file:`, `link:`, `workspace:`, git and URL specs |
| `requirements*.txt`, `requirements*.in` | Package names with extras, version specifiers and environment markers | `-r`, `-e`, `--index-url` and other options, URLs, local paths |
| `pyproject.toml` | PEP 621 `[project] dependencies` and `optional-dependencies`; Poetry `[tool.poetry.dependencies]` and dev groups | `python` itself |

Example response header:

```text
Scanned 5 package(s). Grades: A=2, B=1, F=2. Needs attention: request (10), left-pad (10).
```

followed by `{ scanned, total_dependencies, grades, packages: [...] }`, with each package in a compact form (`score`, `grade`, `confidence`, `risks`, `signals`, `repository`).

### `compare_packages`

Rank 2–5 alternatives from the same registry.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `packages` | string[] | — | 2 to 5 package names |
| `ecosystem` | `"npm"` \| `"pypi"` | `"npm"` | Registry to look in |

```text
Healthiest: got (78/100, B). Ranking: got 78 > axios 73 > request 10
```

followed by `{ ranking: [...] }` in the same compact form.

## Using it with an AI agent

Once the server is connected, ask in plain language. Some prompts that work well:

- *"Before you add a date library, compare dayjs, date-fns and luxon with pkg-health."*
- *"Scan this project's package.json and tell me which dependencies look abandoned."*
- *"Is the `nose` package still maintained? If not, what should I migrate to?"*
- *"Check every package in requirements.txt and open a TODO list for the ones graded D or F."*

To make it automatic, add a line to your project instructions (`CLAUDE.md`, `.cursorrules`, Copilot instructions…):

```markdown
Before adding a new npm or PyPI dependency, call the pkg-health `check_package` tool.
Do not add packages graded D or F without asking me first, and mention any risks it reports.
```

## Command line

The same engine runs without an MCP client.

```bash
# Score one or more npm packages
npx -y github:orcsnren/pkg-health-mcp check express lodash

# PyPI packages
npx -y github:orcsnren/pkg-health-mcp check requests flask --pypi

# Every dependency in a manifest, worst first
npx -y github:orcsnren/pkg-health-mcp scan ./package.json
npx -y github:orcsnren/pkg-health-mcp scan ./requirements.txt
npx -y github:orcsnren/pkg-health-mcp scan ./pyproject.toml --dev

# Machine-readable output
npx -y github:orcsnren/pkg-health-mcp check express --json
```

| Command / flag | Description |
| --- | --- |
| *(no arguments)* | Start the MCP server on stdio |
| `check <pkg...>` | Score packages (npm unless `--pypi`) |
| `scan <file>` | Score every dependency in a manifest |
| `--pypi` | Treat `check` arguments as PyPI packages |
| `--dev` | Include dev and optional dependencies in `scan` |
| `--json` | Print the full reports as JSON |
| `--help`, `--version` | |

In the human-readable output, `!` marks a risk and `~` a data warning.

### In CI

```yaml
- name: Dependency health report
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npx -y github:orcsnren/pkg-health-mcp scan package.json
```

The CLI reports but does not fail the build. To gate on grades, use `--json` with `jq`:

```bash
npx -y github:orcsnren/pkg-health-mcp scan package.json --json \
  | jq -e '[.[] | select(.grade == "F")] | length == 0'
```

## How the score works

Six signals are scored from 0 to 100 and combined with these weights:

| Signal | Weight | What is measured |
| --- | ---: | --- |
| Recent activity | 30% | Days since the latest release or commit, whichever is more recent |
| Maintainer diversity | 20% | Unique human committers in the last 12 months (bus factor) |
| Issue responsiveness | 15% | Median days to close an issue, over the last 12 months |
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
| Repository activity | `api.github.com` | Archived flag, recent commits, recently closed issues |
| OpenSSF Scorecard | `api.deps.dev` | Overall Scorecard result for the repository |

Responses are cached in memory for one hour per process, and at most four packages are analysed at a time.

## Limitations

- **Maintenance, not security.** This does not look for known vulnerabilities. Pair it with `npm audit`, `pip-audit` or [OSV](https://osv.dev).
- **"Done" is not "dead".** A small, feature-complete utility can be safe with no commits for years. The score will flag it anyway; read the risks before acting.
- **GitHub only.** Repositories on GitLab, Codeberg or self-hosted forges are not read yet; those packages are scored from registry data with lower confidence.
- **Monorepos** share their activity with every package published from them.
- **Direct dependencies only.** Transitive dependencies in lock files are not scanned yet.

## FAQ

**Does it send my code or manifest anywhere?**
No. Only package names leave your machine, as part of the public API URLs listed above. See [SECURITY.md](SECURITY.md).

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
├── manifest.ts       package.json / requirements.txt / pyproject.toml parsing
├── http.ts           fetch with timeout, cache and concurrency limit
├── types.ts
└── sources/
    ├── npm.ts        Registry metadata and download statistics
    ├── pypi.ts       PyPI JSON API and pypistats
    ├── github.ts     Repository, commits and issues
    ├── scorecard.ts  OpenSSF Scorecard via deps.dev
    └── repo-url.ts   Normalizes the many shapes of repository URLs
docs/
├── scoring.md        Full scoring methodology
└── architecture.md   How the pieces fit together, and how to add an ecosystem
examples/             Client configurations and sample manifests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

- [ ] Publish to the npm registry (`npx pkg-health-mcp`)
- [ ] Maven Central (`pom.xml`, `build.gradle`)
- [ ] Go modules, crates.io, RubyGems
- [ ] Time to first maintainer response, not only time to close
- [ ] Transitive dependencies from lock files
- [ ] GitLab and Codeberg repositories
- [ ] `--fail-under <score>` flag for CI gating
- [ ] Hosted version for bulk scans without a token

Suggestions are welcome in [issues](https://github.com/orcsnren/pkg-health-mcp/issues).

## License

[Apache License 2.0](LICENSE)
