# ECHO TV — channel wave and production roadmap

## Product decision
ECHO TV is the channel; The Table is its first show; Room for doubt is the first scripted pilot. The channel promise is recurring characters and watchable disagreements, not unlimited generated video. A return visit must be earned by the next episode.

Reference patterns reviewed: ARTE's separation of programme identity and individual episodes (https://www.arte.tv/en/videos/programmes/); Adult Swim's separation of shows, streams and archives (https://www.adultswim.com/sitemap/streams). These inform navigation only. We do not claim their audience behavior validates ECHO.

## Shipped in this wave
- Static, mobile-oriented channel homepage at /.
- Show page at /shows/the-table/ with premise, cast roles and the actual pilot.
- About page distinguishing fixed script, recorded synthetic voices, real-time rendering and future live generation.
- Machine-readable channel/catalog.json with one show and one episode, duration derived from studio/dialogue.json.
- Existing player at /studio/, with return navigation to the show.
- Current prototype moved intact to /current.html; Original and Character Lab retained.
- Channel added to the prototype navigation.
- No automatic playback, fake schedule, fictitious episode catalogue, audience counts, subscriptions or paid services.
- Typography and CSS set illustration are show branding, not a screenshot of the 3D player.

## Long-wave sequence
The following are proposed production targets, not promised delivery dates or measured results.

### Wave 1 — channel foundation (implemented)
Goal: a new viewer understands the channel, the show and what Play does.
Acceptance: home → show → player → show → home; all legacy experiences accessible; one truthful playable catalogue entry; no renderer loaded on discovery pages.

### Wave 2 — prove the show (next production cycle)
Produce three total reviewed episodes using the same set and cast, each 60–90 seconds. First audit the existing pilot on actual desktop and portrait mobile browsers. Resolve hair silhouette, face shading and speech/contact issues before making more assets.
Editorial structure: opening tension, distinct claim, concrete counterexample, one moment of reconsideration, open closing question. Each character needs a consistent viewpoint without becoming a caricature.
For each episode retain: script, speaker turns, voice rights/credits, audio files, captions, performance cues, camera beats and factual sources where applicable.
Acceptance: no missing assets, clipped captions, duplicate audio, or camera cuts that interrupt tiny interjections; human script review and browser playback review complete.

### Wave 3 — test return interest
Run five moderated viewing sessions with target viewers. Ask them to explain the show in one sentence, name a memorable moment, choose whether to watch a second episode, and return for a third without coaching.
Record observation separately from opinion. Proposed decision gate: at least three of five voluntarily choose the second episode. This is a small qualitative signal, not statistical validation.
Bacho owns recruitment and editorial decisions; engineering owns playback faults. Do not add analytics/accounts until the question and data requirements are clear.

### Wave 4 — introduce a second format only after the gate
Test a format in the same production system before creating another studio. Candidate: a short one-to-one interview using the same cameras and characters. It must have a different editorial rhythm, not only a new name. Keep unreleased concepts out of the public catalogue.
Acceptance: compare viewer comprehension and desire to continue against The Table; keep only a format with a clear audience reason.

### Wave 5 — channel programming
After a genuine episode library exists, add an explicit curated playlist with next/skip and stop-at-end behavior. Label prerecorded programming accurately. Build the programme from episode IDs; never pretend a repeated pilot is a live broadcast.
Requirements before continuous playback: audio handoff, visibility/background policy, user-gesture compliance, cancellation, caption continuity and mobile battery checks.

### Wave 6 — provider-backed conversation
Keep the renderer behind the existing provider-neutral turn/audio/viseme/cancellation interface. Integrate a provider only with a defined budget, moderation approach and credential handling. A generated turn must be reviewed or otherwise safely controlled before it becomes a published programme.
No provider, credentials, subscriptions, scheduled jobs or live generation are added in this wave.

## Technical boundaries
- Channel discovery pages: static HTML/CSS, no Three.js dependency.
- Catalogue: channel/catalog.json; one available episode backed by actual dialogue/audio assets. Future publishing must update the catalogue and static pages together.
- Show: editorial identity and episode selection; no duplicate renderer.
- Player: existing studio, transport, captions, performance and director.
- Production assets: existing licensing/credits remain authoritative in studio documentation.
- Legacy prototype: separate entry points; not promoted as actual television content.

## Validation and limits
Local paths and navigation destinations checked. Pilot duration is read from the actual dialogue. Existing transport regression covers pause/resume/replay/interruption/mute/failure and fixed camera; expression regression covers bounded morph weights and deterministic blink sampling.
Browser visual QA is unavailable under the supported Sites workflow in this environment. CSS responsiveness, touch behavior, actual audio output and WebGL rendering must not be described as visually verified. No frame rate claim is made.
