import os

from fastapi import APIRouter

from app.models import HealthResponse, MetaResponse, ProviderConfigState


router = APIRouter()


def _is_configured(env_var: str) -> bool:
    return bool(os.getenv(env_var))


@router.get("/", response_model=MetaResponse)
@router.get("/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    return MetaResponse(
        service="prosody-agent",
        version="0.1.0",
        realtime_status="scaffold_only",
        intended_local_transport="SmallWebRTCTransport",
        intended_deployed_transport="DailyTransport",
        provider_config=ProviderConfigState(
            deepgram_configured=_is_configured("DEEPGRAM_API_KEY"),
            elevenlabs_configured=_is_configured("ELEVENLABS_API_KEY"),
            daily_configured=_is_configured("DAILY_API_KEY"),
            supabase_configured=_is_configured("SUPABASE_SERVICE_ROLE_KEY"),
        ),
    )


@router.get("/health/live", response_model=HealthResponse)
def live_health() -> HealthResponse:
    return HealthResponse(status="ok", service="prosody-agent")


@router.get("/health/ready", response_model=HealthResponse)
def ready_health() -> HealthResponse:
    # Future readiness will account for Pipecat startup, provider checks, and transport wiring.
    return HealthResponse(status="ok", service="prosody-agent")
