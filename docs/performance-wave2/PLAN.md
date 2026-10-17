# Character performance wave 2

Baseline: 9ca8eceb28ba32c6f10207c469f62757d78d0f4b. Worktree echo-stage-visuals; branch echo-visual-upgrade. This checkpoint precedes all animation modifications. No edits to Claude's worktree, protected 3.1, backend, agents, voice services, booking or publication logic.

Audit: existing editorial characters use independent skeletons, named spine/head/eye/arm/forearm/hand/finger/leg bones and 66 facial targets. The current performance layer has small face events, periodic blinking, fixed breathing and almost imperceptible one-sided wrist gestures. Dialogue already carries authored gestures, attention targets, facial intents and sentence boundaries. Audio owns time through MockAdapter; retain that contract.

Dependency order:
1. Measure seated rig and joint axes; establish baseline animated review.
2. Add bounded, event-driven upper-body gestures and listener posture; retain seated leg/foot contacts. Extend supported facial events and transitions.
3. Improve visual direction at semantic boundaries without changing transport, captions, dialogue timings or audio.
4. Sample animated geometry, contacts, frames, pause/replay and reduced motion; run existing studio and transport tests.
5. Compare identical real-renderer sequences, record a short video, inspect temporal frames and benchmark CPU/render costs. Document limitations and selective integration.

No new decorative assets planned: the existing studio already frames the conversation. No new character, rig, textures, external inference or paid provider calls are needed. Legs will remain planted unless evidence supports a safe, useful adjustment.
