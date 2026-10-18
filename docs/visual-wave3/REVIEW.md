# ECHO studio — Visual Wave 3 review: cinematic direction, presenter naturalness, optional opening

Worktree `echo-stage-visuals-w3`, branch `echo-visual-wave3`, created from the exact Wave 2 commit `e3529e7f0348fb6332d5b1ea3117d7825afbc6f9`. Implementation commit `a2c69e2`; the evidence commit is the one containing this file (`git rev-parse HEAD`). Protected 3.1 (`d0f4bd2`), the 3.2 worktree, port 8787, demo state, QA worktrees and recordings were not touched. No paid calls. Blender and MCP were not needed (see below).

## Watch

- [38-second real browser preview: Wave 3 with the optional opening, dialogue audio](evidence/wave3-preview-38s.mp4). Headless Chrome, real WebGL on the Apple M1 Max, the actual `/studio/` page. Original MP3s muxed at the measured turn-start offsets (±100 ms sampling), so audio alignment is approximate.
- [32-second before/after, side by side, aligned on the first dialogue turn](evidence/before-after-side-by-side-32s-labelled.mp4). Left: Wave 2 tree at `e3529e7` with its own director; right: Wave 3 with its own director. Same dialogue clock, same stage crop of the real page.
- [Contact sheet: six identical dialogue moments](evidence/before-after-contact-sheet.png) · [cuts and turns timeline](evidence/timeline.json) · [recorder results](evidence/raw/results.json) · stills: [opening](evidence/preview-frame-opening-3s.jpg), [developed two-shot](evidence/preview-frame-two-shot-27s.jpg), [side-by-side frame](evidence/side-by-side-frame-12s.jpg).

Both recordings had zero page errors. The recorder (`tools/visual-wave3/record-page.mjs`) serves each tree from a throwaway static server on 127.0.0.1:8898/8899, never the production port.

## What changed and why

**A. Cinematic direction** (`direction-wave3.js`, `blocking.js`, `studio.js`)
- `CinematicDirector` extends the Wave 2 semantic director. Every cut is still tied to a turn, sentence, performance or handoff event on the audio clock; no wall-clock timers.
- Mid-turn development: after a 2.4 s hold on the speaker, a sentence boundary may open to the two-person frame that holds the speaker and the person addressed (`twoShots`), if at least 2.2 s of the turn remain. New `two-atlas` composition (ECHO + Atlas), the mirror of the existing ECHO + Nova frame.
- End-of-turn guard: no sentence cut inside the last 1.5 s of a turn, so the turn-boundary cut never lands twice.
- Camera life: deterministic, bounded motion from the moment of the cut. Close-ups push in ≤4% and rise ≤2 cm, two-shots push ≤3%, the wide drifts ≤1.6 cm sideways. A cut remains a hard cut; reduced-motion disables it.
- Wide-aspect headroom: the studio stage is ≈2.2:1 on desktop, but the Wave 2 frames were tuned at 16:9 and crop hair tops in close-ups (visible on the Wave 2 side of the contact sheet, Nova rows). `cinematicFrame` pulls back and raises the target on aspects above 1.9; untouched at ≤1.9.
- Rhythm over the ten-turn dialogue (test): 16 cuts in 70 s, minimum spacing 2.2 s, 3 ECHO/Nova and 2 ECHO/Atlas two-shots. Recorded page, first 44 s: Wave 2 made 9 cuts with one two-shot (the authored one at turn 7); Wave 3 made 9 cuts with two developed two-shots.

**B. Presenter naturalness** (`body-performance.js`, `room.js`)
- Each authored gesture gets a deterministic shape of its own (amplitude 0.82–1.0, optional second-hand lag, open-palm variation) from a hash of its time and actor; never above the Wave 2 envelope.
- Listeners are drawn toward the speaker's emphasis: a head-only pull of ≤0.01 rad following the speaker's gesture envelope. Torso and hands do not move, so the Wave 2 tabletop clearance holds.
- Speaker sentence beats: a 0.012 rad head dip at each caption start.
- Seated weight shift with two incommensurate periods (23.7 s, 41.3 s), ±0.009 rad, so idle never visibly loops.
- Transitions: torso and shoulders settle at 4.2–5/s instead of 7/s, so speaking becomes listening instead of stopping; brow, cheek and smile shapes ease at 11/s instead of 24/s; speech shapes and blinks keep their rates.
- All of it is gated by `state.cinematic`. With `?visual=wave2`, and in the Wave 2 sequence test (PASS, 0 sampled table intersections, unchanged), the Wave 2 behaviour is reproduced exactly.
- Feet and legs untouched: lower legs are only partly visible and planted feet remain preferable.

**C. Optional opening** (`opening.js`, `studio.css`, `?opening=1`)
- 6.5 s pre-roll: lights scale from 12% to 100% over 3.6 s and are restored exactly; the camera eases from a higher, wider reveal onto the wide frame; an HTML lower-third (ECHO · THE TABLE · ROOM FOR DOUBT) fades in at 1.2 s and out by 6.2 s.
- The dialogue clock starts only when the opening ends, or when Play is pressed again, which cancels it. No caption, cue or turn timing moves. The 3.1 broadcast schedule is not involved.
- Off by default; `EchoStudio.playOpening()` is exposed for a future adapter.

**D. Material polish** (`materials.js`)
- Skin roughness .80 → .68 and hair .86 → .74. The one reproducible weakness I could see was uniformly matte skin and hair reading as clay under the key light. No mesh, rig or texture work; nothing else was visible and reproducible enough to touch.

