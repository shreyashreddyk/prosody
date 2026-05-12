# Cloud Run Deployment

Prosody deploys to Cloud Run as two images:

- `prosody-web`: Vite static app served by nginx with SPA route fallback.
- `prosody-agent`: FastAPI service run by uvicorn on Cloud Run's `$PORT`.

The deployed product surface is the authenticated workspace: Supabase Auth, persistence, uploads, history, summaries, flashcards, metrics, and agent health/meta endpoints. The current Pipecat `SmallWebRTCTransport` path is local/dev only and must remain disabled in Cloud Run until `DailyTransport` or another production transport is integrated.

## Build Images

Build from the repository root so npm workspaces and the agent package layout resolve correctly.

```bash
docker build \
  -f apps/web/Dockerfile \
  -t prosody-web:local \
  --build-arg VITE_AGENT_BASE_URL=http://localhost:8000 \
  --build-arg VITE_ENABLE_LIVE_VOICE=0 \
  --build-arg VITE_ENABLE_UI_DEMO_TOOLS=0 \
  --build-arg VITE_SUPABASE_URL=https://example.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=example \
  .

docker build -f apps/agent/Dockerfile -t prosody-agent:local .
```

GitHub Actions also runs Docker smoke builds for these two Dockerfiles when Docker-relevant paths change. Those CI builds validate that both images can be constructed with safe placeholder web build args, but they do not publish images, authenticate to Artifact Registry, or deploy Cloud Run services.

Expected Artifact Registry image names:

```bash
${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/prosody-web:${IMAGE_TAG}
${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/prosody-agent:${IMAGE_TAG}
```

## Deploy Helpers

The helper scripts build locally with Docker, push to Artifact Registry, and deploy with `gcloud run deploy`.

```bash
PROJECT_ID=<gcp-project> \
REGION=us-central1 \
ARTIFACT_REPOSITORY=prosody \
SERVICE_NAME=prosody-web \
IMAGE_TAG=$(git rev-parse --short HEAD) \
VITE_AGENT_BASE_URL=https://<agent-service-url> \
VITE_ENABLE_LIVE_VOICE=0 \
VITE_ENABLE_UI_DEMO_TOOLS=0 \
VITE_SUPABASE_URL=https://<project>.supabase.co \
VITE_SUPABASE_ANON_KEY=<public-anon-key> \
infra/cloudrun/deploy-web.sh
```

```bash
PROJECT_ID=<gcp-project> \
REGION=us-central1 \
ARTIFACT_REPOSITORY=prosody \
SERVICE_NAME=prosody-agent \
IMAGE_TAG=$(git rev-parse --short HEAD) \
WEB_ALLOWED_ORIGINS=https://<web-service-url> \
SUPABASE_URL=https://<project>.supabase.co \
AGENT_SECRET_ENV_VARS='SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,SUPABASE_JWT_SECRET=supabase-jwt-secret:latest,OPENAI_API_KEY=openai-api-key:latest' \
infra/cloudrun/deploy-agent.sh
```

Set `ALLOW_UNAUTHENTICATED=0` for either script when deploying behind IAM instead of a public Cloud Run URL.

## Web Build-Time Variables

Vite bakes `VITE_*` values into the web image at build time. Rebuild and redeploy `prosody-web` when any of these change:

```bash
VITE_AGENT_BASE_URL=https://<agent-service-url>
VITE_ENABLE_LIVE_VOICE=0
VITE_ENABLE_UI_DEMO_TOOLS=0
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
```

Only browser-safe public values belong in web build args. Do not pass service-role keys or provider API keys to the web build.

## Agent Runtime Variables

Non-secret runtime variables can be supplied through `deploy-agent.sh`:

```bash
AGENT_LOG_LEVEL=INFO
WEB_ALLOWED_ORIGINS=https://<web-service-url>
ENABLE_LOCAL_SMALLWEBRTC=0
SUPABASE_URL=https://<project>.supabase.co
LLM_PROVIDER=openai
LLM_MODEL=gpt-5-nano
```

Secret Manager-backed variables should be passed with `AGENT_SECRET_ENV_VARS`, using the `ENV_VAR=secret-name:version` format accepted by `gcloud run deploy --set-secrets`:

```bash
SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest
SUPABASE_JWT_SECRET=supabase-jwt-secret:latest
OPENAI_API_KEY=openai-api-key:latest
DEEPGRAM_API_KEY=deepgram-api-key:latest
ELEVENLABS_API_KEY=elevenlabs-api-key:latest
ELEVENLABS_VOICE_ID=elevenlabs-voice-id:latest
DAILY_API_KEY=daily-api-key:latest
```

`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID` are local realtime credentials today; keeping them in Secret Manager is fine, but they do not make the current SmallWebRTC flow production-ready. `DAILY_API_KEY` is for the future deployed realtime transport.

## Health And Readiness

Use the agent endpoints for Cloud Run and post-deploy checks:

- `GET /health/live` returns `{"status":"ok","service":"prosody-agent"}` when the process is alive.
- `GET /health/ready` returns `ok` when Supabase is either not configured or both JWKS and REST checks are reachable; it returns `degraded` when Supabase is configured but unreachable.
- `GET /meta` should report `local_smallwebrtc_enabled: false` and `realtime_status: "production_realtime_disabled"` in Cloud Run.

The web image also exposes `GET /healthz` from nginx for basic static-server liveness checks.

## Cloud Run Gotchas

- Cloud Run injects `PORT`; both images default to `8080` and listen on the injected value.
- Web runtime environment variables do not change the browser bundle. Rebuild the web image to update `VITE_*` values.
- `WEB_ALLOWED_ORIGINS` must include the final deployed web origin, otherwise browser requests to the agent will fail CORS preflight.
- Keep `VITE_ENABLE_LIVE_VOICE=0` and `ENABLE_LOCAL_SMALLWEBRTC=0` in Cloud Run until deployed realtime is implemented.
- Readiness can be `degraded` if Supabase is configured but Cloud Run cannot reach Supabase JWKS or PostgREST.
- Create the Artifact Registry repository before running the helper scripts, for example `gcloud artifacts repositories create prosody --repository-format=docker --location=$REGION`.
