# Scoring methodology

This page documents exactly how `pkg-health-mcp` turns raw package data into a 0–100 score. Every number here comes from [`src/score.ts`](../src/score.ts); if the two ever disagree, the code wins and this page has a bug.

## Overview

1. **Gather facts** from the registry (npm or PyPI), the linked GitHub repository, download statistics and OpenSSF Scorecard. A GitHub repository can also be scored directly, without a registry; see [GitHub repositories](#github-repositories).
2. **Score six signals** independently, each from 0 to 100. A signal with no data is `null`, not zero.
3. **Combine** the available signals with a weighted average. Weights of missing signals are dropped and the rest are rescaled, so a package is never punished just because an API was unreachable.
4. **Apply hard caps** for deprecated packages and archived repositories.
5. **Grade** the result and list human-readable risks.

## Weights

| Signal | Key | Weight | Why it matters |
| --- | --- | ---: | --- |
| Recent activity | `activity` | 30% | The strongest single predictor of abandonment |
| Maintainer diversity | `maintainers` | 20% | A project with one active person can stop overnight (bus factor) |
| Issue responsiveness | `issues` | 15% | Shows whether bugs reported today will get a reply |
| Download trend | `downloads` | 15% | Ecosystems move away from dying packages before they are officially dead |
| OpenSSF Scorecard | `scorecard` | 10% | Independent security-practice assessment (branch protection, CI, signed releases…) |
| License | `license` | 10% | A missing or restrictive license is a legal risk even for a healthy project |

## Signal thresholds

### Recent activity

Uses the **most recent** of: the latest release date (registry) and the latest commit on the default branch (GitHub).

| Days since last activity | Score |
| --- | ---: |
| ≤ 30 | 100 |
| ≤ 90 | 90 |
| ≤ 180 | 75 |
| ≤ 365 | 55 |
| ≤ 730 | 30 |
| > 730 | 10 |
| Repository archived | 0 |

### Maintainer diversity

Counts **unique human commit authors in the last 12 months** on the default branch. Commits are read 100 at a time, newest first, for up to 5 pages (500 commits). Paging stops early once 10 authors are found, since the score is already at its maximum. If the 500-commit limit is reached first, the count is shown as a lower bound, e.g. `7+`. Bots (`*[bot]`, Dependabot, Renovate, GitHub Actions) are excluded.

| Active committers | Score |
| --- | ---: |
| 0 | 5 |
| 1 | 25 |
| 2 | 45 |
| 3–4 | 65 |
| 5–9 | 85 |
| 10+ | 100 |

If GitHub data is unavailable, the number of maintainers listed on the registry is used instead, with a lower ceiling because publish rights say little about actual activity:

| Registry maintainers | Score |
| --- | ---: |
| 1 | 35 |
| 2 | 55 |
| 3–4 | 70 |
| 5+ | 80 |

PyPI does not expose a maintainer count, so for PyPI packages without GitHub data this signal is `null`.

### Issue responsiveness

**Time to first maintainer response** is used when a GitHub token is available (it needs the GraphQL API). Otherwise the score falls back to **time to close**.

#### Time to first maintainer response

Reads the 60 most recently opened issues and keeps those that are:

- opened in the last 12 months, but at least 7 days ago (younger ones are too fresh to judge);
- opened by someone outside the project. Issues opened by owners, organization members and collaborators are usually the maintainers' own to-do items, not requests waiting for an answer.

For each issue, the wait is the time until the earliest of: the first comment by an owner, member or collaborator (bots and the issue's own author excluded), or the issue being closed. Issues that never got either count with their current age, which underestimates the real wait.

| Median days to first response | Score |
| --- | ---: |
| ≤ 1 | 100 |
| ≤ 3 | 90 |
| ≤ 7 | 75 |
| ≤ 30 | 55 |
| ≤ 90 | 30 |
| > 90 | 10 |

The detail line also shows the share of issues that got a response, and the median time to close when it is known.

#### Time to close (fallback)

Median number of days between opening and closing an issue, over issues **closed in the last 12 months** (up to 100 sampled). Pull requests are excluded. Issues closed as "not planned" with zero comments are excluded too, since they are usually stale-bot cleanups rather than real responses.

| Median days to close | Score |
| --- | ---: |
| ≤ 3 | 100 |
| ≤ 14 | 85 |
| ≤ 45 | 65 |
| ≤ 120 | 45 |
| ≤ 270 | 25 |
| > 270 | 10 |
| No issues closed, but some are open | 15 |
| No issues opened or closed at all | `null` |

### Download trend

Compares downloads in the **last 90 days** with the **90 days before**. The trend matters more than the absolute number: a niche package with stable usage is fine, a popular one losing half its users is not.

| Recent ÷ previous | Score |
| --- | ---: |
| ≥ 1.15 (growing) | 100 |
| ≥ 0.95 (stable) | 85 |
| ≥ 0.80 | 65 |
| ≥ 0.60 | 45 |
| ≥ 0.40 | 25 |
| < 0.40 | 10 |
| New package (no downloads in the previous window) | 90 |
| No downloads in either window | 10 |

Sources: npm's `downloads/range/last-year` API, and pypistats' `overall` endpoint (mirrors excluded). pypistats keeps about 180 days, so for PyPI the available history is split into two equal halves.

### OpenSSF Scorecard

The project's overall [Scorecard](https://securityscorecards.dev) result (0–10) from [deps.dev](https://deps.dev), multiplied by 10. Projects that have never been scanned get `null`.

### License

| License type | Examples | Score |
| --- | --- | ---: |
| Permissive | MIT, Apache-2.0, BSD-*, ISC, 0BSD, Unlicense, Zlib, CC0-1.0, PSF, WTFPL | 100 |
| Weak copyleft | MPL-2.0, LGPL-*, EPL-* | 70 |
| Unrecognized | Anything not matched above | 50 |
| Strong copyleft | GPL-* | 35 |
| Network copyleft / source-available | AGPL-*, SSPL | 20 |
| Proprietary or custom | `UNLICENSED`, `SEE LICENSE IN …` | 20 |
| Missing | No license declared | 0 |

SPDX expressions are evaluated: for `A OR B` the most permissive option counts (you may choose it), for `A AND B` the most restrictive one counts (you must comply with both). The operators must be upper-case, as SPDX requires, so a classifier like "GNU Library **or** Lesser General Public License" is not split.

For PyPI, the license is read from `license_expression` first, then from `License ::` trove classifiers, then from the free-text `license` field if it is short (that field often contains the entire license text).

## Combining

```
score = Σ (weightᵢ × scoreᵢ) / Σ weightᵢ     over signals where scoreᵢ is not null
confidence = Σ weightᵢ                         over the same signals (0 to 1)
```

`confidence` tells you how much of the model was backed by real data. Below 0.6 the summary says "low confidence". A typical package with a reachable GitHub repository reaches 0.9–1.0.

## Hard caps

| Condition | Maximum score |
| --- | ---: |
| Package marked deprecated on npm, or `Development Status :: 7 - Inactive` on PyPI | 10 |
| GitHub repository archived | 15 |

## Grades

| Grade | Score | Meaning |
| --- | --- | --- |
| A | 80–100 | Healthy |
| B | 65–79 | Mostly healthy |
| C | 50–64 | Some maintenance concerns |
| D | 35–49 | Poorly maintained |
| F | 0–34 | Likely abandoned or unsafe to adopt |
| ? | — | Package not found, or no data at all |

## Risk flags

Independently of the score, these conditions are listed in `risks` so an agent or a human can see *why* a package scored low:

- Deprecated (with the maintainer's own message)
- Repository archived
- No release in 2+ years
- No commits in the last 12 months
- Single active maintainer (bus factor 1)
- Most recent issues got no maintainer response: at least 5 issues sampled, fewer than half answered, and a median wait above 30 days. Busy projects often triage with labels or through community members instead of comments, so the flag needs both conditions
- No linked GitHub repository
- License that may restrict commercial use (strong or network copyleft, proprietary)
- Downloads dropped more than 40% in the last 90 days
- Package does not exist (typo or possible typosquatting target)

## GitHub repositories

When the target is a repository (`owner/repo`, a GitHub URL, or a git dependency in a manifest or lock file), the same model is used with these differences:

| Signal | Source |
| --- | --- |
| Recent activity | Latest GitHub release and latest commit. The version shown is the release tag without a leading `v` |
| Download trend | Not available, so the weight is redistributed and `confidence` tops out at 0.85 |
| License | The license GitHub detected in the repository |
| Deprecated cap | Not applicable; the archived cap still applies |

A repository that does not exist is graded `?` with the risk "Repository not found". If GitHub could not be reached (rate limit, network error), it is also graded `?`, but with the summary "Could not be checked" and no risks, since that says nothing about the project.

## Known blind spots

- **Feature-complete packages.** A tiny, finished utility with no commits for two years may be perfectly fine. The score will still flag it; read the risks before acting.
- **Monorepos.** Activity in a monorepo (for example `babel/babel`) is attributed to every package published from it, even ones nobody touches.
- **Role-based responses.** Only replies from owners, members and collaborators count as maintainer responses. Projects where trusted community members do the triage look slower than they are.
- **Non-GitHub hosting.** Repository data is read from GitHub only, so packages hosted on GitLab, Codeberg or self-hosted forges score from registry data alone.
- **Mirrors and forks.** If the registry points at a mirror or a fork, the score reflects that repository.
- **Not a vulnerability scanner.** Use `npm audit`, `pip-audit` or [OSV](https://osv.dev) for CVEs.
