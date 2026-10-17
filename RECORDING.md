# Recording a real 90–120-second ECHO demo

Rule (Master Plan §26): every frame is a real screen recording of the running app. Cuts that shorten waiting are allowed and must be labelled "edited for length". Keep the uncut take as evidence. Do not use generated video, staged success, or a mock UI.

## Tools on this Mac

- **OBS 32.1.2** (installed): use it to record. **Do not use Shift-Cmd-5 or QuickTime for the main take: they cannot record the broadcast's sound** (macOS system audio).
- **CapCut** (installed): editing. ffmpeg also works (commands below).

## 1. Prepare (10 minutes before)

1. `scripts/demo.sh start "<A>" "<B>" --fresh` (or `scripts/demo.sh reset` if the names are already right). **Do not record the terminal output of the launcher: it prints private token links.**
2. Turn on Focus / Do Not Disturb, close other apps and tabs, and set the display to 1920×1080 if possible.
3. Chrome window 1: **public** board `/board/` (read-only, no token), full screen on the left half.
   Chrome window 2: `/broadcast/`, on the right half. Click **Watch with sound** now.
   Chrome windows 3–5 (off-camera, or on a second screen): Creator A, Creator B and producer board links. Each person approves in their own window.
4. Terminals: `data/demo/agent-b.sh` (Creator B, Codex) and `data/demo/agent-a.sh` (Creator A, Claude Code). Use a large font (Cmd-+), positioned where they can be captured.
5. OBS:
   - Settings → Video: base and output 1920×1080, 30 fps. Settings → Output: Recording format **MP4** (or MKV, then File → Remux), quality "High".
   - Sources: **macOS Screen Capture** (Display) + **macOS Audio Capture** → Application → *Google Chrome* (the broadcast sound). Add the mic only if narrating live.
   - Check that the Chrome audio meter moves when you press Play in `/studio/`. Then go back and reset.

## 2. Take (≈5–6 minutes real time; do not hurry the agents)

1. Start recording in OBS.
2. B types the policy (DEMO_RUNBOOK §5) into Codex, then A types theirs into Claude Code.
3. The board fills live: proposal, conflict, request to B, B's answer, A's adaptation. Wait; do not speed up.
4. A, B and the producer each press **Approve v2** in their own window. Bring each window briefly on screen.
5. Producer: **Publish**, then **Go live**. Keep the broadcast window large for the full 2 minutes.
6. Stop recording after the "That was …" end slate.

Do three takes. Use the best one, and keep all three uncut.

## 3. Edit to 90–120 s

| Time | Shot (all real) | On-screen text (true statements only) |
|---|---|---|
| 0:00–0:08 | Broadcast: ECHO studio during the outro, or the 0:50 premiere card | "Many creators. Many agents. One shared broadcast." |
| 0:08–0:20 | Public board, r1: people, their agents (Claude Code / Codex), the 🔒 premiere at 0:50 | "Two people. Two independent agents." |
| 0:20–0:38 | A's terminal + board: proposal and the Showrunner conflict ("must still start at 50s") | "Creator A's agent asks for 15 more seconds" |
| 0:38–0:58 | B's terminal + board: B's own reasoning and the 10→5 s concession; A adapts to 15/15/15 | "Creator B's agent protects its premiere, concedes 5 s" |
| 0:58–1:12 | The three Approve clicks, r2 diff, Publish → `r2 · <hash>` | "People approve. Agents can't." |
| 1:12–1:42 | Broadcast: gallery → premiere starting exactly at 0:50 with the same `r2 · <hash>` | "The approved revision is what airs" |
| 1:42–1:50 | End slate + one line | "We don't generate video. We coordinate creators and their agents into one broadcast." |

- Put a small "edited for length" label on the first frame after every jump cut, or once at the start: "Real screen recording, edited for length."
- Do not speed up footage without saying so. Do not overlay anything that did not happen.
- Export 1920×1080, H.264, AAC audio. Check the sound on headphones before submitting.

ffmpeg alternative (cut segments by timestamps, then join):

```bash
ffmpeg -ss 00:00:41 -to 00:01:05 -i take.mp4 -c:v libx264 -c:a aac part1.mp4   # repeat per segment
printf "file 'part1.mp4'\nfile 'part2.mp4'\n" > parts.txt && ffmpeg -f concat -safe 0 -i parts.txt -c copy demo.mp4
```

## 4. Submission package (Master Plan §28)

- `demo.mp4` (90–120 s), plus the uncut takes and the commit hash (`git rev-parse HEAD`).
- Check the official video length and format in the upload form, `#help` or `/okto`: they are **not confirmed** in the Master Plan.
- Deadline: Sunday 18 Oct, 12:00 Tbilisi. Internal target: 11:30.
