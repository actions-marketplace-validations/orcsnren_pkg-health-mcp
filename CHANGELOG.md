# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-22

### Added

- Score any GitHub repository: `owner/repo` or a GitHub URL in `check_package`, `compare_packages` and `check`, plus `ecosystem: "github"`. Git dependencies on GitHub in manifests and lock files are scored as repositories.
- Lock file support for transitive dependencies: `package-lock.json` / `npm-shrinkwrap.json` (v1–v3), `yarn.lock` (Yarn 1 and Berry), `pnpm-lock.yaml` (v5, v6, v9), `poetry.lock` and `uv.lock`.
- `scan_manifest` accepts a `path` to a local manifest or lock file; `max_packages` now goes up to 1000.
- Time to first maintainer response, from GitHub GraphQL when a token is set, with a risk flag for projects that leave most issues unanswered.
- On-disk cache shared across runs (12 hours by default), configurable with `PKG_HEALTH_CACHE_DIR` and `PKG_HEALTH_CACHE_TTL_HOURS`, and `--no-cache`.
- CLI flags `--fail-under`, `--markdown`, `--max`, `--github`, `--help` and `--version`, with distinct exit codes.
- A composite GitHub Action (`action.yml`) that writes a report to the job summary and can fail the job.
- Published to npm: `npx -y pkg-health-mcp`.

### Changed

- Maintainer diversity pages through up to 500 commits of the last year instead of reading 100.
- A repository that GitHub could not be reached for is reported as "could not be checked" instead of "not found".

## [0.1.0] - 2026-10-22

### Added

- MCP server over stdio with three read-only tools: `check_package`, `scan_manifest` and `compare_packages`.
- npm and PyPI support.
- Six scoring signals: recent activity, maintainer diversity, issue responsiveness, download trend, OpenSSF Scorecard and license.
- Hard caps for deprecated packages and archived repositories.
- Manifest parsing for `package.json`, `requirements.txt` and `pyproject.toml` (PEP 621 and Poetry).
- Command-line mode: `check`, `scan`, `--pypi`, `--dev`, `--json`.
- Optional `GITHUB_TOKEN` for higher GitHub rate limits.
- 1-hour in-memory response cache and a concurrency limit of 4.

[0.2.0]: https://github.com/orcsnren/pkg-health-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/orcsnren/pkg-health-mcp/releases/tag/v0.1.0
