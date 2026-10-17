# ECHO TV — judge-facing UX audit (3.2 worktree, 2026-10-17)

**Method:** a subagent drove the real flow on a fresh server (port 8791, throwaway data):
- r1 → conflict → concession → adapted proposal → three human approvals clicked on the real board → r2 → Publish → Go live → full 120 s broadcast → ended. Plus a NO AGREEMENT pass.
- Agents were simulated through the real HTTP API with their own agent tokens (as in `tests/browser/board.mjs`).
- An agent's attempt to approve returned 403.
- 38 screenshots (1920×1080 projector, 1440×900, 390×844 mobile) and the capture script are kept outside the repo (session scratchpad `ux-audit/`). No tokens in any output.

**Observed** = seen in a screenshot or measured. **Suggest** = recommendation. The voice routes added later in 3.2 were not part of this audit.

The board UI is the same in 3.1 (`d0f4bd2`) and 3.2 at the audit point, so these findings apply to the frozen 3.1 release too.

## 1. What a first-time judge sees

### r1 (start)
**Observed:**
- The summary row reads "EPISODE … · SHOW REVISION r1 · ON-AIR MANIFEST not published · BROADCAST queued".
- Below it: a running-order bar and six panels of equal weight.
- The key fact, "premiere confirmed at 0:50, cannot move", appears only as a ~14 px 🔒 and a 12 px grey hint.
- Nothing says what will happen or who acts next.
- On the broadcast, "▶ Watch with sound" covers the slate headline.

### Proposal / conflict
**Observed (most important finding):**
- The proposed-track preview is built from the raw request (`changes + concessions + houseChanges`, `board.js:57-61`). During the conflict it draws the 🔒 Music premiere at **55 s** and the total as **125 s**.
- At the key moment, the picture shows the protected slot moving, while the text says it must still start at 50 s.
- The server never moves it; this is a display error. It is verified in code.

Also observed:
- The 0 s interstitial renders as a clipped sliver.
- The Negotiation panel is a dense transcript with min/max arithmetic.
- Creator B's board does not say "your agent was asked to give up time".

### Waiting for approval
**Observed:**
- A creator knows it is their turn only from "Approve v2", which sits below the fold: y≈994 px at 1440×900, y≈1688 px on mobile.
- There is no header cue, and "v2" is never explained.
- A Showrunner message shows an MCP tool name to people ("Confirm your proposal with revise_proposal…").
- Disabled "Go live" is a faded primary button with 1.49:1 contrast, so it looks semi-active.

### r2 committed → published → live → ended
**Observed:**
- The diffs are monospace `start+duration` strings.
- "Premiere still at 0:50" is never stated as the outcome.
- Publish is enabled at r1 and stays enabled after publishing; a second click creates publication #2.
- During the 5 s countdown the board says "on air" and shows no countdown.
- On the broadcast:
  - the "Next · Music premiere at 0:50 · confirmed" ticker is grey on light artwork (~1.7:1 contrast);
  - the premiere badge "PREMIERE · CONFIRMED SLOT 0:50" is the best outcome cue, but small;
  - the end slate has no recap of what was negotiated.
- The NO AGREEMENT pill is clear and honest.

### Cross-cutting
- No "what happens next" anywhere.
- The same layout for every role.
- Jargon: r/v numbers, P1, base r1, manifest, hash, queued, seeded, house, tool names.
- About 40 lines of transcript and feed on screen at once.

## 2. Recommended guided flow

One step strip above the existing board: **Choose a segment → Request available airtime → Review → Approve → Watch**. All states are derived from the server state via SSE. No optimistic success.

| Priority | Recommendation | Backend change |
|---|---|---|
| P0-1 | Step bar + "your turn" banner, from `proposal.status`, `requiredApprovals`/`approvals`, `broadcast.state`, `/api/me` | none |
| P0-2 | Fix the conflict preview: before a valid plan exists, show the request as text ("needs 15 s more — doesn't fit yet"); draw the proposed track only from a plan that respects the rules | none |
| P0-3 | Show the outcome: "Premiere still at 0:50 🔒" after commit and at publish; on the broadcast, from the measured onset | none |
| P0-4 | Producer next-action card: Publish only when approved and not yet published; Go live only when ready; "Going live in N" from `onAirAt` instead of "on air" | none |
| P1-5 | Plain wording ("Version 2"); hashes behind "Verify"; no tool names in messages shown to people | none |
| P1-6 | Per-role boards (creator "My segment", producer checklist, public steps + timeline) | none |
| P1-7 | Broadcast: move "Watch with sound" off the headline; solid ticker backing | none |
| P2-8 | Optional read-only availability estimate (`region()` / `regionShortfalls()` already compute it) | new GET |

**Step 2 "Request available airtime"** is today `propose_change` → `POST /api/proposals` → Showrunner, then the other agent's `respond_to_request` and the proposer's `revise_proposal`.
- People cannot start a proposal from the board (`proposeChange` accepts agent tokens only). The honest version is "tell your agent": show the instruction and a copy button, and complete the step only on a real `proposal_created` from that creator's agent.
- `request_slot` (holds) does not fit this step: holds are not drawn and have no confirm button.

