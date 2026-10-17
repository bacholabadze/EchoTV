# ECHO 3.1 — deployment options (assessment, nothing deployed)

## What has to run

One Node 22 process (`server/server.mjs`) serves the **frontend and the backend from the same origin**: static pages, `/api/*`, SSE (`/api/events`), agent long-polls of up to 55 s, `/media/<sha256>`, and `/host/*.mp3`. State is one JSON file in `data/`. Publishing runs Piper (Python) locally. The agents' MCP gateways (`server/mcp.mjs`) run on each creator's own machine and call the server over HTTP(S).

So "frontend" and "backend" deploy together. Splitting them (e.g. pages on the existing static Sites host, API elsewhere) would need cross-origin support that the code does not have. **Do not republish `dist/` to the existing static Sites host for the demo.** It cannot run the server, so `/board/` and `/broadcast/` would show "Connecting" or "Off air".

## Options

| Option | Cost | Live updates (SSE) | Verdict |
|---|---|---|---|
| **Local, one Mac** (`scripts/demo.sh start …`) | free | yes | **Recommended for the live demo and the recording.** No network dependency, nothing exposed. |
| **LAN** (`--lan`) | free | yes | Fine on a trusted network. Plain HTTP (tokens travel unencrypted on that Wi-Fi). Venue Wi-Fi often blocks device-to-device traffic: test first. |
| Cloudflare **Quick** Tunnel (`cloudflared tunnel --url …`, no account) | free | **no** | **Ruled out.** Cloudflare's docs state "Quick Tunnels do not support Server-Sent Events (SSE)". The board and broadcast would never update. |
| Cloudflare **named** Tunnel (`cloudflared` is installed) | free plan | yes | **Safest public option** if you already have a Cloudflare account **and a domain on Cloudflare DNS**. HTTPS, stable hostname, nothing to open on the router. Needs your approval and account. |
| Tailscale Funnel | free personal plan | expected yes (TLS pass-through); verify before relying | Good alternative if you prefer Tailscale. Needs install + account + approval. HTTPS on `*.ts.net`. |
| Free PaaS (e.g. Render free web service) | free tier | yes | **Not recommended now.** It sleeps when idle (slow first load), its disk is wiped on restart (state and uploads lost), and Piper needs a custom Docker image. More moving parts the night before the deadline. |
| Paid VPS / paid tiers | paid | yes | Not without your approval. Not needed. |

Reference: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/ (limitations: no SSE, 200 in-flight requests, no uptime guarantee, testing only).

## If you approve a public link (named Cloudflare Tunnel), the steps would be

```bash
cloudflared tunnel login                         # browser sign-in to your Cloudflare account
cloudflared tunnel create echo-demo
cloudflared tunnel route dns echo-demo echo.<your-domain>
scripts/demo.sh start "<A>" "<B>" --fresh        # binds 127.0.0.1 only; the tunnel reaches it locally
cloudflared tunnel run --url http://127.0.0.1:8787 echo-demo
```

Then each agent uses `ECHO_URL=https://echo.<your-domain>` (edit the URL in `data/demo/agent-*.sh` / `agent-a.mcp.json`).

### Safety checklist before exposing anything

- Start a **fresh** instance for the public link (`--fresh`). The public read-only board shows people's names and the full activity log, so use names the creators agree to show.
- Share token links only privately, one per person. Never put them in the video, slides or chat.
- Keep the server bound to `127.0.0.1` (no `--lan`) when tunnelling.
- There is no rate limiting. Keep the link up only for the judging window, then `scripts/demo.sh stop` and stop the tunnel.
- Rights: only media the creators may broadcast (current rehearsal media are public domain / CC0, see `media/ATTRIBUTION.md`).

**Decision needed from you:** local-only (recommended), or a named tunnel on your Cloudflare account (or Tailscale).
