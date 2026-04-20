import os

from fastapi import APIRouter, HTTPException, Request

from app.models import (
    HealthResponse,
    LocalSessionCreateRequest,
    LocalSessionCreateResponse,
    LocalSessionEventsResponse,
    MetaResponse,
    ProviderConfigState,
    SessionRecord,
    SessionTimelineResponse,
    SmallWebRTCOfferRequest,
    SmallWebRTCOfferResponse,
    SmallWebRTCPatchRequestModel,
)


router = APIRouter()


def _is_configured(env_var: str) -> bool:
    return bool(os.getenv(env_var))


@router.get("/", response_model=MetaResponse)
@router.get("/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    return MetaResponse(
        service="prosody-agent",
        version="0.1.0",
        realtime_status="local_v2_observable",
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
    return HealthResponse(status="ok", service="prosody-agent")


def _manager(request: Request):
    return request.app.state.session_manager


@router.post("/api/local/sessions", response_model=LocalSessionCreateResponse)
def create_local_session(
    payload: LocalSessionCreateRequest,
    request: Request,
) -> LocalSessionCreateResponse:
    base_url = str(request.base_url).rstrip("/")
    return _manager(request).create_session(base_url, conversation_id=payload.conversation_id)


@router.post("/api/local/sessions/{session_id}/offer", response_model=SmallWebRTCOfferResponse)
async def create_offer(
    session_id: str,
    payload: SmallWebRTCOfferRequest,
    request: Request,
) -> SmallWebRTCOfferResponse:
    try:
        return await _manager(request).handle_offer(session_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/api/local/sessions/{session_id}/offer", status_code=204)
async def patch_offer(
    session_id: str,
    payload: SmallWebRTCPatchRequestModel,
    request: Request,
) -> None:
    try:
        await _manager(request).handle_patch(session_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/api/local/sessions/{session_id}/end", response_model=SessionRecord)
async def end_local_session(session_id: str, request: Request) -> SessionRecord:
    try:
        return await _manager(request).end_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/local/sessions/{session_id}/events", response_model=LocalSessionEventsResponse)
def get_local_session_events(session_id: str, request: Request) -> LocalSessionEventsResponse:
    try:
        return _manager(request).get_events(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/local/sessions/{session_id}/timeline", response_model=SessionTimelineResponse)
def get_local_session_timeline(session_id: str, request: Request) -> SessionTimelineResponse:
    try:
        return _manager(request).get_timeline(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
