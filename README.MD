# Hand Wave with Meta AI Glasses

Real‑time hand gesture detection from Meta AI glasses, streamed via WhatsApp Desktop to a web app. Renders hand landmarks in the browser; translation and in‑glasses TTS are in progress.

## Demo

<div align="center">
<a href="https://www.youtube.com/watch?v=ZncD5yy729c">
<img src="https://img.youtube.com/vi/ZncD5yy729c/0.jpg" alt="Demo: Hand Wave with Meta AI Glasses" width="720" />
</a>
<br />
<em>Real‑time stream from glasses. Current demo shows hand landmarks only.</em>
</div>

## Status

- Hackathon‑grade prototype; not production‑ready.
- Transport moved from Instagram Live to WhatsApp → ~10–20× lower end‑to‑end latency.
- No Python streaming server or mobile app required.
- In‑glasses audio readout not implemented.

## Quick Start

Prerequisites:
- Meta AI glasses
- iPhone (Sender) with WhatsApp (Account A)
- Laptop (Receiver) with WhatsApp Desktop (Account B)
- Two WhatsApp accounts
- Bun (monorepo uses Bun workspaces)

Install and run from repository root:
```bash
bun install
bun run dev
```
Web dev server starts at `https://localhost:3001`.

## Use with WhatsApp

1. On the phone (Account A), pair the glasses and open WhatsApp.
2. On the laptop (Account B), open WhatsApp Desktop.
3. Start a WhatsApp video call between Account A and Account B.
4. On the glasses, double‑tap the picture button to switch the call’s camera to the glasses.
5. Open the site and click “Share Screen”; select the WhatsApp call window.
6. The browser runs on‑device hand detection on the shared feed. Audio back to the glasses is WIP.

## How It Works

- Video path: glasses → phone → WhatsApp → laptop.
- On‑device vision via MediaPipe Tasks Vision (WASM/WebGL) HandLandmarker.
- Landmarks are rendered overlay‑only; no raw frames are uploaded.
- Backend exposes tRPC endpoints for future inference; current detection is simulated.

## Troubleshooting

- If “Share Screen” doesn’t list the WhatsApp window, ensure the call is active and the window is visible.
- macOS: grant Screen Recording to your browser (System Settings → Privacy & Security → Screen Recording).
- Use HTTPS; `getDisplayMedia` requires a secure context.

## Tech Stack

- Web: Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- Vision: `@mediapipe/tasks-vision` HandLandmarker
- State/Data: Zustand, TanStack Query 5
- API/Server: tRPC 11 over Hono (Bun runtime), built with tsdown
- Monorepo: Turbo + Bun workspaces

## Scripts

Run from repository root:
```bash
bun run dev          # web HTTPS:3001; server if configured
bun run build        # build all
bun run check-types  # typecheck all
bun run dev:web      # web only
bun run dev:server   # server only
```

## Environment

Web (`apps/web`):
- `NEXT_PUBLIC_SERVER_URL` – e.g., `https://localhost:3000`

Server (`apps/server`):
- `PORT` – default `3000`
- `CORS_ORIGIN` – e.g., `https://localhost:3001`

Example `.env` at repo root:
```
NEXT_PUBLIC_SERVER_URL=https://localhost:3000
PORT=3000
CORS_ORIGIN=https://localhost:3001
```

## Structure

```
apps/
  web/      # Next.js app (UI, screen share, hand detection)
  server/   # Bun + Hono + tRPC API
```

## Limitations

- In‑glasses audio readout not implemented.
- Landmark visualization only; translation logic is stubbed.
- No auth or multi‑user coordination yet.

## Roadmap

- Implement gesture‑to‑letter/word translation.
- Text‑to‑speech back to the glasses.
- Improve model accuracy and add gesture classification.
- Add auth, sessions, recording controls.

