#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${PROJECT_ID:?Set PROJECT_ID to the target Google Cloud project.}"
: "${REGION:?Set REGION to the Cloud Run region, for example us-central1.}"
: "${WEB_ALLOWED_ORIGINS:?Set WEB_ALLOWED_ORIGINS to the deployed web origin.}"
: "${SUPABASE_URL:?Set SUPABASE_URL to the Supabase project URL.}"

SERVICE_NAME="${SERVICE_NAME:-prosody-agent}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-prosody}"
AGENT_LOG_LEVEL="${AGENT_LOG_LEVEL:-INFO}"
ENABLE_LOCAL_SMALLWEBRTC="${ENABLE_LOCAL_SMALLWEBRTC:-0}"
LLM_PROVIDER="${LLM_PROVIDER:-openai}"
LLM_MODEL="${LLM_MODEL:-gpt-5-nano}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-1}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/prosody-agent:${IMAGE_TAG}"
ENV_VARS="AGENT_LOG_LEVEL=${AGENT_LOG_LEVEL},ENABLE_LOCAL_SMALLWEBRTC=${ENABLE_LOCAL_SMALLWEBRTC},WEB_ALLOWED_ORIGINS=${WEB_ALLOWED_ORIGINS},SUPABASE_URL=${SUPABASE_URL},LLM_PROVIDER=${LLM_PROVIDER},LLM_MODEL=${LLM_MODEL}"

docker build -f apps/agent/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"

deploy_args=(
  run deploy "$SERVICE_NAME"
  --project "$PROJECT_ID"
  --region "$REGION"
  --image "$IMAGE"
  --platform managed
  --port 8080
  --set-env-vars "$ENV_VARS"
)

if [[ -n "${AGENT_SECRET_ENV_VARS:-}" ]]; then
  deploy_args+=(--set-secrets "$AGENT_SECRET_ENV_VARS")
fi

if [[ "$ALLOW_UNAUTHENTICATED" == "1" || "$ALLOW_UNAUTHENTICATED" == "true" ]]; then
  deploy_args+=(--allow-unauthenticated)
else
  deploy_args+=(--no-allow-unauthenticated)
fi

gcloud "${deploy_args[@]}"

echo "Deployed ${SERVICE_NAME} as ${IMAGE}"
