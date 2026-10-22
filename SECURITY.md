# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's [private vulnerability reporting](https://github.com/orcsnren/pkg-health-mcp/security/advisories/new) instead. You should get a first response within a week.

## What this tool does with your data

- It only reads **public** data: npm and PyPI registry metadata, public GitHub repositories, download statistics and OpenSSF Scorecard results.
- Requests go directly from your machine to those APIs. There is no backend, no telemetry and no logging to any third party.
- When you pass a manifest or lock file to `scan_manifest`, only the package **names** are sent anywhere (as part of the public API URLs above). Version ranges, scripts, integrity hashes and other contents never leave your machine.
- The `path` parameter of `scan_manifest` only opens files whose name is a supported manifest or lock file (`package.json`, `yarn.lock`, `requirements.txt`, …), up to 20 MB. It cannot be used to read arbitrary files.
- Responses are cached unencrypted in `~/.cache/pkg-health-mcp`. They contain only public data; the token is never written to disk.
- `GITHUB_TOKEN`, if set, is sent only to `api.github.com`. A fine-grained token with read-only access to public repositories is enough; do not give it write or private-repository scopes.

## Supported versions

Only the latest release receives fixes.
