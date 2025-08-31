# Sign Language Translator with Meta AI Glasses

## Project Overview

This project is a real-time sign language translator built to work with Meta AI glasses. The application detects signs from a shared video feed and aims to provide audio readouts to the wearer.

## Demo Video

[![Sign Language Translation with Meta AI Glasses](https://img.youtube.com/vi/JgP18E60tOE/0.jpg)](https://www.youtube.com/watch?v=JgP18E60tOE)

## Important Note

This is a hackathon-grade proof of concept, not production-ready. Current constraints:

- Uses screen capture as a workaround due to lack of an official Meta AI glasses SDK
- Minimal error handling and hardcoded assumptions
- Audio readouts in-glasses are work-in-progress (not implemented yet)

## Current Status and Latency

- Transport switched from Instagram Live to WhatsApp video calls, yielding approximately 10–20x lower end-to-end delay in practice.
- Flow simplified: no Python streaming server and no mobile app required.

## Roles

- Sender: iPhone paired with Meta AI glasses, logged into WhatsApp Account A.
- Receiver: Laptop running the website, logged into WhatsApp Account B.

Note: Two separate WhatsApp accounts are required.

## Setup Instructions

### Prerequisites

- Meta AI glasses
- iPhone (Sender) with WhatsApp installed
- Laptop (Receiver) with WhatsApp Desktop installed
- Two WhatsApp accounts (A for phone, B for desktop)
- Bun (project uses Bun workspaces)

### Install and Run (Monorepo)

From the repository root:

```bash
bun install
bun run dev
```

This starts the website at an HTTPS dev server on port 3001 by default.

### WhatsApp-Based Video Path

1. On the phone (Sender), log into WhatsApp with Account A and pair Meta AI glasses to the phone.
2. On the laptop (Receiver), install/open WhatsApp Desktop and log into Account B.
3. Start a WhatsApp video call between Account A and Account B.
4. On the Meta AI glasses, double-tap the picture button to switch the call’s camera to the glasses.
5. On the laptop, open the website and click “Share Screen”, then select the WhatsApp call window.
6. The site will run hand detection on the shared call feed. Audio readouts to the glasses are WIP (not implemented yet).

## How It Works

1. Video is streamed from Meta AI glasses to the phone’s WhatsApp app, then to the laptop over the WhatsApp call.
2. The website performs on-device hand landmark detection using MediaPipe Tasks Vision in the browser.
3. Detected landmarks are rendered overlay-only. Translation and in-glasses audio output are under development.

## Troubleshooting

- If “Share Screen” doesn’t list the WhatsApp window, ensure the call is active and the window is visible (not minimized).
- On macOS, grant screen recording permissions to your browser (System Settings → Privacy & Security → Screen Recording).
- If the canvas overlay is blank, wait for the video to fully load or reload the page. Ensure the site is served over HTTPS as required by getDisplayMedia.

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- Realtime Vision: MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) HandLandmarker
- State & Data: Zustand (local UI state), TanStack Query 5
- API: tRPC 11 over Hono (server), typed client in web
- Server: Bun runtime with Hono; build via tsdown
- Monorepo: Turbo for orchestration; Bun workspaces

## Architecture

- Web app performs vision locally in-browser (WASM + WebGL via MediaPipe), overlaying hand landmarks on a canvas over a video/screen-share element.
- Screen share provides frames from the WhatsApp desktop call; no raw media is uploaded to the backend.
- Backend exposes tRPC endpoints for future inference/state; currently returns simulated detection data.

## Monorepo Structure

```
apps/
  web/      # Next.js app (UI, screen share, hand detection)
  server/   # Bun + Hono + tRPC API
```

## Environment Variables

Web (`apps/web`):

- `NEXT_PUBLIC_SERVER_URL` – Base URL for server tRPC (e.g., `https://localhost:3000`).

Server (`apps/server`):

- `PORT` – Hono server port (default 3000)
- `CORS_ORIGIN` – Allowed origin(s) (default `*`)

Example root `.env`:

```
NEXT_PUBLIC_SERVER_URL=https://localhost:3000
PORT=3000
CORS_ORIGIN=https://localhost:3001
```

## Scripts

Run from repository root:

```bash
bun install
bun run dev          # dev (web HTTPS:3001; server if configured)
bun run build        # build all
bun run check-types  # typecheck all
bun run dev:web      # web only
bun run dev:server   # server only
```

Web dev server: Next.js on `https://localhost:3001` (see `apps/web/package.json`).

## API (tRPC)

- Router: `apps/server/src/routers/index.ts` → `detection`.
- Procedure: `detection.detect` (mutation)
  - Input: optional `imageData`, `videoData`, `audioData` (base64)
  - Output: `{ detectedSign, confidence, boundingBox?, processingTime, modelVersion, timestamp }`
  - Current: simulated response; replace with real model inference later.

Client (`apps/web/src/utils/trpc.ts`):

```ts
httpBatchLink({ url: `${process.env.NEXT_PUBLIC_SERVER_URL}/trpc` });
```

## HTTPS and Permissions

- Screen sharing requires a secure context; web dev runs with `--experimental-https` on 3001.
- Approve browser prompts for screen recording and screen selection; reload if permissions change.

## Limitations

- In-glasses audio readout is not implemented.
- Landmark visualization only; translation logic is stubbed.
- No auth or multi-user coordination yet.

## Roadmap

- Implement gesture-to-letter/word translation pipeline.
- Text-to-speech back to Meta AI glasses.
- Improve model accuracy and add gesture classification.
- Add auth, sessions, and recording controls.

