# ECHO independent visual upgrade

Implemented on `echo-visual-upgrade`, in `echo-stage-visuals`, starting at protected release `d0f4bd2866cfdee625bbdcffa62138b557f696a9`. This branch is a visual integration candidate, not a release. It has not been merged into 3.1 or 3.2. Claude's 3.2 worktree, the QA worktree, demo port 8787, credentials and existing release evidence were not modified by this visual task.

## Delivered

- Original Blender scenery: evergreen acoustic panels, champagne fluting, ECHO / Hacktoberfest / Tbilisi 2026 lettering, two small relief displays and courtyard plants. Editable [Blender source](festival-set.blend), reproducible [build script](../../tools/visual-upgrade/build-set.py), and [browser GLB](../../dist/studio/visual-upgrade/festival-set.glb).
- Warmer key, cooler fill/rim and lower ambient lighting; no extra lights, shadow maps or postprocessing passes. Existing character meshes, skin palettes, hair, furniture, speech and animation remain unchanged.
- Wider establishing shot, portrait framing that contains all three faces, and revised conversation framing. Individual presenter closeups are unchanged.
- A one-request scenery loader that retains the original background on failure. Successful asynchronous loading requests a redraw when the studio is paused. It has no playout or production-state side effects.
- Backend-free comparison viewer using the actual baseline and modified Three.js modules and actual cast assets. The baseline is read with `git show`, never checked out or edited.

The scenery is 964,252 bytes (941.7 KiB), 18,520 triangles, eight mesh/material batches, with no external textures, lights, cameras or animation. The old background stays in memory for fallback; its meshes become invisible after successful loading. No cold-load, GPU-memory or network-throughput claim is made.

## Visual evidence

[All 20 views](evidence/comparison-contact-sheet.jpg) · [Desktop before](evidence/before-landscape-wide.png) · [Desktop after](evidence/after-landscape-wide.png) · [Portrait before](evidence/before-portrait-wide.png) · [Portrait after](evidence/after-portrait-wide.png)

The PNGs are direct Chrome WebGL canvas captures at 1280×720 and 390×844. Five shots × two versions × two sizes. They are not offline Blender renders or mocked backend screenshots. The contact sheet only resizes those captures. Source and PNG SHA-256 hashes, browser user agent, timestamps, geometry counts and timing samples are in [measurements.json](evidence/measurements.json).

Visual review checked face visibility, event lettering, framing, scenery placement and lighting in the comparison set. Portrait is a desktop-rendered viewport, not a physical-phone test. No Georgian UI was changed. This does not establish browser accessibility or complete production-flow compatibility.

## Performance

| View | Draw calls before → after | Triangles before → after | CPU submit median / p95 (ms), before → after | Frame interval p95 (ms), before → after |
|---|---:|---:|---:|---:|
| 1280×720 desktop | 135 → 135 | 155,932 → 172,718 | 0.9 / 2.7 → 0.8 / 2.6 | 9.2 → 9.8 |
| 390×844 portrait | 131 → 133 | 155,420 → 172,334 | 1.8 / 2.6 → 2.0 / 2.6 | 9.3 → 9.4 |

Measurements use the wide camera, 30 warmup frames and 180 samples per case, one sequential before/after run in Chrome 155 on this Mac. Identical antialiasing, ACES exposure 0.88, fixed pose and pixel ratio 1. `preserveDrawingBuffer` is enabled to capture PNGs. CPU submission time is not GPU execution time; requestAnimationFrame cadence includes browser scheduling. The production renderer can use higher pixel ratios and animated/audio workloads. Treat these numbers as a limited visual-scene comparison, not a mobile or broadcast performance guarantee. The new 942 KiB asset adds one uncached HTTP request in normal runtime; transfer latency was not measured.

## Verification

Passed:

```sh
npm run test:studio
node --no-warnings --experimental-loader=./tests/three-loader.mjs tests/studio-rig.mjs --directed
node --no-warnings --experimental-loader=./tests/three-loader.mjs tests/visual-upgrade/scenery.mjs
git diff --check
```

The existing studio suite covers transport, 389 expression samples, the legacy rig, materials and the Nova study. The directed rig adds 1,050 skinned-vertex samples, 25 shot/aspect combinations, independent poses, gaze limits and table-contact gestures. The new scenery test covers GLB budgets, lack of external textures, placement behind the cast, failed-load fallback, bounded loading attempts, readiness redraw and idempotent attachment. Logs are in [evidence](evidence/).

