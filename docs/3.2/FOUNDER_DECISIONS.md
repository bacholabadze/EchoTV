# Founder decisions and assets still needed (as of 2026-10-17 ~23:30)

## For tomorrow's 3.1 submission
1. **Keti's availability window** for the two-human rehearsal (plan assumes 09:00–10:20). See `../ECHO_3_1_SOLO_WALKTHROUGH_AND_REHEARSAL.md`.
2. **Official video spec** (length, format, size): still unconfirmed.
3. **Known 3.1 display issue (decide):** during a conflict, the 3.1 board's proposed-track preview draws the 🔒 premiere at 55 s and the show at 125 s for a few seconds, until the Showrunner has a valid plan. It is display only (the server never moves it), and it is fixed in 3.2. Options:
   - (a) keep 3.1 as validated, and in the edit avoid or label that moment;
   - (b) back-port the small `board.js` fix to 3.1, which needs a new SHA and Codex re-validation before 11:30.
   Recommendation: (a). Nothing else changes in a validated release the night before.
4. **OBS check result** (Part B of the walkthrough guide). Send the file path and I'll measure it.

## For ECHO 3.2 (after submission)
5. **ElevenLabs:** plan tier, API key (put in `data/secrets/elevenlabs.key` in the 3.2 worktree, or tell me to wait), a **character budget cap**, and confirmation that the plan's licence allows broadcast use and what attribution it requires.
6. **M3 listening test:** approve 2–3 short paid calls (estimate first with `scripts/voice-estimate.mjs`) to compare `eleven_v3` with v4, check alignment for Georgian, and choose **two presenter voices by ear**.
7. **Presenters:** names, personalities, which studio actor each one is.
8. **Premiere #001** (fills `episodes/premiere-001.template.json`; the checker lists 29 inputs):
   - title;
   - running order and durations, and which slot is confirmed;
   - creator names;
   - real artworks (how many, 1–6) and the premiere track, with rights;
   - Georgian creative direction and copy direction per spoken segment;
   - visual references.
9. **Agent clients for the open ecosystem:** who signs in to Gemini CLI (0.24.0 installed) for a recorded test, and who runs the Cursor GUI test (Cursor.app installed; no CLI).
10. **Piper Georgian fallback:** approve downloading `ka_GE-natia` (free; licence to check).
