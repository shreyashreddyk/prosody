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

Production CD is handled by two manual GitHub Actions workflows:

- `.github/workflows/deploy-web.yml` builds, pushes, and deploys `prosody-web`.
- `.github/workflows/deploy-agent.yml` builds, pushes, and deploys `prosody-agent`.

Both workflows use the GitHub `production` Environment and Workload Identity Federation. They are `workflow_dispatch` only, so a deploy requires an explicit operator action and can be protected by GitHub Environment reviewers.

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

## GitHub Actions Production CD

Run production deployments from the GitHub Actions tab:

1. Select **Deploy agent to Cloud Run** when agent runtime configuration, provider credentials, or backend code changes.
2. Select **Deploy web to Cloud Run** when web code or any `VITE_*` build-time value changes.
3. Use the `production` Environment approval gate, if configured, to make the deploy deliberate.
4. Read the workflow summary for the deployed image and Cloud Run URL.

The workflows tag images with the full Git commit SHA:

```bash
${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GCP_ARTIFACT_REPOSITORY}/prosody-web:${GITHUB_SHA}
${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GCP_ARTIFACT_REPOSITORY}/prosody-agent:${GITHUB_SHA}
```

The workflows do not change Cloud Run invoker IAM. Configure public or IAM-protected access once, outside CD, so deploys do not silently change the service exposure model. If the browser must call the agent directly, the agent service must be reachable from the browser and protected by the app's bearer-token auth and CORS allowlist.

## One-Time GCP Setup Checklist

Enable required APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT_ID"
```

Create an Artifact Registry Docker repository:

```bash
gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
  --project "$PROJECT_ID" \
  --repository-format docker \
  --location "$REGION"
```

Create or choose a GitHub Actions deploy service account:

```bash
gcloud iam service-accounts create prosody-github-deployer \
  --project "$PROJECT_ID" \
  --display-name "Prosody GitHub Actions deployer"
```

Grant the deploy service account the minimum deployment roles:

```bash
DEPLOYER="prosody-github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOYER}" \
  --role roles/run.admin

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOYER}" \
  --role roles/artifactregistry.writer

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOYER}" \
  --role roles/iam.serviceAccountUser
```

Create a Workload Identity Pool and GitHub OIDC provider. Scope the provider to this repository with an attribute condition so unrelated repositories cannot impersonate the deployer.

```bash
gcloud iam workload-identity-pools create github \
  --project "$PROJECT_ID" \
  --location global \
  --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc prosody \
  --project "$PROJECT_ID" \
  --location global \
  --workload-identity-pool github \
  --display-name "Prosody GitHub Actions" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository=='OWNER/REPO'"
```

Allow that provider to impersonate the deploy service account:

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/OWNER/REPO"
```

Create Secret Manager secrets for server-only agent credentials, then grant the deploy/runtime service account secret access. Use your actual secret names; the GitHub Environment vars below should reference these names as `secret-name:latest`.

```bash
for secret in \
  supabase-service-role-key \
  supabase-jwt-secret \
  openai-api-key \
  deepgram-api-key \
  elevenlabs-api-key \
  elevenlabs-voice-id \
  daily-api-key
do
  gcloud secrets create "$secret" \
    --project "$PROJECT_ID" \
    --replication-policy automatic
done

for secret in \
  supabase-service-role-key \
  supabase-jwt-secret \
  openai-api-key \
  deepgram-api-key \
  elevenlabs-api-key \
  elevenlabs-voice-id \
  daily-api-key
do
  gcloud secrets add-iam-policy-binding "$secret" \
    --project "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOYER}" \
    --role roles/secretmanager.secretAccessor
done
```

If Cloud Run executes as a separate runtime service account, grant that runtime service account `roles/secretmanager.secretAccessor` on the same secrets too. Cloud Run resolves Secret Manager-backed environment variables at runtime.

Create the Cloud Run services before the first production deploy if you want to pin IAM, ingress, runtime service account, min/max instances, or public/private access up front. The workflows can deploy revisions to existing services and preserve those service-level choices.

## One-Time GitHub Setup Checklist

Create a GitHub Environment named `production`. Add required reviewers if deployments should require approval.

Add these Environment variables:

```bash
GCP_PROJECT_ID=<gcp-project-id>
GCP_REGION=us-central1
GCP_ARTIFACT_REPOSITORY=prosody
GCP_WORKLOAD_IDENTITY_PROVIDER=projects/<project-number>/locations/global/workloadIdentityPools/github/providers/prosody
GCP_SERVICE_ACCOUNT=prosody-github-deployer@<gcp-project-id>.iam.gserviceaccount.com
CLOUD_RUN_WEB_SERVICE=prosody-web
CLOUD_RUN_AGENT_SERVICE=prosody-agent
```

Web build-time variables:

```bash
VITE_AGENT_BASE_URL=https://<agent-service-url>
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
VITE_ENABLE_LIVE_VOICE=0
VITE_ENABLE_UI_DEMO_TOOLS=0
```

Agent non-secret runtime variables:

```bash
WEB_ALLOWED_ORIGINS=https://<web-service-url>
SUPABASE_URL=https://<project>.supabase.co
AGENT_LOG_LEVEL=INFO
LLM_PROVIDER=openai
LLM_MODEL=gpt-5-nano
```

Agent Secret Manager reference variables:

```bash
GCP_SECRET_SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest
GCP_SECRET_SUPABASE_JWT_SECRET=supabase-jwt-secret:latest
GCP_SECRET_OPENAI_API_KEY=openai-api-key:latest
GCP_SECRET_DEEPGRAM_API_KEY=deepgram-api-key:latest
GCP_SECRET_ELEVENLABS_API_KEY=elevenlabs-api-key:latest
GCP_SECRET_ELEVENLABS_VOICE_ID=elevenlabs-voice-id:latest
GCP_SECRET_DAILY_API_KEY=daily-api-key:latest
```

These GitHub values are secret names and versions, not raw secret payloads. Store raw provider keys only in Google Secret Manager. `VITE_SUPABASE_ANON_KEY` is browser-visible by design and must be the public Supabase anon key, never the service-role key.

## Rollback And Updates

Cloud Run keeps revision history. To roll back, shift traffic to a previous known-good revision:

```bash
gcloud run revisions list \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service "$SERVICE_NAME"

gcloud run services update-traffic "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions "$REVISION_NAME=100"
```

To redeploy a specific commit, run the matching workflow from that commit or branch in GitHub Actions. To update web build-time values, change the GitHub Environment vars and rerun **Deploy web to Cloud Run**. To update agent non-secret env or Secret Manager references, change the GitHub Environment vars and rerun **Deploy agent to Cloud Run**. To rotate a secret without changing its secret name/version reference, add a new Secret Manager version and redeploy only if Cloud Run does not pick up the version change on the desired schedule.

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