No backend, agent, voice, domain, booking, credentials, dependency manifests or production-data files changed. Backend and end-to-end broadcast tests were not run for this visual-only task. The async runtime hookup is exercised at the scene/event level; the complete HTTP-served application still needs its integration gate.

## Reproduce the independent review

From this worktree:

```sh
node tools/visual-upgrade/build-review.mjs
```

Open `data/visual-review/index.html` in Chrome. Choose Before/After, a shot and portrait/landscape. Use **Capture comparison + benchmark**, then **Save evidence JSON**. Import the downloaded file:

```sh
python3 tools/visual-upgrade/import-evidence.py '/path/to/echo-visual-evidence.json'
```

Import rejects evidence whose source hashes differ from this checkout. The generated HTML is an ignored local artifact with embedded assets, no server, remote dependencies, credentials or production connection. Separate physical `node_modules` were copied into this worktree; no shared writable dependency symlink was used.

To rebuild scenery, use Blender 5.2.1 with `tools/visual-upgrade/build-set.py` in a fresh file. The script clears the current Blender scene. The documented headless command is `blender -b --python tools/visual-upgrade/build-set.py`; this host's headless run crashed during Metal initialization, so the successful build used the native Blender Python console and `runpy.run_path` instead. No callable Blender MCP endpoint was exposed in this session; this is a real Blender-generated asset, but not evidence of Blender MCP execution.

## Safe integration after Claude finishes

1. Have the 3.2 owner finish and record a clean, tested commit. Create a new integration branch/worktree from that exact commit. Do not apply changes inside Claude's active worktree or merge this branch into 3.1.
2. Copy the additive `dist/studio/visual-upgrade/`, `tools/visual-upgrade/`, `tests/visual-upgrade/` and `docs/visual-upgrade/` paths from `echo-visual-upgrade`. Review the visual diff against the protected base for the five existing modules listed below. Apply those small hunks manually to the new 3.2 versions; do not replace entire modules or resolve conflicts by taking this branch's old application code.
3. Treat these as selectable groups. Scenery requires the new GLB/loader, named original-background groups in `room.js`, loading hook in `materials.js`, and redraw listeners in `studio.js` / `lookdev/lookdev.js`. Lighting-only can take the light-value changes without importing/loading the scenery. Camera-only can take `conversationFrame` changes from `blocking.js` independently.
4. Run the commands above plus the latest 3.2 test suite in the integration worktree. Give any runtime its own dependency directory, data directory and unused preview port. Never reuse demo port 8787 or existing release data. The reserved visual preview port was 8794; no server is running there from this task.
5. Exercise the actual 3.2 studio over HTTP: cold asset load, paused-load redraw, missing GLB fallback, all directed camera transitions, resize, lower thirds/captions, playback and WebGL recovery. Recheck on a real phone and at the production pixel ratio. Retest final approved-broadcast playback using 3.2's own validation procedure.
6. Capture fresh evidence after integration. The independent comparison fingerprints deliberately bind to this visual branch, so they cannot certify modified 3.2 source. Commit only the selected changes after review.

Relevant existing-file diff:

```sh
git diff d0f4bd2866cfdee625bbdcffa62138b557f696a9 echo-visual-upgrade -- \
  dist/studio/room.js dist/studio/materials.js dist/studio/blocking.js \
  dist/studio/studio.js dist/studio/lookdev/lookdev.js
```

Recommendation: approve a **visual integration review**, then require the HTTP playback/mobile gate above before including it in any release. No founder payment, new security policy or external provider usage is needed. Final visual preference remains a founder choice.

## References and limitations

Event name/year were checked against [Hacktoberfest](https://hacktoberfest.com/). The wordmark is original text, not an official event logo or sponsorship claim. FreeUni inspiration is limited to officially described [campus courtyards/exhibition spaces](https://freeuni.edu.ge/en/about-us/?about-us=Campus) and the [architecture programme's exhibition gallery](https://freeuni.edu.ge/en/educational-programs/bachelor/visual-art-architecture-and-design-school/architecture/). The reliefs and vegetation are original, not copies of campus artwork or a campus reconstruction. References checked 2026-10-18.

Automatic approval review rejected starting the isolated static preview server because this session forbids escalated commands. The native Chrome local-file comparison provided real WebGL evidence without a listener. HTTP integration and live broadcast verification remain pending.
