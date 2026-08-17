#!/bin/sh
set -eu

action="${1:-}"
project="${GCP_PROJECT_ID:-}"
region="${GCP_REGION:-asia-northeast3}"
repository="${GCP_ARTIFACT_REPOSITORY:-document-arena}"
revision="${GCP_IMAGE_REVISION:-$(git rev-parse --short=12 HEAD)}"
web_service="${GCP_WEB_SERVICE:-document-arena-web}"
orchestrator_service="${GCP_ORCHESTRATOR_SERVICE:-document-arena-orchestrator}"
web_service_account="${GCP_WEB_SERVICE_ACCOUNT:-}"
orchestrator_service_account="${GCP_ORCHESTRATOR_SERVICE_ACCOUNT:-}"
# Cloud Run defaults to 100 maximum instances. The safe shell serves no traffic
# an idle instance could earn back, so cap both services and scale to zero.
max_instances="${GCP_MAX_INSTANCES:-1}"

if [ -z "$project" ]; then
  printf '%s\n' 'GCP_PROJECT_ID is required.' >&2
  exit 2
fi

case "$action" in
  build|deploy) ;;
  *) printf '%s\n' 'Usage: infra/gcp/deploy.sh build|deploy' >&2; exit 2 ;;
esac

if [ "$action" = "deploy" ] \
  && { [ -z "$web_service_account" ] || [ -z "$orchestrator_service_account" ]; }; then
  printf '%s\n' 'GCP_WEB_SERVICE_ACCOUNT and GCP_ORCHESTRATOR_SERVICE_ACCOUNT are required for deploy.' >&2
  exit 2
fi

command -v gcloud >/dev/null
gcloud artifacts repositories describe "$repository" \
  --project "$project" --location "$region" >/dev/null

gcloud builds submit . \
  --project "$project" \
  --config infra/gcp/cloudbuild.yaml \
  --substitutions "_REGION=$region,_REPOSITORY=$repository,_REVISION=$revision"

if [ "$action" = "build" ]; then
  exit 0
fi

registry="$region-docker.pkg.dev/$project/$repository"

gcloud run deploy "$web_service" \
  --project "$project" \
  --region "$region" \
  --image "$registry/web:$revision" \
  --service-account "$web_service_account" \
  --port 8080 \
  --min-instances 0 \
  --max-instances "$max_instances" \
  --allow-unauthenticated \
  --set-env-vars DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED=false

gcloud run deploy "$orchestrator_service" \
  --project "$project" \
  --region "$region" \
  --image "$registry/orchestrator:$revision" \
  --service-account "$orchestrator_service_account" \
  --port 8080 \
  --min-instances 0 \
  --max-instances "$max_instances" \
  --no-allow-unauthenticated \
  --set-env-vars DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED=false

printf '%s\n' 'Cloud Run services deployed with hosted execution disabled.'
