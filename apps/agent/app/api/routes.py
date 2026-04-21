import os
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.models import (
    AuthenticatedUser,
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
    SupabaseState,
)
from app.logging_utils import log_diagnostic


router = APIRouter()
logger = logging.getLogger(__name__)


def _is_configured(env_var: str) -> bool:
    return bool(os.getenv(env_var))


def _supabase_state(request: Request) -> SupabaseState:
    store = getattr(request.app.state, "store", None)
    refresh = getattr(store, "refresh_connectivity", None)
    if callable(refresh):
        connectivity = refresh()
        return SupabaseState(
            url_configured=_is_configured("SUPABASE_URL"),
            service_role_configured=_is_configured("SUPABASE_SERVICE_ROLE_KEY"),
            jwks_reachable=connectivity.jwks_reachable,
            rest_reachable=connectivity.rest_reachable,
        )
    return SupabaseState(
        url_configured=_is_configured("SUPABASE_URL"),
        service_role_configured=_is_configured("SUPABASE_SERVICE_ROLE_KEY"),
        jwks_reachable=False,
        rest_reachable=False,
    )


@router.get("/", response_model=MetaResponse)
@router.get("/meta", response_model=MetaResponse)
def meta(request: Request) -> MetaResponse:
    return MetaResponse(
        service="prosody-agent",
        version="0.1.0",
        realtime_status="cloud_v3_authenticated",
        intended_local_transport="SmallWebRTCTransport",
        intended_deployed_transport="DailyTransport",
        provider_config=ProviderConfigState(
            deepgram_configured=_is_configured("DEEPGRAM_API_KEY"),
            elevenlabs_configured=_is_configured("ELEVENLABS_API_KEY"),
            daily_configured=_is_configured("DAILY_API_KEY"),
            supabase_configured=_is_configured("SUPABASE_SERVICE_ROLE_KEY"),
        ),
        supabase=_supabase_state(request),
    )


@router.get("/health/live", response_model=HealthResponse)
def live_health() -> HealthResponse:
    return HealthResponse(status="ok", service="prosody-agent")


@router.get("/health/ready", response_model=HealthResponse)
def ready_health(request: Request) -> HealthResponse:
    supabase_state = _supabase_state(request)
    status_value = "ok" if (not supabase_state.url_configured or (supabase_state.jwks_reachable and supabase_state.rest_reachable)) else "degraded"
    return HealthResponse(status=status_value, service="prosody-agent")


def _manager(request: Request):
    return request.app.state.session_manager


def _store(request: Request):
    return request.app.state.store


