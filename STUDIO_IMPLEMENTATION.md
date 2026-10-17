# ECHO Studio — Edition 02

## Decision and scope

Added `/studio/` beside Current / Original. Existing experiences and Character Lab retain their source and assets. Uses the existing self-hosted Three.js r170 and MPFB CC0 base model, cloned with separate skeletons into one scene/renderer. No runtime dependencies, APIs or paid services added. The site audience is unchanged.

Forest, sage and ivory editorial room, slatted wall, architectural practicals, beveled oval table, rounded upholstered chairs and restrained tabletop microphones. Three styling variants share one base mesh. Legs are posed by world-space bone aiming, retaining the actual rig's rest transforms. Hips sit at approximately 0.54m, toes at 0.036m; wrists sit at 0.855m above a 0.825m tabletop. These joint checks are not mesh-level collision proof. Hands remain nearly still; shoulder emphasis is deliberately small. Geometric seated posing is not a commissioned seated animation.

## Playback and direction

70.57-second original scripted conversation including pauses, 10 prerecorded turns, 29 audio-aligned caption chunks. One HTMLAudioElement; `currentTime` drives visemes/captions. Synthetic audio generated offline with Piper; all cast members share the same source voice, openly disclosed. Timings derive from synthesis alignment; they are not measured human lip-sync accuracy. No amplitude-based phoneme claim.

Director accepts turn-start and authored sentence cues. Default minimum hold 5.5 seconds. Actual script has 10 cuts after the opening: speaker mediums, ECHO + Nova two-shot and a chosen Atlas listening reaction. Long holds are intentional across short interjections. All cameras remain on the audience side of the table. Clean cuts, no orbit/tween. Fixed camera is user-controlled. Reduced motion disables breathing/nods/emphasis; cuts are retained without interpolated motion.

## Provider boundary

`room.js` knows no voice or LLM service. `MockAdapter` in `core.js` emits semantic events consumed by `studio.js`:

- `turn-start`, `turn-end`: `{speaker, text, utterance, time}`.
- `timing`: current audio playback seconds (also accessible through adapter.audio.currentTime).
- `utterance`: `{id, speaker, text, audio, duration, pause, cues?, captions?, shot?, reaction?, reactionAt?}`.
- Optional `cues`: `{start,end,key}`; key maps to `viseme_PP`, `viseme_aa`, etc. Missing cues produce a closed mouth; do not fabricate phonemes.
- Optional expression/gesture extensions should be semantic cues translated into the room performance layer. Current mock consumes one restrained listening nod (`reaction`, `reactionAt`) and a small speaking emphasis. It does not implement arbitrary emotion animation or full-body gesture retargeting.
- `interruption`, `cancel`, `failure`, `state`, `reset`, `mute` support transport lifecycle. Interrupt cancels the current playback and resets that turn; Resume restarts it. Pause preserves the playback offset.

A live adapter should serialize audio, supply timing, and cancel buffered/pending turns with a generation token. Streaming buffering, backend authentication, LLM orchestration, network retry and provider-specific viseme translation remain future work. Credentials must stay server-side. Rendering does not need rebuilding for a different provider.

## Rendering and mobile budget

One renderer; one 18.5MB GLB fetch, shared geometry with three independent skeletons and cloned materials. Source GLB has 83,686 triangles before hidden eye mesh suppression and added styling/room geometry. DPR capped at 1.25 on narrow screens and 1.5 otherwise, dropping to 1 if measured frame intervals exceed 50ms over 90 samples. No postprocessing or shadow maps. Authored radial contact shading grounds chairs, table and cups. Wall slats use one 49-instance mesh instead of 49 separate meshes. Small cylinders use 16 radial segments. Morph bindings and pose temporaries are cached; the viseme cursor advances once per frame; unchanged caption text is not rewritten. Playback loop targets at most approximately 30 updates/sec; this is a scheduling cap, not achieved FPS. Runtime `window.EchoStudio.getState()` reports actual renderer counters. Static paused state renders on demand only. Hidden tabs pause audio and cancel the frame request; explicit Resume is required.

Portrait camera compositions, safe-area footer, 44px controls, captions outside the canvas. Audio begins only from a click. Loader, replay, mute, errors, context loss and no-WebGL audio/transcript fallback included. Scene load failure retains recorded playback. Dialogue load failure reports an unavailable state and reload action.

## Verification performed

- JavaScript syntax checks for all added modules and shared switcher.
- Real GLTFLoader parsing (textures stripped only in test memory), independent skeletons, 2,817 sampled skinned vertices finite.
- Wrist and toe joint positions, tabletop ellipse membership, face bounds in 25 shot/aspect combinations (320/480, 360/440, 390/440, 768/570, 1240/570).
- Mock transport checks: pause/resume offsets, replay, interruption/restart, mute, failure/retry, cancellation, one pending gap timer, fixed camera.
- Rehearsed full script events: 70.57s, minimum cut holds, authored two-shot and reaction reached.
- All ten MP3 assets decode; metadata within 0.1 seconds, cue duration matches source duration. Caption text reconstructs source utterances.
- Local asset/link existence and unchanged Current/Original application files reviewed.

Commands:

