# ECHO character performance — Wave 2 review

The isolated visual branch now adds restrained, authored-event arm gestures, listener posture and handoff nods, eye-leading head turns, stronger supported facial cues, and semantic camera cuts. The most visible improvement is in the hands: the old seated palm roll put fingers into the tabletop; the corrected resting pose and small forearm lifts keep the sampled hands above it. No character, rig, mesh, studio, provider, backend or production-state replacement was introduced.

Baseline: `9ca8eceb28ba32c6f10207c469f62757d78d0f4b`. Checkpoint before animation: `3d7a5bf`. First implementation milestone: `a6d865c`. Worktree: `echo-stage-visuals`, branch `echo-visual-upgrade`. The final evidence commit is the commit containing this document; obtain its exact SHA with `git rev-parse HEAD` on this branch. Nothing was merged into 3.1 or 3.2.

## Watch and compare

- [32.53-second actual WebGL preview with dialogue](evidence/preview.mp4)
- [Original browser canvas recording, silent](evidence/browser-capture.webm)
- [Speaker gesturing](evidence/speaker-gesture.png)
- [Hand clearance detail](evidence/hand-clearance.png)
- [Listener acknowledgment](evidence/listener-acknowledgment.png)
- [Listener considering another speaker](evidence/listener-considers.png)
- [Two-person conversation](evidence/two-person-conversation.png)
- [Three-character wide](evidence/three-character-wide.png)
- [Seated posture](evidence/seated-posture.png)
- [Opening motion sequence](evidence/motion-sequence.jpg), [two-person motion sequence](evidence/two-person-sequence.jpg)

All images compare baseline on the left and Wave 2 on the right at the same sampled media time. Both video halves use the same Wave 2 camera target, so pose differences are comparable. Actual before/after director decisions are separately recorded in `measurements.json`; the comparison does not pretend that the left camera is the old director. The extra hand-detail shot is a review camera, not a new production camera.

The recording uses the real Three.js renderer, existing GLBs, original dialogue, actual `MockAdapter` and media-element time. It exercises turns 01, 02, 03 and 07. These cover all three speakers, two-person shots, listener cuts and handoff reactions. It is a local visual harness, not proof that Claude's full 3.2 application has been integrated.

The browser delayed media startup by 127.4 seconds before producing captured playback frames and resumed once during turn 01. The resulting video contains 948 real frames over 32.53 seconds, not that startup wait. Original unchanged MP3s were muxed afterward using observed playing/resume offsets relative to the first captured playback frame. This is approximate frame alignment, not captured system audio or a listening-quality certification. The raw recording and timing events remain available. No provider calls were made.

Temporal frames were inspected through gesture lift/return and two-person speaking/listening transitions. Hands visibly clear the tabletop, forearms lift without joint flips, and seated feet remain planted. The facial improvement is deliberately subtle; these remain stylized characters. No obvious new body intersections or framing instability were observed in the inspected sequence. This is not an exhaustive collision guarantee for arbitrary future performances.

## What changed

`body-performance.js` layers deterministic, bounded joint offsets over the measured seated rig. Existing authored gesture events cause a smooth lift, brief hold and slower return. Different hands can be used without adding random activity. Chest, shoulder and head emphasis follow the same event. Idle breathing is small and actor-phased. Listening posture comes from existing authored performance cues; a single acknowledgment may follow an explicit turn-end addressed to that listener.

`room.js` corrects the existing wrist roll/thumb resting posture, applies those upper-body offsets, splits gaze rotation between neck and head, and lets eyes lead the head. Pausing freezes the sampled pose; replay restores bone and morph state before restarting. Hips, legs, feet and toes stay fixed.

`performance.js` increases supported question/doubt/warmth cues slightly, smooths acknowledgment into one nod, and adds a bounded surprise intent for future authored cues. Blink amplitude is slightly asymmetric. Existing lower-face viseme priority and reduced-motion behavior remain. No surprise reaction is invented for the current dialogue.

`performance-direction.js` uses explicit turn, sentence, listener-performance and handoff events. It allows one listener reaction per turn, preserves a 2.2-second reaction hold and a 2.8-second turn-boundary floor, and keeps fixed camera mode. Existing wide, close-up and two-person compositions are reused. `studio.js` only wires these visual events and reset behavior into the existing transport.

Future voice adapters can continue supplying `speaker`, `audioTime`, `speaking`, `attention`, `performance` and `gestures`. Optional gesture fields are `actor`, `hand` (`left`, `right`, `both`) and `kind: 'open'`; strength is bounded to 0–1. No ElevenLabs dependency or orchestration framework is required. New cues still need rig clearance testing.

## Measured performance

Native Brave/Chromium on this Mac; real WebGL, 960×540 per scene, pixel ratio 1. Two alternating-order trials, 180 measured animated frames per version per trial after 30 warm-up frames. Other user applications remained running. Values are local observations, not cross-device guarantees.

