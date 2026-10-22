# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's [private vulnerability reporting](https://github.com/orcsnren/pkg-health-mcp/security/advisories/new) instead. You should get a first response within a week.

## What this tool does with your data

- It only reads **public** data: npm and PyPI registry metadata, public GitHub repositories, download statistics and OpenSSF Scorecard results.
- Requests go directly from your machine to those APIs. There is no backend, no telemetry and no logging to any third party.
- When you pass a manifest to `scan_manifest`, only the package **names** are sent anywhere (as part of the public API URLs above). Version ranges, scripts and other manifest contents never leave your machine.
- `GITHUB_TOKEN`, if set, is sent only to `api.github.com`. A fine-grained token with read-only access to public repositories is enough; do not give it write or private-repository scopes.

## Supported versions

Only the latest release receives fixes.