**E. Images:** none required. `IMAGE_BRIEF.md` holds a brief for an optional LED-wall texture; the modelled board is the fallback and is what ships.

## Blender / MCP

Not used. Every improvement is runtime direction, animation and material parameters in Three.js; no geometry, rig or texture needed rebuilding, so Blender offered no advantage this wave.

## Measured performance

Self-contained benchmark (`tools/visual-wave3/build-bench.mjs` + `run-bench.mjs`): Wave 2 modules read from git at `e3529e7`, Wave 3 from the working tree, same GLBs and festival set, same camera per shot, Wave 3 with `cinematic: true` and camera motion applied. Headless Chrome, ANGLE Metal on Apple M1 Max, 1320×600, pixel ratio 1, two alternating-order trials, 180 frames each after 30 warm-up frames, GPU via `EXT_disjoint_timer_query_webgl2`. Headless `performance.now()` is 0.1 ms grained, so CPU figures sit at the precision floor. Raw: [benchmark.json](evidence/benchmark.json).

| Shot | Metric | Wave 2 (trial 0 / 1) | Wave 3 (trial 0 / 1) |
| --- | --- | ---: | ---: |
| wide | GPU median ms | 1.47 / 1.30 | 1.28 / 1.25 |
| wide | GPU p95 ms | 2.95 / 2.86 | 3.04 / 2.88 |
| wide | animation CPU median ms | 0.20 / 0.20 | 0.20 / 0.10 |
| wide | render submission median ms | 0.80 / 1.70 | 0.90 / 0.80 |
| echo close-up | GPU median ms | 1.20 / 1.34 | 1.18 / 1.18 |
| echo close-up | animation CPU median ms | 0.20 / 0.20 | 0.10 / 0.10 |
| echo close-up | render submission median ms | 1.30 / 1.50 | 0.60 / 0.60 |
| both | draw calls / triangles | 135 / 172,718 (wide), 57 / 143,502 (echo) | identical |

Real-page recordings (44.6 s each): requestAnimationFrame interval p50 16.7 ms and p95 16.7–16.8 ms for both versions (the page renders at most every 32 ms while playing); 1,296 vs 1,376 captured frames; one 33 ms interval each, no other spikes. No rendering regression was measured; differences are within timer precision.

## Tests

Logs: [tests-wave3.txt](evidence/tests-wave3.txt), [sequence-wave2-path.json](evidence/sequence-wave2-path.json).

- `npm run test:studio`: all five suites PASS.
- `tests/studio-rig.mjs --directed`: PASS.
- `tests/performance-wave2/sequence.mjs` (Wave 2 path): PASS, 1,973 frames, 0 sampled table intersections, lowest hand 0.82644 m, unchanged.
- `tests/visual-upgrade/scenery.mjs`: PASS.
- New `tests/visual-wave3/direction.mjs`: PASS. Cut spacing ≥2.2 s over the whole dialogue, end guard, fixed-camera mode unchanged, 180 shot/aspect/motion framing combinations (aspects 2.24, 2.15, 16:9, 1.6, 0.82 at camera-motion extremes) with face points and hair top inside the frame, opening lands exactly on the wide frame and restores light, cinematic body layer over 989 frames with wrists at 0.860–0.881 m, feet fixed, state never mutated.
- `node --check` on all studio modules; `git diff --check` clean.

## Known limitations

- Audio in the preview is muxed at measured offsets, not captured system audio: judge direction and motion with it, not lip timing. Lip sync remains viseme-cue based; no phoneme alignment was invented.
- The opening is a studio-page pre-roll only. It is not in the 3.1 broadcast and must not be while 3.1 is frozen.
- Expression and gesture variety is bounded by the 66 facial shapes and the seated rig; these remain stylized characters. Listener pull is head-only by design.
- Single-machine measurements; the judging laptop was not measured.
- The material change is free in draw calls and triangles but visually modest; judge it by eye on the final display.

## Safe selective integration (do not merge this branch wholesale)

1. Review `git diff e3529e7..HEAD -- dist/studio` (seven files, two new). `studio.js` carries only page wiring; behaviour lives in `direction-wave3.js`, `opening.js`, `body-performance.js`, `room.js`, `blocking.js`, `materials.js`.
2. Port in this order, each behind the existing flags: (a) `blocking.js` two-atlas frame + `direction-wave3.js`; (b) `body-performance.js` + `room.js` (the `state.cinematic` gate keeps old adapters unchanged); (c) `materials.js`; (d) `opening.js` + CSS last, still opt-in.
3. The integration target must supply `cinematic`, `sentenceAt`, and sentence `audioTime`/`remaining` in its event and state objects; without them Wave 3 degrades to Wave 2 behaviour rather than failing.
4. Carry `tests/visual-wave3/direction.mjs` across and rerun `tests/performance-wave2/sequence.mjs` there. Re-record on the final judging device with audible playback before any release gate.
5. Keep `?visual=wave2` until the integrated result has been watched on the target display.

## Recommendation

**KEEP ISOLATED for the 18 October submission; MERGE LATER selectively.** 3.1 is frozen and QA-passed and 3.2 has open P1 blockers, so nothing here enters either today. The direction, naturalness and headroom fixes are verified, performance-neutral and reversible, and are the first candidates for the post-hackathon integration branch. The opening stays opt-in until a producer-approved pre-roll slot exists.
