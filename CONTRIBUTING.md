# Contributing

Thanks for your interest in improving `pkg-health-mcp`. Bug reports, scoring feedback and pull requests are all welcome.

## Ways to help

- **Report a wrong score.** If a package you know well gets a grade that feels wrong, open an issue with the package name, the output (`pkg-health-mcp check <name> --json`) and why you disagree. These reports are the main way the thresholds get tuned.
- **Add an ecosystem.** Maven Central, Go modules, crates.io and RubyGems would all be welcome. See [docs/architecture.md](docs/architecture.md#adding-an-ecosystem) for the steps.
- **Add a repository host.** GitLab and Codeberg support would let packages hosted there get full scores.
- **Add a manifest format.** `Pipfile.lock`, `setup.cfg`, `bun.lock` and workspace layouts are good candidates; see the existing parsers in `src/manifest.ts`.
- **Docs and examples.** Configuration snippets for other MCP clients are always useful.

## Development setup

Requires Node.js 22+ for the test runner (the published server itself runs on Node 20+).

```bash
git clone https://github.com/orcsnren/pkg-health-mcp
cd pkg-health-mcp
npm install          # also builds dist/ via the prepare script
npm test             # unit tests, offline
npm run typecheck
```

Try your changes from the command line:

```bash
npm run build
node dist/index.js check express
node dist/index.js check requests --pypi
node dist/index.js scan examples/manifests/package.json
```

Or against a real MCP client by pointing it at your local build:

```json
{
  "mcpServers": {
    "pkg-health-dev": {
      "command": "node",
      "args": ["/absolute/path/to/pkg-health-mcp/dist/index.js"]
    }
  }
}
```

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is handy for calling tools by hand:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Guidelines

- **Keep parsers pure.** API responses go through a `parse…` or `summarize…` function that takes plain JSON. Add a test with a trimmed, realistic response for every new field you read.
- **Missing data is `null`.** A network failure must never lower a package's score; it lowers `confidence` and adds a warning.
- **Scoring changes need a reason.** If you change a weight or threshold, update [docs/scoring.md](docs/scoring.md) in the same pull request and explain the change with real packages that were scored badly before.
- **No new runtime dependencies** without discussion. The server currently depends only on the MCP SDK and zod.
- **No API keys required.** Every feature must work anonymously; tokens may only raise limits.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change with tests.
3. Run `npm run typecheck && npm test`.
4. Describe user-facing changes in [CHANGELOG.md](CHANGELOG.md), under an `## [Unreleased]` heading at the top.
5. Open the pull request and describe what changed and why.

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
