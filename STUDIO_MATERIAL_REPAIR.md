# Edition 06 — coherent material foundation
The user reported patchy light/dark skin and two conflicting hair silhouettes. Source inspection found a photographic skin atlas, baked occlusion, runtime tint multipliers, an obsolete hidden bob and a second fitted hair library. These are confirmed source facts; the exact browser artifact was not reproduced.

## Implemented
- New cast-clean-v6.glb and hair-clean-v6.glb URLs avoid reusing cached asset names.
- Physically removed the obsolete bob and isolated rear bun. One fitted short hairstyle per actor.
- Removed image textures, baked AO, normal maps and vertex color layers from current cast assets.
- Absolute per-character skin/cloth/hair palettes in materials.js; new opaque front-face materials instead of cloning inherited shader state.
- Warm neutral studio lighting with no HDR environment. Forest, sage and ivory room retained.
- Preserved skeleton, 66 facial targets, authored micro-expressions, speech cues, editing, controls and original comparison experiences.
- No new services, dependencies or user features.

## Verification
Raw GLB and runtime material assertions verify no image layers, one skin and one fitted hair material per actor, explicit colors, front faces and absent obsolete hair. Rig tests verify finite deformation, independent actors, wrist/toe placement, attention and gesture samples, and 25 camera/aspect combinations. Transport and expression tests pass. Nova study uses the actual current cast factory and assets.

Four offline Blender renders were reviewed: moderator, both guests and wide. They show continuous skin color and no rear ball/double hair geometry. Offline lighting and tone mapping differ from Three.js; these renders do not verify WebGL appearance, touch behavior, playback sound, device performance or all animation collisions. Browser QA was unavailable under the supported Sites workflow.

## Honest scope
This is a deliberately simplified editorial material foundation, not realistic hair or finished premium digital humans. Hair remains a solid sculpted cap. Higher detail should be authored into one validated asset/material pipeline, not layered over this with an unrelated scalp or photographic atlas. Runtime browser visual review remains the next acceptance gate before claiming final visual quality.

## Credits
Existing MPFB-derived CC0 character, modified locally in Blender; project-authored hair and garments/material edits. Three.js r170 / GLTFLoader / SkeletonUtils, MIT. Existing voice recordings and attribution retained. Historical texture and HDR assets are retained for earlier versions but not loaded by Edition 06.
