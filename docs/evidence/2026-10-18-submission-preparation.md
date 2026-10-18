# GitHub submission preparation — 18 October 2026

Prepared from `echo-3.1` at `d0f4bd2866cfdee625bbdcffa62138b557f696a9` in a separate worktree. Application code and existing demo state were not changed. Changes are the judge-facing README, this verification note, additional ignore rules, and removal of local static-host metadata from the submission tree. The original history is retained.

## Checks performed

Environment: macOS, Node.js v24.12.0, npm 11.6.2; installed Google Chrome driven by the pinned Playwright dependency. The project declares Node.js 22+.

| Check | Result |
|---|---|
| Fresh dependency installation from `package-lock.json` | PASS: `npm ci --cache /tmp/echo-submission-npm-cache --ignore-scripts --no-audit --no-fund`, 98 packages installed |
| `npm test` | PASS: 54/54 broadcast tests, all 5 studio suites |
| `npm run test:browser` | PASS: three separate browser sessions; per-person approvals; revision 2 committed and published; producer rejection withdrew publication 1 before air |
| README file and branch references | All linked repository targets exist locally |
| `git diff --check` | PASS |
| Ignore rules | Local environment files, runtime credentials/state, state backups, dependencies and voice models are ignored |
| Git history pattern scan | No matches for the checked credential/private-key patterns across the six product branches (609 blobs, 1,022 objects) |
| Git object sizes | Largest tracked blob approximately 18.5 MB; no tracked blob exceeds 100 MB |

The first sandboxed test attempt could not bind localhost (`listen EPERM`). Rerunning with localhost access passed. An initial offline install had an empty package cache; the subsequent network-enabled pinned installation passed.

The history scan is a heuristic check of text blobs for provider keys, GitHub tokens, private keys and literal ECHO credentials, not a guarantee that every kind of sensitive information is detectable. Generated runtime data and local credentials are not part of the uploaded trees.

No live paid AI agent calls were made during this packaging check. The real-agent evidence remains in the previously recorded reports. Human actions in the browser test were automated. The full browser suite and the experimental branches were not rerun as part of this documentation-only packaging change; their existing evidence and limitations are linked from the README.

## Preserved product branches

| Branch | Original tip |
|---|---|
| `echo-3.1` | `d0f4bd2866cfdee625bbdcffa62138b557f696a9` |
| `echo-3.2` | `41b67cdf035d72d086f06f8202064c62cd298900` |
| `echo-visual-upgrade` | `e3529e7f0348fb6332d5b1ea3117d7825afbc6f9` |
| `echo-visual-wave3` | `53eae532ab5b9bcc74d6772da51f9d3bb7e864d8` |
| `echo-unified-integration` | `b0ee0567a957b309aa0914d1ce001069683709ba` |
| `echo-editorial-wave` | `1b77352156e7778d4144bc4ec171caa581e7346f` |
