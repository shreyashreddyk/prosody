from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import Any

from pipecat.frames.frames import EndFrame
from pipecat.transports.smallwebrtc.request_handler import (
    ConnectionMode,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

from app.config import Settings
from app.models import (
    AuthenticatedUser,
    LatencyEventRecord,
    LocalSessionCreateResponse,
    LocalSessionEventsResponse,
    SessionEventRecord,
    SessionRecord,
    SessionTimelineResponse,
    SmallWebRTCOfferRequest,
    SmallWebRTCOfferResponse,
    SmallWebRTCPatchRequestModel,
)
from app.orchestrator.pipeline import build_session_task
from app.providers.factory import ProviderFactory
from app.resilience import ResiliencePolicy, SessionResilienceCoordinator
from app.replay.service import build_session_timeline, generate_replay_artifact
from app.storage.base import SessionStore
from app.storage.local_store import iso_now


async def _noop_fallback(_turn_id: str, _event) -> None:
    return None


async def _noop_async() -> None:
    return None


@dataclass
class RealtimeSession:
    session: SessionRecord
    request_handler: SmallWebRTCRequestHandler
    task: Any = None
    runner: Any = None
    runner_task: asyncio.Task | None = None
    observer: Any = None
    resilience: SessionResilienceCoordinator | None = None


class SessionManager:
    def __init__(self, settings: Settings, store: SessionStore):
        self._settings = settings
        self._store = store
        self._providers = ProviderFactory(settings)
        self._policy = ResiliencePolicy(
            asr_stall_timeout_secs=settings.asr_stall_timeout_secs,
            llm_timeout_secs=settings.llm_timeout_secs,
            tts_timeout_secs=settings.tts_timeout_secs,
            transport_disconnect_grace_secs=settings.transport_disconnect_grace_secs,
        )
        self._sessions: dict[str, RealtimeSession] = {}

    def create_session(
        self,
        base_url: str,
        *,
        conversation_id: str | None = None,
        user: AuthenticatedUser,
    ) -> LocalSessionCreateResponse:
        session = self._store.create_session(conversation_id=conversation_id, owner_user_id=user.id)
        self._store.append_session_event(
            SessionEventRecord(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                conversationId=session.conversationId,
                sessionId=session.id,
                type="session_started",
                createdAt=session.startedAt or iso_now(),
            )
        )
        self._store.append_latency_event(
            LatencyEventRecord(
                id=f"lat_{uuid.uuid4().hex[:12]}",
                conversationId=session.conversationId,
                sessionId=session.id,
                stage="session_start",
                startedAt=session.startedAt or iso_now(),
                completedAt=session.startedAt or iso_now(),
                durationMs=0,
            )
        )
        self._sessions[session.id] = RealtimeSession(
            session=session,
            request_handler=self._build_request_handler(),
            resilience=SessionResilienceCoordinator(
                policy=self._policy,
                store=self._store,
                session=session,
                on_asr_timeout=_noop_fallback,
                on_llm_timeout=_noop_fallback,
                on_tts_timeout=_noop_fallback,
                on_disconnect_expired=_noop_async,
            ),
        )
        return LocalSessionCreateResponse(
            conversationId=session.conversationId,
            session=session,
            offerEndpoint=f"{base_url}/api/local/sessions/{session.id}/offer",
        )

    async def handle_offer(self, session_id: str, request: SmallWebRTCOfferRequest) -> SmallWebRTCOfferResponse:
        realtime = self._require_session(session_id)
        payload = SmallWebRTCRequest.from_dict(request.model_dump(exclude_none=True))

        async def create_pipeline(webrtc_connection) -> None:
            if realtime.resilience is None:
                realtime.resilience = SessionResilienceCoordinator(
                    policy=self._policy,
                    store=self._store,
                    session=realtime.session,
                    on_asr_timeout=_noop_fallback,
                    on_llm_timeout=_noop_fallback,
                    on_tts_timeout=_noop_fallback,
                    on_disconnect_expired=_noop_async,
                )
            transport, task, runner, observer = build_session_task(
                settings=self._settings,
                providers=self._providers.build(),
                store=self._store,
                conversation_id=realtime.session.conversationId,
                session_id=realtime.session.id,
                session_started_at=realtime.session.startedAt,
                webrtc_connection=webrtc_connection,
                resilience=realtime.resilience,
                on_transport_connected=lambda: self._on_transport_connected(realtime),
                on_transport_disconnected=lambda: self._on_transport_disconnected(realtime),
            )
            realtime.task = task
            realtime.runner = runner
            realtime.observer = observer
            realtime.resilience.set_callbacks(
                on_asr_timeout=observer.handle_asr_timeout,
                on_llm_timeout=observer.handle_llm_timeout,
                on_tts_timeout=observer.handle_tts_timeout,
                on_disconnect_expired=lambda: self._expire_reconnect(realtime),
            )

            @task.event_handler("on_pipeline_finished")
            async def on_pipeline_finished(_task, _frame):
                if realtime.observer:
                    realtime.observer.flush_active_turn(status="partial")
                if realtime.session.status == "reconnecting":
                    return
                realtime.session.status = "ended"
                realtime.session.endedAt = iso_now()
                self._store.save_session(realtime.session)
                self._finalize_artifacts(realtime.session)

            @task.event_handler("on_pipeline_error")
            async def on_pipeline_error(_task, frame):
                if realtime.observer:
                    realtime.observer.flush_active_turn(status="failed")
                if realtime.session.status == "reconnecting":
                    return
                realtime.session.status = "failed"
                realtime.session.endedAt = iso_now()
                self._store.save_session(realtime.session)
                self._store.append_session_event(
                    SessionEventRecord(
                        id=f"evt_{uuid.uuid4().hex[:12]}",
                        conversationId=realtime.session.conversationId,
                        sessionId=realtime.session.id,
                        type="transport_failed",
                        createdAt=iso_now(),
                        details={"message": getattr(frame, "error", "unknown pipeline error")},
                    )
                )
                self._finalize_artifacts(realtime.session)

            realtime.runner_task = asyncio.create_task(runner.run(task))

        answer = await realtime.request_handler.handle_web_request(
            payload,
            create_pipeline,
        )
        realtime.session.status = "live"
        self._store.save_session(realtime.session)
        return SmallWebRTCOfferResponse.model_validate(answer)

    def resume_session(self, base_url: str, session_id: str) -> LocalSessionCreateResponse:
        realtime = self._require_session(session_id)
        if realtime.session.status != "reconnecting":
            raise ValueError("Session is not waiting for reconnect")
        realtime.request_handler = self._build_request_handler()
        return LocalSessionCreateResponse(
            conversationId=realtime.session.conversationId,
            session=realtime.session,
            offerEndpoint=f"{base_url}/api/local/sessions/{realtime.session.id}/offer",
        )

    async def handle_patch(self, session_id: str, request: SmallWebRTCPatchRequestModel) -> None:
        realtime = self._require_session(session_id)
        await realtime.request_handler.handle_patch_request(
            SmallWebRTCPatchRequest(
                pc_id=request.pc_id,
                candidates=request.candidates,
            )
        )

    async def end_session(self, session_id: str) -> SessionRecord:
        realtime = self._require_session(session_id)
        if realtime.observer:
            realtime.observer.flush_active_turn(status="partial")
        if realtime.task:
            await realtime.task.queue_frame(EndFrame())
        if realtime.runner_task:
            try:
                await asyncio.wait_for(realtime.runner_task, timeout=10)
            except asyncio.TimeoutError:
                realtime.runner_task.cancel()
        await realtime.request_handler.close()
        if realtime.resilience:
            realtime.resilience.close()
        realtime.session.status = "ended"
        realtime.session.endedAt = iso_now()
        self._store.save_session(realtime.session)
        self._store.append_session_event(
            SessionEventRecord(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                conversationId=realtime.session.conversationId,
                sessionId=realtime.session.id,
                type="session_ended",
                createdAt=realtime.session.endedAt,
            )
        )
        self._finalize_artifacts(realtime.session)
        return realtime.session

    def get_events(self, session_id: str) -> LocalSessionEventsResponse:
        realtime = self._require_session(session_id)
        return self._store.load_events(realtime.session.conversationId, realtime.session.id)

    def get_timeline(self, session_id: str) -> SessionTimelineResponse:
        realtime = self._require_session(session_id)
        return build_session_timeline(self._store, realtime.session.conversationId, realtime.session.id)

    async def close(self) -> None:
        for session_id in list(self._sessions.keys()):
            realtime = self._sessions[session_id]
            try:
                await realtime.request_handler.close()
            except Exception:
                continue

    def _require_session(self, session_id: str) -> RealtimeSession:
        if session_id not in self._sessions:
            session = self._store.load_session_by_id(session_id)
            realtime = RealtimeSession(
                session=session,
                request_handler=self._build_request_handler(),
            )
            self._sessions[session_id] = realtime
        realtime = self._sessions.get(session_id)
        if not realtime:
            raise KeyError(f"Unknown session: {session_id}")
        return realtime

    def _finalize_artifacts(self, session: SessionRecord) -> None:
        try:
            generate_replay_artifact(self._store, session.conversationId, session.id)
        except Exception as exc:
            self._store.append_session_event(
                SessionEventRecord(
                    id=f"evt_{uuid.uuid4().hex[:12]}",
                    conversationId=session.conversationId,
                    sessionId=session.id,
                    type="transport_failed",
                    createdAt=iso_now(),
                    details={"message": f"Replay artifact generation failed: {exc}"},
                )
            )

    def _build_request_handler(self) -> SmallWebRTCRequestHandler:
        return SmallWebRTCRequestHandler(
            ice_servers=self._settings.smallwebrtc_ice_servers,
            connection_mode=ConnectionMode.SINGLE,
        )

    async def _on_transport_connected(self, realtime: RealtimeSession) -> None:
        if realtime.session.status == "reconnecting":
            if realtime.resilience:
                realtime.resilience.on_transport_resumed()
            self._store.append_session_event(
                SessionEventRecord(
                    id=f"evt_{uuid.uuid4().hex[:12]}",
                    conversationId=realtime.session.conversationId,
                    sessionId=realtime.session.id,
                    type="transport_resumed",
                    createdAt=iso_now(),
                )
            )
        realtime.session.status = "live"
        self._store.save_session(realtime.session)

    async def _on_transport_disconnected(self, realtime: RealtimeSession) -> None:
        self._store.append_session_event(
            SessionEventRecord(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                conversationId=realtime.session.conversationId,
                sessionId=realtime.session.id,
                type="transport_disconnected",
                createdAt=iso_now(),
            )
        )
        self._store.append_session_event(
            SessionEventRecord(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                conversationId=realtime.session.conversationId,
                sessionId=realtime.session.id,
                type="transport_reconnecting",
                createdAt=iso_now(),
            )
        )
        if realtime.observer:
            realtime.observer.flush_active_turn(status="partial")
        if realtime.resilience:
            realtime.resilience.on_transport_disconnected()
        if realtime.runner_task and not realtime.runner_task.done():
            realtime.runner_task.cancel()
        try:
            await realtime.request_handler.close()
        except Exception:
            pass
        realtime.task = None
        realtime.runner = None
        realtime.runner_task = None
        realtime.observer = None
        realtime.session.status = "reconnecting"
        self._store.save_session(realtime.session)

    async def _expire_reconnect(self, realtime: RealtimeSession) -> None:
        if realtime.observer:
            realtime.observer.flush_active_turn(status="failed")
        realtime.session.status = "failed"
        realtime.session.endedAt = iso_now()
        self._store.save_session(realtime.session)
        self._store.append_session_event(
            SessionEventRecord(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                conversationId=realtime.session.conversationId,
                sessionId=realtime.session.id,
                type="transport_failed",
                createdAt=realtime.session.endedAt,
                details={"message": "Reconnect grace window expired"},
            )
        )
        self._finalize_artifacts(realtime.session)
