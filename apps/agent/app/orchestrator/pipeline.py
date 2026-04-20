from __future__ import annotations

import uuid

from pipecat.frames.frames import (
    ErrorFrame,
    Frame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TranscriptionFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair

from app.config import Settings
from app.metrics.latency import LatencyRecorder
from app.models import SessionEventRecord, TranscriptEventRecord
from app.providers.factory import ProviderBundle
from app.storage.base import SessionStore
from app.storage.local_store import iso_now
from app.transports.local_webrtc import build_smallwebrtc_transport


class SessionObserver(BaseObserver):
    def __init__(
        self,
        *,
        store: SessionStore,
        latency: LatencyRecorder,
        conversation_id: str,
        session_id: str,
    ):
        super().__init__()
        self._store = store
        self._latency = latency
        self._conversation_id = conversation_id
        self._session_id = session_id
        self._active_turn_id: str | None = None
        self._assistant_text_parts: list[str] = []
        self._assistant_transcript_persisted = False

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame

        if isinstance(frame, InterimTranscriptionFrame):
            turn_id = self._ensure_turn()
            created_at = getattr(frame, "timestamp", None) or iso_now()
            self._latency.record_stage("first_asr_partial", turn_id=turn_id, occurred_at=created_at)
            self._store.append_transcript_event(
                TranscriptEventRecord(
                    id=f"evt_{uuid.uuid4().hex[:12]}",
                    conversationId=self._conversation_id,
                    sessionId=self._session_id,
                    turnId=turn_id,
                    role="user",
                    kind="partial",
                    text=frame.text,
                    createdAt=created_at,
                )
            )
            return

        if isinstance(frame, InputAudioRawFrame):
            turn_id = self._ensure_turn()
            self._latency.record_stage("first_user_audio", turn_id=turn_id)
            return

        if isinstance(frame, TranscriptionFrame):
            turn_id = self._ensure_turn()
            created_at = getattr(frame, "timestamp", None) or iso_now()
            self._latency.record_stage("final_asr", turn_id=turn_id, occurred_at=created_at)
            self._store.append_transcript_event(
                TranscriptEventRecord(
                    id=f"evt_{uuid.uuid4().hex[:12]}",
                    conversationId=self._conversation_id,
                    sessionId=self._session_id,
                    turnId=turn_id,
                    role="user",
                    kind="final",
                    text=frame.text,
                    createdAt=created_at,
                )
            )
            self._store.upsert_turn_from_transcript(
                conversation_id=self._conversation_id,
                session_id=self._session_id,
                turn_id=turn_id,
                role="user",
                text=frame.text,
                created_at=created_at,
            )
            self._assistant_text_parts = []
            self._assistant_transcript_persisted = False
            return

        if isinstance(frame, LLMFullResponseStartFrame):
            turn_id = self._ensure_turn()
            self._latency.record_stage("llm_request_start", turn_id=turn_id)
            return

        if isinstance(frame, LLMTextFrame):
            turn_id = self._ensure_turn()
            self._assistant_text_parts.append(frame.text)
            self._latency.record_stage("llm_first_token", turn_id=turn_id)
            return

        if isinstance(frame, TTSStartedFrame):
            turn_id = self._ensure_turn()
            self._latency.record_stage("tts_request_start", turn_id=turn_id)
            return

        if isinstance(frame, TTSAudioRawFrame):
            turn_id = self._ensure_turn()
            self._latency.record_stage("tts_first_byte", turn_id=turn_id)
            self._latency.record_stage("playback_start", turn_id=turn_id)
            return

        if isinstance(frame, LLMFullResponseEndFrame):
            self.flush_active_turn(status="complete")
            return

        if isinstance(frame, ErrorFrame):
            self._store.append_session_event(
                SessionEventRecord(
                    id=f"evt_{uuid.uuid4().hex[:12]}",
                    conversationId=self._conversation_id,
                    sessionId=self._session_id,
                    type="transport_failed",
                    createdAt=iso_now(),
                    details={"message": frame.error},
                )
            )

    def flush_active_turn(self, *, status: str) -> None:
        if self._active_turn_id is None:
            return

        created_at = iso_now()
        self._persist_assistant_transcript(status=status, created_at=created_at)
        self._latency.record_stage("turn_completed", turn_id=self._active_turn_id, occurred_at=created_at)
        self._active_turn_id = None
        self._assistant_text_parts = []
        self._assistant_transcript_persisted = False

    def _persist_assistant_transcript(self, *, status: str, created_at: str) -> None:
        if self._assistant_transcript_persisted or self._active_turn_id is None:
            return

        text = "".join(self._assistant_text_parts).strip()
        if not text:
            return

        kind = "final" if status == "complete" else "partial"
        self._store.append_transcript_event(
            TranscriptEventRecord(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                conversationId=self._conversation_id,
                sessionId=self._session_id,
                turnId=self._active_turn_id,
                role="assistant",
                kind=kind,
                text=text,
                createdAt=created_at,
            )
        )
        self._store.upsert_turn_from_transcript(
            conversation_id=self._conversation_id,
            session_id=self._session_id,
            turn_id=self._active_turn_id,
            role="assistant",
            text=text,
            created_at=created_at,
        )
        self._assistant_transcript_persisted = True

    def _ensure_turn(self) -> str:
        if self._active_turn_id is None:
            self._active_turn_id = f"turn_{uuid.uuid4().hex[:12]}"
            self._assistant_text_parts = []
            self._assistant_transcript_persisted = False
        return self._active_turn_id


def build_session_task(
    *,
    settings: Settings,
    providers: ProviderBundle,
    store: SessionStore,
    conversation_id: str,
    session_id: str,
    session_started_at: str | None,
    webrtc_connection,
):
    latency = LatencyRecorder(store, conversation_id, session_id)
    if session_started_at:
        latency.seed_session_start(session_started_at)

    transport = build_smallwebrtc_transport(
        webrtc_connection,
        input_sample_rate=settings.input_sample_rate,
        output_sample_rate=settings.output_sample_rate,
    )
    observer = SessionObserver(
        store=store,
        latency=latency,
        conversation_id=conversation_id,
        session_id=session_id,
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _connection):
        await transport.capture_participant_audio()
        store.append_session_event(
            SessionEventRecord(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                conversationId=conversation_id,
                sessionId=session_id,
                type="transport_connected",
                createdAt=iso_now(),
            )
        )

    context = LLMContext(
        messages=[
            {"role": "system", "content": settings.llm_system_prompt},
        ]
    )
    context_aggregator = LLMContextAggregatorPair(context)

    pipeline = Pipeline(
        [
            transport.input(),
            providers.asr.build(),
            context_aggregator.user(),
            providers.llm.build(),
            providers.tts.build(),
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=settings.input_sample_rate,
            audio_out_sample_rate=settings.output_sample_rate,
        ),
        idle_timeout_secs=settings.session_idle_timeout_secs,
        observers=[observer],
    )

    runner = PipelineRunner(handle_sigint=False, handle_sigterm=False)
    return transport, task, runner, observer