**Must stay real:**
- Only owners propose for their segments.
- Approvals are bound to the exact version; agents cannot approve.
- The confirmed slot is re-checked at commit.
- Viewers start only after server activation.
- Tokens stay private.
- The fallback agent stays labelled.

## 3. Georgian interface copy (informal შენ)

| Georgian | Meaning |
|---|---|
| აირჩიე სეგმენტი | Choose a segment |
| მოითხოვე თავისუფალი დრო | Request available airtime |
| გადახედე ცვლილებას | Review the change |
| დაადასტურე | Approve |
| უყურე ეთერს | Watch the broadcast |
| ინსტრუქციის კოპირება აგენტისთვის | Copy instruction for my agent |
| ვადასტურებ · ვერსია 2 | Approve · version 2 |
| უარყოფა | Reject |
| გამოქვეყნება | Publish |
| ეთერში გაშვება | Go live |
| ეთერის გახსნა | Open broadcast |
| შენი ჯერია | Your turn |
| შენს დადასტურებას ველოდებით | Waiting for your approval |
| აგენტები თანხმდებიან… | Agents negotiating… |
| შენი აგენტი თავისუფალ დროს ერგება | Your agent is adjusting to the available time |
| დადასტურებული დრო დაცულია | Confirmed slot protected |
| პრემიერა ისევ 0:50-ზეა 🔒 | Premiere still at 0:50 |
| ვერსია შეიცვალა — გადახედე და დაადასტურე ხელახლა | Version changed: review and approve again |
| აგენტს დადასტურება არ შეუძლია — მხოლოდ ადამიანს | An agent cannot approve, only a person |
| შეთანხმება ვერ შედგა — გადაცემა უცვლელია | No agreement: programme unchanged |
| გამოქვეყნდა — ეთერისთვის მზადაა | Published: ready for air |
| ეთერამდე {N} წამი | Going live in N s |
| პირდაპირ ეთერში | Live |
| ეთერი არ მიდის | Off air |
| ეთერი დასრულდა | Ended |
| გამოქვეყნება გაუქმდა — ეთერში არ გავა | Withdrawn: will not air |
| ვერ დადასტურდა — ვცდილობთ ხელახლა | Unable to verify: retrying |

## 4. Accessibility / legibility

**Observed:**
- At 1920 projection: labels 10 px, hints 12 px, durations 11 px, body 14 px.
- Broadcast manifest line and ticker are 13–14 px.
- Colour-only cues: owner colours, amber "changed" outline, grey ✓.
- Truncation: "Music i…", "5(", and "M…/E…/O…" on mobile.
- On mobile, Approve is ~1,700 px down. The broadcast end slate is clipped, and the sound button covers it.
- Reject and Reset use native `prompt()`/`confirm()`.
- Already good: amber focus-visible outlines, 40–44 px buttons, reduced-motion support, `role=alert` and `aria-live` on faults.

**Suggest:**
- Projector sizes: labels ≥ 14 px, body ≥ 18 px.
- Text alongside every colour cue.
- Outlined disabled buttons with the reason underneath.
- Mobile: step bar and turn banner first, with a sticky Approve bar.
- In-page dialogs instead of native ones.

## 5. Implemented in 3.2 (this branch only; the 3.1 release is unchanged)

| Item | What was built | Test |
|---|---|---|
| P0-1 step bar + "your turn" | `#guide` above the board: 5 steps in Georgian, with English underneath. The current step, card text and buttons are derived from server state on every update. "შენი ჯერია" plus Approve/Reject appear only for people whose approval is still needed. On mobile the guide is sticky and shows only the current step | `tests/browser/guided-flow.mjs` |
| P0-2 conflict preview | The proposed track is drawn only from the Showrunner's validated plan (`proposal.preview`, awaiting approval). Before that, the request is shown as text: "requested … · does not fit yet" | same: no track while negotiating; the plan keeps the premiere at 50 s |
| P0-3 outcome | "🔒 Music premiere — ისევ 0:50-ზეა", computed from the layout or plan versus the booking, at every step. It shows ⚠ if a plan ever disagreed | same |
| P0-4 producer | The guide offers Publish only when everyone has approved and the revision is unpublished, then Go live, then a countdown and the live clock. `#publish-btn` is disabled once the current revision is the ready publication. The summary says "starting" during the countdown, not "on air" | same |
| Not done yet | P1-5 wording/hashes, P1-6 per-role boards, P1-7 broadcast sound-button overlap and ticker contrast, P2-8 availability estimate, a human "tell my agent" intent | — |

The guide's buttons call exactly the same endpoints as the existing board (`/api/proposals/:id/decision`, `/api/publish`, `/api/golive`), and the server still decides. Agents still get 403 on approval (asserted).
