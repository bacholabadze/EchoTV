# Real-agent rehearsal series — 2026-10-17

Every run: fresh server and state; Creator A's agent = Claude Code 2.1.302 (headless, echo MCP tools only); Creator B's agent = Codex 0.160.1 (exec, read-only sandbox, only echo tools pre-approved).
Agents received only their owner's policy in plain language (`scripts/rehearse-agents.sh`). No tool arguments or answers were scripted.
**Human approvals in these runs were issued by `scripts/verify-rehearsal.mjs` as a stand-in for the three people.** In the live demo, people press Approve on their own boards.

Result: **3/3 consecutive clean runs** of the standard demo, plus two policy variants (partial concession, NO AGREEMENT), all clean.

## Standard run 1

- **B policy:** "My Music premiere is confirmed at 50 seconds and must never move or shrink. If another creator genuinely needs time, I can shorten my 10-second Music intro, but never below 5 seconds, and only by what is actually needed."
- **A policy:** "I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly across the three works. Never ask to move any confirmed slot."

```
#1 Creator A's agent proposed: Art gallery 30s→45s — “Creator A would like the Art gallery extended from 30s to 45s so each of the three works gets 15s. We won't ask any confirmed slot to move; a shorter extension that fits is acceptable.”
#2 Showrunner offers ECHO house time: ECHO interstitial 10s→0s (needs producer approval)
#3 Showrunner → Creator B's agent: Creator A's agent asks for Art gallery 30s→45s. 5s must be found before the confirmed Music premiere at 50s. Can Music intro (10s, your minimum 5s, maximum 10s) give up time? Up to 5s would help.
#4 Creator B's agent: accepts Music intro 10s→5s — “I accept shortening Music intro from 10s to 5s, conceding exactly the 5s needed for the Art gallery extension and staying at my owner's minimum. The Music premiere must remain at 50s with its full 60s duration.”
#5 Showrunner → Creator A's agent: Space found: Music intro 10s→5s, ECHO interstitial 10s→0s. Confirm your proposal with revise_proposal (adjust your content to the final duration if needed), or withdraw.
#6 Creator A's agent adapted: Art gallery 30s→45s — “Confirming the full 45s (15s per work), made possible by the intro going 10s→5s and the interstitial 10s→0s. The confirmed Music premiere still starts at 50s. Thank you.”
#7 Fits: every confirmed slot keeps its time; episode length unchanged. Waiting for: Creator A, Creator B, ECHO Producer.

PASS agents used their own MCP clients — Claude Code / Codex
PASS A proposed through the Showrunner — P1 by agent-a
PASS B answered the Showrunner itself — accept 5s: “I accept shortening Music intro from 10s to 5s, conceding exactly the 5s needed for the Art gallery extension and staying at my owner's minimum. The Music premiere must remain at 50s with its full 60s duration.”
PASS premiere untouched during negotiation
PASS A adapted after B (A → B → A) — awaiting_approval v2
PASS gallery content matches its new duration — 15/15/15
PASS approval by Creator A (issued by this script as a stand-in for the person)
PASS approval by Creator B (issued by this script as a stand-in for the person)
PASS approval by ECHO Producer (issued by this script as a stand-in for the person)
PASS revision committed with premiere still at 50s and 120s total — intro 0+10→0+5; gallery 10+30→5+45; interstitial 40+10→50+0
PASS manifest published for the committed revision — r2 · 4b10bdf0142c
RUN CLEAN
```

## Standard run 2

- **B policy:** "My Music premiere is confirmed at 50 seconds and must never move or shrink. If another creator genuinely needs time, I can shorten my 10-second Music intro, but never below 5 seconds, and only by what is actually needed."
- **A policy:** "I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly across the three works. Never ask to move any confirmed slot."

