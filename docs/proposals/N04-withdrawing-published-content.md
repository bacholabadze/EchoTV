# Proposal N04 — rejecting or withdrawing content that is already published

**Status: PROPOSAL, not implemented. Needs the product owner's approval.** Raised by Codex's regression report on `7ee7394` (N04).

## Current behaviour (reproduced)

The producer publishes r1, then marks the gallery's current revision **rejected** in editorial review. The review succeeds (approval cleared), but **Go live with that exact publication still succeeds**. Review changes no programme revision, and go-live does not re-check reviews. So today "Reject" only affects future publications; it does not withdraw a ready one. Nothing documents that.

## Principles (from the Master Plan)

- Publications and their media stay immutable and auditable (§9, §11). Nothing is edited or deleted after the fact; a withdrawal is a new, logged event.
- Confirmed airtime is never moved without its owner (§4.1, §6).
- Humans decide, not agents or automation (§7). Failures are visible on screen, never silent (§25).
- Unapproved content never reaches air (§7, "does not").

## Proposed policy

| When | What "Reject" (or a new "Withdraw") does | What viewers and the board see |
|---|---|---|
| **Before air** (publication ready) | **Rejecting any segment revision contained in the ready publication withdraws that publication.** The broadcast returns to `queued` and the audit gets `publication_withdrawn {publicationId, segmentId, reason, by}`. Go live with that publication is refused with the reason. To air, the producer fixes the content (new media or a programme change), it gets approved, and the producer publishes again (new publication number). | Board: "Publication #n withdrawn by <producer>: <reason>". Viewers: the standby slate again. |
| **On air** | No automatic action. The producer has two explicit choices, each requiring a reason: **Stop broadcast** (exists today: technical-break slate), or **Pull segment** (new): for the rest of that segment's slot the player shows ECHO's house slate "Withdrawn by the producer", and the following segments, including confirmed slots, still start on time. | A visible "Withdrawn" slate with the reason category, never a blank frame or silent "Live". |
| **After air** | The archived publication is marked withdrawn and is not replayed. Its manifest and media stay stored for audit. | Archive shows "Withdrawn". |

What it never does: delete media, edit a manifest, move or shorten confirmed airtime, or silently substitute another creator's content. Creators cannot withdraw on their own; they can ask the producer, who decides.

## Options for the decision

1. **Recommended for the hackathon:** implement only the pre-air rule (small, deterministic, about 1–2 hours with tests), keep **Stop broadcast** as the on-air control, and defer **Pull segment**.
2. Full policy now (pre-air + Pull segment). More UI and player work right before the deadline; higher risk.
3. Keep the current behaviour, but document that Reject affects only future publications, and show on the board when a ready publication contains rejected content.

## Acceptance tests (for whichever option is approved)

- Publish r1 → reject the gallery r1 → go live with publication #1 returns 409 with the reason; the audit has `publication_withdrawn`; the broadcast is `queued`; viewers see standby.
- Fix and re-approve → publish → new publication #2 goes live; #1 stays in history as withdrawn.
- Reject a segment **not** in the ready publication → the publication is unaffected.
- (Option 2) Pull segment on air → viewers see the withdrawn slate within one second; the next segment starts on time; the confirmed premiere still starts at 0:50; it is logged.
- Agents can never withdraw (403), and creators can't either (403).
