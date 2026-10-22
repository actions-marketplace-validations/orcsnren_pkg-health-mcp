# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/orcsnren/pkg-health-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/orcsnren/pkg-health-mcp/releases/tag/v0.1.0