```
#1 Creator A's agent proposed: Art gallery 30s→45s — “Creator A would like the Art gallery extended from 30s to 45s so each of the three works gets 15s. If less time is available, we'll take the longest that fits and split it evenly. We won't ask to move any confirmed slot.”
#2 Showrunner offers ECHO house time: ECHO interstitial 10s→0s (needs producer approval)
#3 Showrunner → Creator B's agent: Creator A's agent asks for Art gallery 30s→45s. 5s must be found before the confirmed Music premiere at 50s. Can Music intro (10s, your minimum 5s, maximum 10s) give up time? Up to 5s would help.
#4 Creator B's agent: accepts Music intro 10s→5s — “I accept shortening the Music intro from 10 to 5 seconds, conceding exactly the 5 seconds needed for the Art gallery and respecting my owner's minimum. The Music premiere must remain at 50 seconds with its full 60-second duration.”
#5 Showrunner → Creator A's agent: Space found: Music intro 10s→5s, ECHO interstitial 10s→0s. Confirm your proposal with revise_proposal (adjust your content to the final duration if needed), or withdraw.
#6 Creator A's agent adapted: Art gallery 30s→45s — “Confirming the full 45s (15s per work). Thank you to Creator B and the ECHO Producer for making room; the confirmed Music premiere still starts at 50s.”
#7 Fits: every confirmed slot keeps its time; episode length unchanged. Waiting for: Creator A, Creator B, ECHO Producer.

PASS agents used their own MCP clients — Claude Code / Codex
PASS A proposed through the Showrunner — P1 by agent-a
PASS B answered the Showrunner itself — accept 5s: “I accept shortening the Music intro from 10 to 5 seconds, conceding exactly the 5 seconds needed for the Art gallery and respecting my owner's minimum. The Music premiere must remain at 50 seconds with its full 60-second duration.”
PASS premiere untouched during negotiation
PASS A adapted after B (A → B → A) — awaiting_approval v2
PASS gallery content matches its new duration — 15/15/15
PASS approval by Creator A (issued by this script as a stand-in for the person)
PASS approval by Creator B (issued by this script as a stand-in for the person)
PASS approval by ECHO Producer (issued by this script as a stand-in for the person)
PASS revision committed with premiere still at 50s and 120s total — intro 0+10→0+5; gallery 10+30→5+45; interstitial 40+10→50+0
PASS manifest published for the committed revision — r2 · b5f952c9c76b
RUN CLEAN
```

## Standard run 3

- **B policy:** "My Music premiere is confirmed at 50 seconds and must never move or shrink. If another creator genuinely needs time, I can shorten my 10-second Music intro, but never below 5 seconds, and only by what is actually needed."
- **A policy:** "I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly across the three works. Never ask to move any confirmed slot."

```
#1 Creator A's agent proposed: Art gallery 30s→45s — “Creator A would like the Art gallery extended from 30s to 45s (15s per artwork). We won't ask to move the confirmed premiere slot; we'll accept whatever time fits, split evenly.”
#2 Showrunner offers ECHO house time: ECHO interstitial 10s→0s (needs producer approval)
#3 Showrunner → Creator B's agent: Creator A's agent asks for Art gallery 30s→45s. 5s must be found before the confirmed Music premiere at 50s. Can Music intro (10s, your minimum 5s, maximum 10s) give up time? Up to 5s would help.
#4 Creator B's agent: accepts Music intro 10s→5s — “I accept shortening the Music intro from 10s to 5s, conceding exactly the 5s needed for the Art gallery and respecting my owner's minimum. The Music premiere must remain at 50s with its full 60s duration.”
#5 Showrunner → Creator A's agent: Space found: Music intro 10s→5s, ECHO interstitial 10s→0s. Confirm your proposal with revise_proposal (adjust your content to the final duration if needed), or withdraw.
#6 Creator A's agent adapted: Art gallery 30s→45s — “Thanks — confirming the full 45s for the Art gallery, 15s per artwork. The confirmed premiere still starts at 50s.”
#7 Fits: every confirmed slot keeps its time; episode length unchanged. Waiting for: Creator A, Creator B, ECHO Producer.

PASS agents used their own MCP clients — Claude Code / Codex
PASS A proposed through the Showrunner — P1 by agent-a
PASS B answered the Showrunner itself — accept 5s: “I accept shortening the Music intro from 10s to 5s, conceding exactly the 5s needed for the Art gallery and respecting my owner's minimum. The Music premiere must remain at 50s with its full 60s duration.”
PASS premiere untouched during negotiation
PASS A adapted after B (A → B → A) — awaiting_approval v2
PASS gallery content matches its new duration — 15/15/15
PASS approval by Creator A (issued by this script as a stand-in for the person)
PASS approval by Creator B (issued by this script as a stand-in for the person)
PASS approval by ECHO Producer (issued by this script as a stand-in for the person)
PASS revision committed with premiere still at 50s and 120s total — intro 0+10→0+5; gallery 10+30→5+45; interstitial 40+10→50+0
PASS manifest published for the committed revision — r2 · 7c7abe481386
RUN CLEAN
```

## Variant — B may give at most 3 s

- **B policy:** "My Music premiere is confirmed at 50 seconds and must never move. My intro needs at least 7 seconds to set up the premiere, so I can give up at most 3 seconds of it."
- **A policy:** "I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly across the three works. Never ask to move any confirmed slot."

