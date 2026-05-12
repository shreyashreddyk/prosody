# Cloud Run Deployment Posture

Prosody can be prepared for Cloud Run around the productionized authenticated workspace surface:

- Supabase Auth with Google OAuth
- Supabase-backed conversations, sessions, turns, sources, summaries, flashcards, and metrics
- Supabase Storage uploads for conversation sources
- FastAPI health and meta endpoints
- Authenticated summary and flashcard generation

The current Pipecat `SmallWebRTCTransport` path is local/dev only. It is not the public production realtime transport and should stay disabled in Cloud Run until `DailyTransport` or an equivalent production transport is integrated.

## Production Feature Flags

Use deny-by-default realtime settings in deployed environments:

```bash
VITE_ENABLE_LIVE_VOICE=0
ENABLE_LOCAL_SMALLWEBRTC=0
```

Omitting either flag has the same production-safe effect. Local development may opt in with `1` or `true`.

## Web Service Environment

The browser build should receive only public `VITE_*` values:

```bash
VITE_AGENT_BASE_URL=https://<agent-service-url>
VITE_ENABLE_LIVE_VOICE=0
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
```

## Agent Service Environment

The agent service owns server-side secrets and Cloud Run runtime configuration:

```bash
PORT=8080
AGENT_LOG_LEVEL=INFO
WEB_ALLOWED_ORIGINS=https://<web-service-url>
ENABLE_LOCAL_SMALLWEBRTC=0
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret>
SUPABASE_JWT_SECRET=<secret-if-project-uses-HS256>
OPENAI_API_KEY=<secret>
LLM_PROVIDER=openai
LLM_MODEL=gpt-5-nano
```

Deepgram and ElevenLabs secrets are still valid local realtime credentials, but they are not sufficient to make the current SmallWebRTC flow production-ready.

## Deployment Verification

- `GET /health/live` returns `{"status":"ok","service":"prosody-agent"}`.
- `GET /health/ready` returns `ok` or `degraded` depending on Supabase reachability.
- `GET /meta` reports `local_smallwebrtc_enabled: false` and `realtime_status: "production_realtime_disabled"`.
- Authenticated persistence, uploads, summaries, flashcards, and history continue to work.
- Calls to local realtime lifecycle/signaling routes such as `POST /api/local/sessions` return a disabled response when `ENABLE_LOCAL_SMALLWEBRTC` is off.
