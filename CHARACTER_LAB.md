# ECHO Character Lab

The isolated /lab/ route evaluates a rigged base character before upgrading the full platform. It uses self-hosted Three.js, an optimized CC0 MPFB model, recorded synthetic dialogue, and phoneme cues. No live AI, payments, or voice API calls are present.

Integration boundary: window.EchoPerformance.perform({text, audioUrl, cues}) accepts timed viseme cues [{start, end, key}], in seconds. keys: PP, FF, TH, DD, kk, nn, RR, SS, CH, I, E, aa, O, U. Alternatively pass alignments [{phoneme,samples}] at 22050 Hz. Current implementation plays a complete audio resource; streaming TTS needs buffering and cancellation support. Providers should translate their timing format into this contract. Audio URLs must be browser-accessible. API credentials belong server-side.

Other controls: playClip(id), react(kind), setVisualStyle(style), enter(), exit(), stop(), getState(). Local scripted timeline is separate from character rendering. Future dialogue orchestration can send these commands without changing the avatar rig. Different models need a bone and expression mapping.

Checked: JavaScript syntax, actual GLTFLoader model parsing and skinned vertices, required morph targets, audio cue durations and asset presence. Separate offline asset rendering used to inspect eye and clothing changes. Browser rendering and mobile performance have not been verified; the displayed FPS is measured at runtime, not a guarantee. The 19MB avatar is a prototype payload; production requires mesh/texture optimization and fallback tiers. Custom character art is still needed for an original visual identity.

## Mobile refinement

Mobile-first stylesheet with a single-column stage and player, 44px minimum buttons, 48px expression controls, safe-area padding, native vertical scrolling over the canvas, system fonts, and optional transcript/about panels. No emoji in the active studio. Fullscreen-like stage mode keeps playback and exit available. Backgrounding stops playback. Short captions use proportional text chunks; phoneme timings continue to drive mouth animation.

Validation: JavaScript syntax; HTML ID uniqueness and selector references; asset presence; emoji scan; mocked-DOM checks for expression/style/camera selection, mute labels, stage expansion, and stop/reset. Actual browser rendering, iOS layout and physical touch interaction remain unverified in this environment.

## Main-platform rollout

Approved studio styling is now applied to the main product entry and all character surfaces. `index.html` and `world.html` serve the same full platform. `/lab/` retains Nova's performance studio. No separate feature branch existed; rollout is committed directly to the existing main branch through the Sites workflow.

`cast.js` loads one GLB, clones independent skeletons with shared geometry, and renders visible portraits through one fixed-size WebGL canvas copied into the existing 2D portrait slots. Nova, Atlas, Sol, the creator and ECHO moderator are styling variants of the same CC0 base rig. Hair, wardrobe, skin tint and accessories differentiate the cast. This is not a set of commissioned individual meshes. Character changes, cards, profiles and creator previews retain the existing data and flows.

Mobile panel defaults to a large active speaker with the other three in smaller frames. Wide mode shows a 2-by-2 grid; desktop shows four speakers. Text controls replace decorative emoji. Buttons and form inputs use the studio's mobile scale. The legacy particle rendering loop is removed. Background tabs pause the authored discussion.

The main panel keeps optional browser speech; mouth animation is an approximation driven by voice activity and word events. The isolated Nova studio retains prerecorded audio and timed phoneme cues. No external voice or AI service was added.

Validation: all five actual Three.js character factories build and animate, skinned vertices remain finite, cloned skeletons and expression arrays remain independent. JSDOM flow checks cover home, panel, turns, moderator profile, discovery, creator wizard, creator on stage, gifts, source card, branch, profile and About. JavaScript syntax checks pass. These checks do not verify real WebGL browser rendering, Safari layout, or device frame rate.