@router.post("/api/local/sessions", response_model=LocalSessionCreateResponse)
def create_local_session(
    payload: LocalSessionCreateRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> LocalSessionCreateResponse:
    if not payload.conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")
    base_url = str(request.base_url).rstrip("/")
    log_diagnostic(
        logger,
        logging.INFO,
        "local-session-create-request",
        conversation_id=payload.conversation_id,
        user_id=user.id,
        path=request.url.path,
    )
    try:
        _store(request).ensure_conversation_owner(payload.conversation_id, user.id)
        response = _manager(request).create_session(base_url, conversation_id=payload.conversation_id, user=user)
        log_diagnostic(
            logger,
            logging.INFO,
            "local-session-create-response",
            conversation_id=response.conversationId,
            session_id=response.session.id,
            status=response.session.status,
            user_id=user.id,
        )
        return response
    except KeyError as exc:
        log_diagnostic(
            logger,
            logging.WARNING,
            "local-session-create-not-found",
            conversation_id=payload.conversation_id,
            user_id=user.id,
            error=str(exc),
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        log_diagnostic(
            logger,
            logging.ERROR,
            "local-session-create-failed",
            conversation_id=payload.conversation_id,
            user_id=user.id,
            error_type=type(exc).__name__,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/local/sessions/{session_id}/offer", response_model=SmallWebRTCOfferResponse)
async def create_offer(
    session_id: str,
    payload: SmallWebRTCOfferRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> SmallWebRTCOfferResponse:
    log_diagnostic(
        logger,
        logging.INFO,
        "local-session-offer-request",
        session_id=session_id,
        user_id=user.id,
        path=request.url.path,
        restart_pc=payload.restart_pc,
        has_request_data=payload.requestData is not None,
    )
    try:
        _store(request).ensure_session_owner(session_id, user.id)
        response = await _manager(request).handle_offer(session_id, payload)
        log_diagnostic(
            logger,
            logging.INFO,
            "local-session-offer-response",
            session_id=session_id,
            user_id=user.id,
            pc_id=response.pc_id,
            type=response.type,
        )
        return response
    except KeyError as exc:
        log_diagnostic(
            logger,
            logging.WARNING,
            "local-session-offer-not-found",
            session_id=session_id,
            user_id=user.id,
            error=str(exc),
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        log_diagnostic(
            logger,
            logging.WARNING,
            "local-session-offer-invalid",
            session_id=session_id,
            user_id=user.id,
            error=str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        log_diagnostic(
            logger,
            logging.ERROR,
            "local-session-offer-failed",
            session_id=session_id,
            user_id=user.id,
            error_type=type(exc).__name__,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/local/sessions/{session_id}/resume", response_model=LocalSessionCreateResponse)
def resume_local_session(
    session_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> LocalSessionCreateResponse:
    try:
        _store(request).ensure_session_owner(session_id, user.id)
        base_url = str(request.base_url).rstrip("/")
        return _manager(request).resume_session(base_url, session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/api/local/sessions/{session_id}/offer", status_code=204)
async def patch_offer(
    session_id: str,
    payload: SmallWebRTCPatchRequestModel,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> None:
    log_diagnostic(
        logger,
        logging.INFO,
        "local-session-offer-patch-request",
        session_id=session_id,
        user_id=user.id,
        path=request.url.path,
        candidate_count=len(payload.candidates),
        pc_id=payload.pc_id,
    )
    try:
        _store(request).ensure_session_owner(session_id, user.id)
        await _manager(request).handle_patch(session_id, payload)
        log_diagnostic(
            logger,
            logging.INFO,
            "local-session-offer-patch-response",
            session_id=session_id,
            user_id=user.id,
            candidate_count=len(payload.candidates),
            pc_id=payload.pc_id,
        )
    except KeyError as exc:
        log_diagnostic(
            logger,
            logging.WARNING,
            "local-session-offer-patch-not-found",
            session_id=session_id,
            user_id=user.id,
            error=str(exc),
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        log_diagnostic(
            logger,
            logging.ERROR,
            "local-session-offer-patch-failed",
            session_id=session_id,
            user_id=user.id,
            error_type=type(exc).__name__,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/local/sessions/{session_id}/end", response_model=SessionRecord)
async def end_local_session(
    session_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> SessionRecord:
    log_diagnostic(
        logger,
        logging.INFO,
        "local-session-end-request",
        session_id=session_id,
        user_id=user.id,
        path=request.url.path,
    )
    try:
        _store(request).ensure_session_owner(session_id, user.id)
        response = await _manager(request).end_session(session_id)
        log_diagnostic(
            logger,
            logging.INFO,
            "local-session-end-response",
            session_id=session_id,
            user_id=user.id,
            status=response.status,
            ended_at=response.endedAt,
        )
        return response
    except KeyError as exc:
        log_diagnostic(
            logger,
            logging.WARNING,
            "local-session-end-not-found",
            session_id=session_id,
            user_id=user.id,
            error=str(exc),
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        log_diagnostic(
            logger,
            logging.ERROR,
            "local-session-end-failed",
            session_id=session_id,
            user_id=user.id,
            error_type=type(exc).__name__,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/local/sessions/{session_id}/events", response_model=LocalSessionEventsResponse)
def get_local_session_events(
    session_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> LocalSessionEventsResponse:
    try:
        _store(request).ensure_session_owner(session_id, user.id)
        return _manager(request).get_events(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/local/sessions/{session_id}/timeline", response_model=SessionTimelineResponse)
def get_local_session_timeline(
    session_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> SessionTimelineResponse:
    try:
        _store(request).ensure_session_owner(session_id, user.id)
        return _manager(request).get_timeline(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
