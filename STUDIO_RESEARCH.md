# ECHO Studio — implementation research

Research date: 16 October 2026. Primary documentation, repositories, example pages and maintainer issue threads were retrieved. **No external demo was visually executed during this research.** “Example” below means published executable example/source, not an independently validated device benchmark. No complete browser seated podcast was verified; the defensible route is composing proven building blocks.

## Eight relevant examples

| Example / repository | Evidence and reuse | Limits |
| --- | --- | --- |
| [Three.js multiple animated skinned meshes](https://threejs.org/examples/webgl_animation_multiple.html), [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html) | Published example; utility supports cloning skinned hierarchies. Reuse one loaded GLB with independent skeletons in one scene. | Does not establish seated contact quality or phone performance. |
| [Three.js skinning and morphing](https://threejs.org/examples/webgl_animation_skinning_morph.html) | Example description explicitly separates facial morphs from blended body clips. Model credited to Tomás Laulhé, modified by Don McCurdy, CC0. | Robot example demonstrates architecture, not realistic humans. |
| [Three.js skinning IK](https://threejs.org/examples/webgl_animation_skinning_ik.html) | Published IK example provides a reference for limb targeting. | Not proof that the existing ECHO rig supports identical IK chains. Hand placement must be checked against its actual bones. |
| [TalkingHead](https://github.com/met4citizen/TalkingHead), Appendix H | README includes shared-scene, multi-avatar `avatarOnly` code and `speakTo` targets. Reusable speech/face/gaze machinery. | Explicitly experimental mode. Requires compatible rig and facial targets. README videos are author-reported real-time captures, not our observations. |
| [three-vrm examples](https://pixiv.github.io/three-vrm/packages/three-vrm/examples/), [source index](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/index.html) | Published bone, expression, animation and smoothed look-at examples; standardized humanoid interface is useful for seated posing. | A VRM migration is an asset pipeline change, not a drop-in upgrade for arbitrary GLB. |
| [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) | Repository documents 115 rigged characters, animation assets and facial blendshapes. Potential replacement asset source. | Unity/FBX-oriented setup; conversion, material cleanup and rig adaptation needed for web. |
| [Theatre.js](https://github.com/theatre-js/theatre) | Three.js animation authoring examples and visual timeline tooling. Useful for a deliberately authored opening move. | A timeline does not provide semantic dialogue direction. README says development moved temporarily to a private repository; do not infer a current release cadence. |
| [Three.js responsive example/manual](https://threejs.org/manual/pages/responsive.html) | Executable resize samples and explanation of drawing-buffer budgets. Reuse aspect updates and capped render resolution. | Pixel budget guidance is not an ECHO frame-rate measurement. |

## Three strongest approaches

### 1. Existing Three.js rig + custom dialogue director — recommended conditionally

- **What is evidenced:** official examples support independent skinned clones, body animation and facial morph control. [Three.js source](https://github.com/mrdoob/three.js) and [MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE).
- **Reuse:** existing loader, avatar GLB, materials and speech assets after inspecting their provenance; one scene and renderer, a small set of camera transforms, procedural pose layers on the existing skeleton.
- **Asset restrictions:** Three.js MIT does not license ECHO's GLB. Preserve its existing credits and independently inspect provenance before publishing any newly introduced asset. No third-party asset is recommended solely because it can be downloaded.
- **Maintenance/compatibility:** stay on the project's installed Three.js version and use its matching addons. Current official documentation and runnable examples are available; no unverified commit-frequency claim is made.
- **Supporting discussion:** [skinned-character performance investigation](https://discourse.threejs.org/t/tips-for-optimizing-skinned-boned-characters/47326). A reporter ultimately isolated their slowdown to physics. This is a useful profiling lesson, not a transferable benchmark.
- **Mobile feasibility / effort (engineering estimate):** best fit and lowest integration cost if the rig already exposes leg/arm/head bones and face morphs. Three seated characters, bounded DPR, restrained materials and no postprocessing are a sensible initial budget; measure the finished scene. Procedural elbow/wrist placement still needs visual QA.
- **Paid services:** none required. Use local clips or clearly labeled device speech fallback.

### 2. TalkingHead avatarOnly inside the existing scene

- **Reuse:** face/speech controller, gaze targets and shared-scene armatures; seated animation still requires compatible bones and verified chair/table placement.
- **License:** [MIT code](https://github.com/met4citizen/TalkingHead/blob/main/LICENSE). README distinguishes CC0 MPFB sample from noncommercial RPM/other samples. Do not assume all samples share the code license.
- **Compatibility:** Mixamo-compatible skeleton plus ARKit and Oculus face shapes. Default TTS integration uses Google Cloud; external audio is possible, so paid service is optional.
- **Maintenance evidence:** [release notes](https://github.com/met4citizen/TalkingHead/releases) document experimental multi-avatar support, disposal and audio interruption fixes. [Issue 124](https://github.com/met4citizen/TalkingHead/issues/124) reports compressed avatar and morph-target compatibility problems; a warning to inspect actual inputs, not proof all avatars fail.
- **Mobile / effort (inference):** medium integration cost, potentially high if current morph targets differ. Three instances should share one renderer/loop. No verified three-avatar mobile benchmark.

### 3. three-vrm standardized avatar pipeline

- **Repository/demo:** [three-vrm](https://github.com/pixiv/three-vrm), linked examples above. Reuse humanoid pose access, facial expressions and look-at smoothing.
- **License/restrictions:** [MIT runtime](https://github.com/pixiv/three-vrm/blob/dev/LICENSE); each avatar's author license and VRM metadata remain separate. Require explicit redistribution permission for browser-delivered models.
- **Maintenance evidence:** [release page](https://github.com/pixiv/three-vrm/releases) lists v3.5.5 and v3.6.0-beta.0, with documented material and loader fixes. Pin a compatible stable version. README warns WebGPU node-material compatibility changes more often; retain WebGL for this prototype.
- **Supporting discussion:** [duplicate animation-loop issue](https://github.com/pixiv/three-vrm/issues/1142) illustrates why playback actions must not create extra requestAnimationFrame chains. [Issue list](https://github.com/pixiv/three-vrm/issues) includes pose-retargeting concerns; validate imported clips.
- **Mobile / effort (inference):** viable with appropriately simple VRM assets, limited spring bones and material passes, but highest migration effort if ECHO is ordinary GLB. No measured phone performance asserted.
- **Paid services:** none required for runtime; asset creation/licensing remains a separate choice.

## Why the first approach wins for this iteration

It protects the existing character lab and comparison modes, avoids a rig-format migration, and spends the effort on composition, contact, pacing and performance. Before committing: inspect bone names and rest transforms, morph names, triangle/material counts, model scale and license. If seated pose is impossible without obvious deformation, use a documented replacement or table-obscured lower-body framing and state that compromise. Do not describe rigid portraits as seated humanoids.

Theatre.js is optional authoring infrastructure, not a necessary dependency. Its core is Apache 2.0 while its editor is AGPL 3.0. A small event-driven director is easier to keep provider-neutral and to test for this scope.

## Implementation implications (design proposals, not external claims)

1. One forest/sage/ivory room; curved table and three chairs in a shallow arc; fixed camera axis on the audience side. Pose hips/thighs/knees deliberately, place wrists above or beside the table, avoid imported standing gestures that pull elbows through furniture.
2. Author separate portrait/landscape shot transforms: establishing wide, host medium, both guest mediums, two-person view, selected listener reaction. Choose cuts only from sentence/turn cues, normally after 5–9 seconds; retain a shot through short interjections.
3. One transport clock drives captions, audio progress, face animation and director decisions. Provider adapter emits turn start/end, speaker/text, playback timing, optional visemes/emotion/gesture and cancellation/failure. A mock scripted adapter must be visibly identified.
4. Independent blink phase, small breathing and bounded head gaze. Sparse cue-driven nods. Mouth motion from amplitude or scheduled syllables must not be described as phoneme-accurate.
5. Begin with capped DPR, no screen-space effects and minimal shadow work. Pause the loop on hidden pages; dispose on navigation. Record renderer statistics and actual timing on tested devices, with device/context noted.
6. Explicit gesture starts playback. Pause/resume/replay/mute and cancellation share the same transport, not extra loops or Audio elements. Loading, missing audio, failed model and no-WebGL states must remain navigable with readable transcript.

## Credits and evidence discipline

No new model was downloaded or installed for this research. The links above are research references, not a claim their assets ship in ECHO. Add actual shipped-asset credits only after source inspection. No scripts from forums were installed. Repository activity above reflects the retrieved pages; ambiguous yearless release timestamps are deliberately not interpreted. No measured FPS, seated-contact verification or audible synchronization verification is claimed by this document.