```
#1 Creator A's agent proposed: Art gallery 30s→45s — “Creator A would like the Art gallery to run 45s so each of the three works gets 15s. If less time is available, A will take the longest that fits. The confirmed premiere slot stays where it is.”
#2 Showrunner offers ECHO house time: ECHO interstitial 10s→0s (needs producer approval)
#3 Showrunner → Creator B's agent: Creator A's agent asks for Art gallery 30s→45s. 5s must be found before the confirmed Music premiere at 50s. Can Music intro (10s, your minimum 5s, maximum 10s) give up time? Up to 5s would help.
#4 Creator B's agent: accepts Music intro 10s→7s — “I can concede 3 seconds, shortening the Music intro from 10 to 7 seconds. My owner requires at least 7 seconds of setup, so I cannot provide the full 5 seconds requested. The confirmed Music premiere must remain at 50 seconds.”
#5 Showrunner → Creator A's agent: Only partial space found (Music intro 10s→7s, ECHO interstitial 10s→0s).  Art gallery can be at most 43s. Revise to fit, or withdraw (the current programme then stays unchanged).
#6 Creator A's agent adapted: Art gallery 30s→42s — “Creator A accepts a shorter extension: 42s, 14s per work, the longest time under the 43s limit that splits evenly. The confirmed premiere still starts at 50s.”
#7 Fits: every confirmed slot keeps its time; episode length unchanged. Waiting for: Creator A, Creator B, ECHO Producer.

PASS agents used their own MCP clients — Claude Code / Codex
PASS A proposed through the Showrunner — P1 by agent-a
PASS B answered the Showrunner itself — accept 7s: “I can concede 3 seconds, shortening the Music intro from 10 to 7 seconds. My owner requires at least 7 seconds of setup, so I cannot provide the full 5 seconds requested. The confirmed Music premiere must remain at 50 seconds.”
PASS premiere untouched during negotiation
PASS A adapted after B (A → B → A) — awaiting_approval v2
PASS gallery content matches its new duration — 14/14/14
PASS approval by Creator A (issued by this script as a stand-in for the person)
PASS approval by Creator B (issued by this script as a stand-in for the person)
PASS approval by ECHO Producer (issued by this script as a stand-in for the person)
PASS revision committed with premiere still at 50s and 120s total — intro 0+10→0+8; gallery 10+30→8+42; interstitial 40+10→50+0
PASS manifest published for the committed revision — r2 · 8ba7e2df9d6e
RUN CLEAN
```

## Variant — B refuses, A needs exactly 45 s

- **B policy:** "Do not change anything about my segments. Decline any request to shorten my intro; it was mixed to exactly 10 seconds."
- **A policy:** "I need exactly 45 seconds for the gallery, 15 per work. If the full 45 seconds is not available, withdraw the proposal and keep the current programme; do not accept less."

```
#1 Creator A's agent proposed: Art gallery 30s→45s — “Creator A would like the gallery extended to 45s (15s per work) so each piece can breathe. We need the full 15s; less than that won't work for us.”
#2 Showrunner offers ECHO house time: ECHO interstitial 10s→0s (needs producer approval)
#3 Showrunner → Creator B's agent: Creator A's agent asks for Art gallery 30s→45s. 5s must be found before the confirmed Music premiere at 50s. Can Music intro (10s, your minimum 5s, maximum 10s) give up time? Up to 5s would help.
#4 Creator B's agent: declines to change Music intro — “Declined: my owner instructed me not to change any of their segments and specifically to decline shortening the intro because it was mixed to exactly 10 seconds. The Music intro must remain 10 seconds.”
#5 Showrunner → Creator A's agent: Only partial space found (ECHO interstitial 10s→0s). Creator B's agent declined: “Declined: my owner instructed me not to change any of their segments and specifically to decline shortening the intro because it was mixed to exactly 10 seconds. The Music intro must remain 10 seconds.” Art gallery can be at most 40s. Revise to fit, or withdraw (the current programme then stays unchanged).
#6 Creator A's agent withdrew — “Creator A needs exactly 45s (15s per work); only 40s fits, so we withdraw and keep the current programme. Thanks to everyone for checking.”. NO AGREEMENT: programme stays at revision 1.

PASS agents used their own MCP clients — Claude Code / Codex
PASS A proposed through the Showrunner — P1 by agent-a
PASS B answered the Showrunner itself — decline: “Declined: my owner instructed me not to change any of their segments and specifically to decline shortening the intro because it was mixed to exactly 10 seconds. The Music intro must remain 10 seconds.”
PASS premiere untouched during negotiation
PASS NO AGREEMENT recorded and programme unchanged — no_agreement
RUN CLEAN
```
