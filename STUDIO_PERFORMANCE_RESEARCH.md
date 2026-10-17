# Studio Edition 04 — hair and facial performance

Research and implementation review: 16 October 2026.

## Findings and decisions

1. [TalkingHead](https://github.com/met4citizen/TalkingHead) exposes separate gaze, speaking/listening and blendshape controls. Its README describes browser-captured demonstrations; those videos were not played in this environment. We reuse the design principle, not the library: small expression envelopes, different listening/speaking behavior, and independent eye/head motion. No new runtime package or voice service was installed. TalkingHead code is MIT; its sample assets are not automatically covered by that code license.
2. [three-vrm ExpressionManager](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMExpressionManager.html) explicitly separates mouth, blink and look-at expression groups with override handling. This official API documentation supports our channel arbitration: visemes dominate the speaking mouth, blinking suppresses eyelid squint/widening. It does not establish a realism benchmark. No VRM migration is needed for the existing 66-target GLB.
3. [TalkingHead / MPFB maintainer discussion #159](https://github.com/met4citizen/TalkingHead/issues/159) documents rig/shape-key workflows and warns that Blender-specific materials do not necessarily export well to GLB. We retain the inspected existing rig and export explicit mesh geometry, base-color maps and tangent-space normal maps. We did not execute scripts from discussion comments.
4. [Blender 4.2 hair interpolation documentation](https://docs.blender.org/manual/en/4.2/modeling/geometry_nodes/hair/generation/interpolate_hair_curves.html) describes surface-based guides and rest-position attachment. The key lesson used here is scalp attachment. Our implementation is a custom offline BVH projection onto the actual neutral head surface, followed by opaque mesh export; it does not run Blender hair curves or strand simulation in the browser.

## What changed

The old cropped bob retained an unnatural silhouette because it was shortened vertically. Edition 04 hides that mesh and loads `studio-hair.glb`: three scalp-fitted styles with a shaped hairline, fine strand color/normal maps, and a tied-back knot for Nova. These meshes are generated from the existing CC0 head geometry and attached to each character's head bone. One roughly 2 MB hair library is shared by the three actors. No new third-party asset license or paid service is introduced.

`performance.js` samples authored per-turn cues from audio time. It supports questioning, consideration, doubt, warmth, resolve and acknowledgment. Small asymmetric facial weights rise, hold briefly and release; mouth expressions are attenuated during speech. Each actor has a deterministic, non-uniform blink schedule and occasional small eye refixations. Selected listener acknowledgments include a short nod. Reduced-motion mode removes the added gaze refixations and nods. These are expressive animation cues, not psychological microexpression detection or live emotion inference.

The complete 70.57-second conversation, existing event-driven camera cuts, fixed camera mode and all playback controls remain. The 15-second Nova study also uses the new hair and Nova's matching performance cues. Current, Original and the Studio V2 comparison remain available.

## Evidence and limits

Automated checks cover all requested expression names on the loaded rig, their arrival at actual morph weights, speech-mouth arbitration, bounds, distinct blink schedules and deterministic pause/replay sampling. Three-character checks load the real hair GLB, confirm old hair is hidden, head-bone attachment, independent skeletons and 25 camera/aspect combinations. Transport, legacy rig and Nova study suites pass.

Actual offline Blender hair and facial-expression renders were viewed, including revision after the first render. They verify authoring geometry only: they do not show the browser renderer, complete room, runtime glasses or final per-character skin variation. The hair remains stylized and close-cropped; it is not strand-level photorealistic grooming. Supported browser QA remains unavailable, so mobile visual quality, touch behavior and FPS are unverified. No frame-rate or realism benchmark is claimed.
