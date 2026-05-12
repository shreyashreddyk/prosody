# Prosody

Prosody is a production-style AI interview and presentation coaching workspace. The current deployable surface focuses on authentication, persistent conversations, source uploads, transcript history, summaries, flashcards, metrics, and health/meta endpoints.

The repo also includes a local-only experimental realtime voice loop built around Pipecat and `SmallWebRTCTransport`. That path is preserved for local development and diagnostics, but it is feature-gated off by default so Cloud Run deployments do not expose the local transport as a public production feature. Realtime voice remains experimental until `DailyTransport` or an equivalent production transport is integrated.

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Python + FastAPI + Pipecat-ready module boundaries
- Local transport target: `SmallWebRTCTransport`
- Deployed transport target: `DailyTransport`
- ASR: Deepgram Flux
- TTS: ElevenLabs streaming
- Auth: Supabase Auth with Google OAuth
- Database: Supabase Postgres
- Storage: Supabase Storage
- Deployment target: Cloud Run

## Monorepo Layout

- `apps/web`: authenticated React product shell with conversations, sources, history, summaries, flashcards, metrics, and gated live voice controls
- `apps/agent`: FastAPI service with health/meta endpoints, authenticated product generation APIs, Supabase-backed persistence, and gated local realtime routes
- `packages/contracts`: shared TypeScript contracts for core product entities and events
- `packages/ui`: minimal shared UI primitives used by the web app
- `infra`: deployment/provider notes and future infrastructure assets
- `docs`: local-only learning trail and design notes (gitignored)

## Current Deployment Posture

- Productionized surface: Supabase Auth, persistent conversations, source uploads, session/turn history, summaries, flashcards, metrics/timeline reads, and agent health/meta endpoints
- Local/dev-only surface: Pipecat `SmallWebRTCTransport` session creation, offer/ICE signaling, resume, and end routes
- The browser hides live voice controls unless `VITE_ENABLE_LIVE_VOICE=1` or `true`
- The agent rejects local SmallWebRTC lifecycle/signaling calls unless `ENABLE_LOCAL_SMALLWEBRTC=1` or `true`
- Cloud Run deployments should omit both realtime flags, or set them to `0`, until the deployed realtime transport is implemented

## Local Run

1. Install Node dependencies:

```bash
npm install
```

2. Start the web app:

```bash
npm run dev:web
```

3. Create a Python virtual environment and install the agent package:

```bash
python3 -m venv .venv
.venv/bin/pip install -e apps/agent
```

4. Enable local realtime flags in `apps/web/.env.local` and `apps/agent/.env` if you want to use the experimental SmallWebRTC path:

```bash
VITE_ENABLE_LIVE_VOICE=1
ENABLE_LOCAL_SMALLWEBRTC=1
```

5. Start the agent:

```bash
npm run dev:agent
```

## Environment Files

- `apps/agent/.env`: server-only runtime settings and secrets
- `apps/web/.env.local`: browser-visible `VITE_*` settings only
- `apps/agent/.env.example` and `apps/web/.env.example` document the expected layout

Keep Supabase anon and agent base URL in the web env. Keep OpenAI, Deepgram, ElevenLabs, Daily, and Supabase service-role secrets in the agent env only.

Production-safe realtime defaults are deny-by-default. `VITE_ENABLE_LIVE_VOICE` and `ENABLE_LOCAL_SMALLWEBRTC` must be explicitly enabled for local development; they should remain disabled in Cloud Run until `DailyTransport` or another production transport replaces the local path.

## Validation

- `npm run typecheck`
- `npm run build`
- `python3 -m compileall apps/agent/app`
- `python3 -m pytest apps/agent/tests`

## Notes

- The docs under `docs/` are local-only and intentionally ignored by Git.
- The deployable product surface is productionized around auth, persistence, uploads, history, summaries, flashcards, metrics, and health/meta.
- Realtime voice is intentionally local/dev only in this version. Do not present the current `SmallWebRTCTransport` path as the public production experience.
