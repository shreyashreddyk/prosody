#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${PROJECT_ID:?Set PROJECT_ID to the target Google Cloud project.}"
: "${REGION:?Set REGION to the Cloud Run region, for example us-central1.}"
: "${VITE_AGENT_BASE_URL:?Set VITE_AGENT_BASE_URL to the deployed agent service URL.}"
: "${VITE_SUPABASE_URL:?Set VITE_SUPABASE_URL to the Supabase project URL.}"
: "${VITE_SUPABASE_ANON_KEY:?Set VITE_SUPABASE_ANON_KEY to the public Supabase anon key.}"

SERVICE_NAME="${SERVICE_NAME:-prosody-web}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-prosody}"
VITE_ENABLE_LIVE_VOICE="${VITE_ENABLE_LIVE_VOICE:-0}"
VITE_ENABLE_UI_DEMO_TOOLS="${VITE_ENABLE_UI_DEMO_TOOLS:-0}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-1}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/prosody-web:${IMAGE_TAG}"

docker build \
  -f apps/web/Dockerfile \
  -t "$IMAGE" \
  --build-arg "VITE_AGENT_BASE_URL=${VITE_AGENT_BASE_URL}" \
  --build-arg "VITE_ENABLE_LIVE_VOICE=${VITE_ENABLE_LIVE_VOICE}" \
  --build-arg "VITE_ENABLE_UI_DEMO_TOOLS=${VITE_ENABLE_UI_DEMO_TOOLS}" \
  --build-arg "VITE_SUPABASE_URL=${VITE_SUPABASE_URL}" \
  --build-arg "VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}" \
  .

docker push "$IMAGE"

deploy_args=(
  run deploy "$SERVICE_NAME"
  --project "$PROJECT_ID"
  --region "$REGION"
  --image "$IMAGE"
  --platform managed
  --port 8080
)

if [[ "$ALLOW_UNAUTHENTICATED" == "1" || "$ALLOW_UNAUTHENTICATED" == "true" ]]; then
  deploy_args+=(--allow-unauthenticated)
else
  deploy_args+=(--no-allow-unauthenticated)
fi

gcloud "${deploy_args[@]}"

echo "Deployed ${SERVICE_NAME} as ${IMAGE}"