```
node tests/studio-transport.mjs
node --experimental-loader=./tests/three-loader.mjs tests/studio-rig.mjs
node --check dist/studio/studio.js
```

## Verification limits / follow-up

Managed Sites browser-control skill is unavailable. Per Sites workflow, no preview server or unsupported browser automation was started. No browser visual QA, audible playback inspection, Safari touch test, full mesh/furniture collision test or device FPS/battery benchmark was performed. Geometry checks do not establish flawless skin deformation, palm orientation, eye material appearance or perceptual lip sync. The 18.5MB character asset needs further mesh/texture optimization before broad mobile production. Distinct commissioned character models and distinct voices would improve the show's identity.


## Edition 02 audit and changes

| Observed source issue | Shipped correction |
| --- | --- |
| Portrait medium framing retreated 0.48m and widened FOV, reducing face prominence | New chest-up compositions: geometric face bounds occupy 32–33% of frame height in the five tested aspect ratios. Close cameras remain above the table and on the same audience side. |
| Reaction at 48.50s remained on Atlas through the moderator turn | Deferred speaker target is retained and applied at a later sentence boundary; moderator returns at 54.21s. No interval-based switching. |
| End padding and gaps fell back to whole utterance | `captionAt` retains the last timed caption through gaps. |
| Lower third always named speaker even while another person was shown | Scene lower third identifies the actual shot subject; caption speaker separately attributes the voice. |
| Flat furniture, luminous ring and weak material separation | Arched architectural backdrop, beveled table, upholstered rounded chairs, linen/wood procedural maps, coasters and a restrained notebook, calibrated key/fill/rim ratios, authored contact shading. |
| 49 identical slats submitted separately | One InstancedMesh, saving 48 slat submissions by construction; not an FPS benchmark. |
| Per-frame morph dictionaries, quaternion allocations and repeated DOM writes | Cached bindings, reusable pose temporaries, advancing cue cursor, text update only when changed. |

Same episode, base rig, recordings, controls, renderer and audience. No new product features or paid services. No browser screenshots or physical-device performance measurements available. Close camera bounds, contact points and furniture-to-face sightlines are checked geometrically, not a substitute for visual QA.

## Shipped credits

- Three.js r170, MIT; matching local GLTFLoader/SkeletonUtils addons. See `/lab/vendor/THREE-LICENSE.txt`.
- Existing MPFB model from met4citizen/TalkingHead, identified CC0 by its README; original local provenance in `/lab/assets/ATTRIBUTION.txt`. TalkingHead runtime is not bundled. No RPM models added.
- Offline Piper / en_US-ljspeech-high recorded voice. LJSpeech dataset public domain per model card. See `/studio/audio/ATTRIBUTION.txt`.
- Studio set, direction logic, interface, script and procedural performance authored for ECHO.
- Full alternatives and research evidence: STUDIO_RESEARCH.md and `/studio/research.html`.

## Edition 03 — approved character direction in the full room

The default `/studio/` now uses the approved Nova editorial GLB, three independent skeleton clones, and the pinned Studio Small 06 HDR environment. `/studio/?edition=2` retains the previous cast and lighting; Current and Original remain untouched. The Nova study remains at `/studio/lookdev/`.

`editorial-characters.js` creates three derived looks from one downloaded 9.07 MB GLB: Nova keeps the approved style; ECHO has a cropped silver hairstyle and sage wardrobe; Atlas has shorter dark hair, a broader jaw, warm skin, forest clothing and thin glasses. Face geometry and its relative morph deltas are transformed consistently. Edited geometry and all materials are independent per actor; source textures remain shared. These are styled variants of the same base, not three bespoke commissioned models.

The same 70.57-second recording, event-driven camera director and playback controls are retained. Mouth cue strength follows the study. One renderer handles all shots. PMREM is generated once and cleaned up at page disposal; environment failure retains built-in room lighting. No APIs, subscriptions or credentials added.

Validation: the editorial and original cast pass seated wrist/toe checks, face projection and furniture ray checks in 25 camera/aspect combinations. Editorial checks verify independent skeletons/materials/edited geometry, resolved sanitized GLTF hair names and crop bounds, 66 face targets per actor and finite speech deformations. The transport suite and separate Nova study suite pass. Offline Blender renders of derived face/hair geometry were inspected; those renders are not the browser room and omit runtime glasses. Browser visuals, touch behavior and real-device FPS are unverified. The existing renderer cadence is not an FPS guarantee.


## Edition 04

Scalp-fitted hair and audio-timed facial intent cues replace the compressed bob and near-constant speaking expression. See `STUDIO_PERFORMANCE_RESEARCH.md` for evidence, implementation, credits and verification limits.


## Edition 05

Inward conversation blocking, partner-directed eyelines, closer shot composition and authored body accents. Offline full-scene review also identified and corrected collar clearance, footwear and background lamp tangencies. See `STUDIO_NEXT_STEPS.md` for implementation, review limits and the next art/device quality gates.


## Edition 06
See STUDIO_MATERIAL_REPAIR.md for the texture-free material repair, raw asset contracts and verification limits. Current assets use no photographic atlas, baked AO or HDR environment.
