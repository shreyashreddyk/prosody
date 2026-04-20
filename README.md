# Prosody

Prosody is a production-style real-time multimodal interview and presentation coach. This repository currently provides the initial monorepo scaffold, shared contracts, a placeholder web experience, and a minimal FastAPI agent service.

The repo now includes a local-only v1 realtime voice loop built around Pipecat and `SmallWebRTCTransport`. This version is focused on a single-user local flow, explicit observability, and simple file-based persistence rather than auth, deployment, or product polish.

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

- `apps/web`: placeholder React app and future authenticated product shell
- `apps/agent`: FastAPI service with health/meta endpoints and reserved realtime modules
- `packages/contracts`: shared TypeScript contracts for core product entities and events
- `packages/ui`: minimal shared UI primitives used by the web app
- `infra`: deployment/provider notes and future infrastructure assets
- `docs`: local-only learning trail and design notes (gitignored)

## Current Baseline

- Shared contracts for `Conversation`, `Session`, `Turn`, `Source`, `LatencyEvent`, `DegradationEvent`, and `FlashcardSet`
- Shared realtime contracts for transcript, session, and latency events
- Minimal local realtime web page with start/end controls, live transcript updates, and connection state
- FastAPI service with health/meta routes plus local session, offer, ICE patch, end, and events APIs
- File-based local persistence under `PROSODY_DATA_DIR`
- Local documentation baseline covering architecture, contracts, evaluation, and failure cases

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

4. Start the agent:

```bash
npm run dev:agent
```

## Environment Files

- `apps/agent/.env`: server-only runtime settings and secrets
- `apps/web/.env.local`: browser-visible `VITE_*` settings only
- `apps/agent/.env.example` and `apps/web/.env.example` document the expected layout

Keep Supabase anon and agent base URL in the web env. Keep OpenAI, Deepgram, ElevenLabs, Daily, and Supabase service-role secrets in the agent env only.

## Validation

- `npm run typecheck`
- `npm run build`
- `python3 -m compileall apps/agent/app`
- `python3 -m pytest apps/agent/tests`

## Notes

- The docs under `docs/` are local-only and intentionally ignored by Git.
- This version is local-only and does not yet include auth, Daily transport, Supabase persistence, uploads, summaries, flashcards, or replay controls.