| Metric | Wave 1 | Wave 2 |
| --- | ---: | ---: |
| Animation CPU median | 0.10 ms | 0.20 ms |
| Animation CPU p95 | 0.40 ms | 0.50–0.60 ms |
| Render submission median | 1.00–1.10 ms | 1.00–1.10 ms |
| GPU median, timer query | 1.441–1.464 ms | 1.457–1.469 ms |
| GPU p95 | 1.741–1.749 ms | 1.655–1.733 ms |
| Frame interval p95 | 9.90–10.10 ms | 9.60–10.30 ms |
| Draw calls | 135 | 135 |
| Triangles | 172,718 | 172,718 |

Mean of the two GPU medians increased about 0.7%; CPU animation median increased 0.10 ms. No major rendering regression was measured. Timer precision is coarse at these CPU durations. The 30 fps side-by-side recording is separate from this single-scene benchmark. Raw measurements, source hashes, cuts and all 152 media-clock caption/viseme samples are in [measurements.json](evidence/measurements.json).

## Validation

All commands below passed on the final runtime code:

```sh
npm run test:studio
node --no-warnings --experimental-loader=./tests/three-loader.mjs tests/studio-rig.mjs --directed
node --no-warnings --experimental-loader=./tests/three-loader.mjs tests/performance-wave2/sequence.mjs
node --no-warnings --experimental-loader=./tests/three-loader.mjs tests/visual-upgrade/scenery.mjs
node --check dist/studio/studio.js
git diff --check
```

Logs are in `evidence/`. The sequence test runs all ten dialogue turns at 30 fps: 1,973 speaking frames, 6,060,180 before/after sampled skinned vertices. It found zero sampled Wave 2 tabletop penetrations, compared with 816,581 baseline penetrations under the same test. These are repeated vertex observations, not counts of distinct defects. Lowest sampled Wave 2 hand point over the tabletop was 0.82644 m against a 0.825 m surface. Maximum wrist displacement between consecutive sampled frames was 2.04 mm; maximum lift relative to baseline was 29.73 mm.

Tests also check unchanged feet/toes, finite deformed geometry, pause freeze, deterministic replay, reduced motion, bounded camera holds, fixed camera mode, and unchanged caption selection. Existing rig tests cover 25 shot/aspect combinations, including portrait framing. No new native mobile-device GPU benchmark was performed.

`core.js`, `dialogue.json`, all ten dialogue MP3s and both character/hair GLBs are byte-identical to baseline; see [unchanged-contracts.json](evidence/unchanged-contracts.json). All 152 recorded caption/viseme samples match the existing dialogue clock. The MP4 passed full ffmpeg decode and contains H.264 video and AAC audio; [video metadata](evidence/video-metadata.json). Backend/broadcast integration tests were not reclassified as visual evidence and production servers were not exercised.

## Rig boundaries and remaining review

The existing skeleton has spine, shoulder, arm, forearm, hand, finger, neck, head, eye, leg and foot controls, plus 66 facial morph targets. It supports these restrained layers. It has no collision-aware runtime IK or grasping solver. Large gestures, prop contact, handshakes, walking and weight shifts that move feet are outside this change. Lower legs are partly visible; fixed planted feet are preferable to decorative motion. Torso/shoulder adjustments provide the seated variation.

Facial animation is stylized morph blending, not realistic facial capture. Skeptical and surprised poses are supported only within the available shapes. No mesh or rig replacement was attempted. The normal browser's audio startup delay warrants independent playback review on the target judging machine. No claim is made about Georgian voice quality. No new background/screen image asset adds sufficient value here; image-generation requirements are therefore intentionally absent.

## Independent review and selective integration

After Claude finishes, create a separate integration branch from the agreed 3.2 commit. Do not merge this entire branch or overwrite Claude's `studio.js`/`room.js`.

1. Review the Wave 2-only diff from `9ca8ece` to this branch for `dist/studio/body-performance.js`, `performance-direction.js`, `performance.js`, `room.js` and `studio.js`.
2. Port the two new modules and selected pose/expression changes together. Manually adapt the small event wiring to 3.2's current playback adapter; preserve its media clock, state handling and permissions. Review asset/import cache versions when deploying.
3. Bring `tests/performance-wave2/` into that integration branch, retain access to baseline Git objects, and run the tests above plus 3.2's own playback tests. Compare actual integrated speaker/listener cuts, pause/resume, restart and portrait layouts. Confirm no new cues move hands outside the tested envelope.
4. Reproduce browser evidence on the final judging device, including audible playback and captions, before accepting the release gate. This isolated result is ready for selective integration review, not an assertion of merged 3.2 readiness.

To reproduce this isolated comparison:

```sh
node tools/performance-wave2/build-review.mjs
# Open data/performance-wave2/index.html in a browser.
# Click Record; keep the tab visible until benchmarks complete.
# Save the WebM and evidence JSON using the page controls.
python3 tools/performance-wave2/import-evidence.py /path/to/evidence.json /path/to/recording.webm
```

The generated review page is self-contained, uses only local assets and has no backend connection, server port or paid API dependency. Its build inputs are hashed; importing evidence rejects mismatched source. The importer aligns this run to its observed first playing event and preserves any later resume events; inspect the first recorded frame when reproducing on a different browser.
