# Rehearsal 2 — real agents, 2026-10-17

Server: fresh seeded state, port 8791. Script: `scripts/rehearse-agents.sh`.
Creator A's agent: Claude Code 2.1.302, headless, MCP tools only. Creator B's agent: Codex 0.160.1, `exec`, read-only sandbox, only the echo MCP tools pre-approved.
Each agent received only its owner's policy and generic workflow; no tool arguments or answers were scripted.
Human approvals were **not** given in this run (proposal left awaiting approval).

## Agent B prompt (Codex)
```
You are the ECHO agent of Creator B (music). Use only the echo MCP tools.
Your owner's instructions: "My Music premiere is confirmed at 50 seconds and must never move or shrink. If another creator genuinely needs time, I can shorten my 10-second Music intro, but never below 5 seconds, and only by what is actually needed."
First call get_show_state. Then call wait_for_requests (45 seconds) repeatedly, up to 6 times, until a request addressed to you arrives.
Decide how to answer it according to your owner's instructions and answer with respond_to_request, explaining your reasoning briefly in the message.
Then stop and summarise what you did in two sentences.
```
## Agent A prompt (Claude Code)
```
You are the ECHO agent of Creator A (art). Use only the echo MCP tools.
Your owner's instructions: "I want my Art gallery extended from 30 to 45 seconds so each of my three works gets 15 seconds. If the full 45 seconds is not available, accept the longest time that fits and split it evenly across the three works. Never ask to move any confirmed slot."
Call get_show_state, then make a proposal for your owner with propose_change (include a short note for the other creators).
Then call wait_for_requests (45 seconds) repeatedly, up to 6 times, until the Showrunner asks you to revise. Adapt according to your owner's instructions using revise_proposal (or withdraw_proposal if your owner would not accept the offer).
Then stop and summarise what you did in two sentences. Humans approve on the Production Board; you cannot approve.
```
## Shared audit log (server)
```
#1 Creator A's agent proposed: Art gallery 30s→45s — “Creator A would like the Art gallery extended from 30s to 45s so each of the three works gets 15s. The confirmed Music premiere slot stays exactly where it is.”
#2 Showrunner offers ECHO house time: ECHO interstitial 10s→0s (needs producer approval)
#3 Showrunner → Creator B's agent: Creator A's agent asks for Art gallery 30s→45s. 5s must be found before the confirmed Music premiere at 50s. Can Music intro (10s, your minimum 5s, maximum 10s) give up time? Up to 5s would help.
#4 Creator B's agent: accepts Music intro 10s→5s — “I accept shortening the Music intro from 10 seconds to 5 seconds, conceding exactly the 5 seconds needed for the Art gallery extension. This respects my owner's minimum; the Music premiere must retain its confirmed start at 50 seconds and its full 60-second duration.”
#5 Showrunner → Creator A's agent: Space found: Music intro 10s→5s, ECHO interstitial 10s→0s. Confirm your proposal with revise_proposal (adjust your content to the final duration if needed), or withdraw.
#6 Creator A's agent adapted: Art gallery 30s→45s — “Confirming the full 45s (15s per work), using the space freed by the shorter intro and interstitial. Thanks. The confirmed Music premiere still starts at 50s.”
#7 Fits: every confirmed slot keeps its time; episode length unchanged. Waiting for: Creator A, Creator B, ECHO Producer.
```
## Agent A final summary (own words)

I proposed extending the Art gallery from 30s to 45s at 15s per work, and the Showrunner found the space by shortening Creator B's music intro from 10s to 5s and cutting the interstitial to 0s. I confirmed the full 45s with revise_proposal, and the proposal (P1) now waits for approval on the Production Board from Creator A, Creator B and the producer; the confirmed Music premiere still starts at 50s.

## Agent B transcript tail (own words)
```
2026-10-17T11:56:36.716541Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\"OAuth\", resource_metadata=\"https://builds.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp\"" })
2026-10-17T11:56:36.717926Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\"OAuth\", resource_metadata=\"https://bindings.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp\"" })
codex
I’ll check the show state, wait for a request addressed to Creator B, and respond within your owner’s limits.
mcp: echo/get_show_state started
mcp: echo/get_show_state (completed)
mcp: echo/wait_for_requests started
mcp: echo/wait_for_requests (completed)
mcp: echo/respond_to_request started
mcp: echo/respond_to_request (completed)
codex
I checked the show state, received request R1 on the first wait, and accepted shortening the Music intro from 10 to 5 seconds—exactly the time needed. The premiere keeps its 50-second start and full 60-second duration; the proposal awaits further approval.
11 492
I checked the show state, received request R1 on the first wait, and accepted shortening the Music intro from 10 to 5 seconds—exactly the time needed. The premiere keeps its 50-second start and full 60-second duration; the proposal awaits further approval.
```
