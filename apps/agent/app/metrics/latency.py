from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.models import LatencyEventRecord, TurnLatencySummaryRecord
from app.storage.local_store import LocalSessionStore


def _iso_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class LatencyRecorder:
    def __init__(self, store: LocalSessionStore, conversation_id: str, session_id: str):
        self._store = store
        self._conversation_id = conversation_id
        self._session_id = session_id
        self._session_start_at: str | None = None
        self._by_stage: dict[str, LatencyEventRecord] = {}

    def seed_session_start(self, started_at: str) -> None:
        self._session_start_at = started_at

    def record_once(self, stage: str, *, turn_id: str | None = None) -> LatencyEventRecord:
        existing = self._by_stage.get(stage)
        if existing:
            return existing

        started_at = _iso_now()
        if stage == "session_start":
            self._session_start_at = started_at

        duration_ms = None
        if self._session_start_at and stage != "session_start":
            duration_ms = (_parse_iso(started_at) - _parse_iso(self._session_start_at)).total_seconds() * 1000

        event = LatencyEventRecord(
            id=f"lat_{uuid.uuid4().hex[:12]}",
            conversationId=self._conversation_id,
            sessionId=self._session_id,
            turnId=turn_id,
            stage=stage,
            startedAt=started_at,
            completedAt=started_at,
            durationMs=duration_ms,
        )
        self._by_stage[stage] = event
        self._store.append_latency_event(event)
        return event

    def build_turn_summary(self) -> TurnLatencySummaryRecord:
        return TurnLatencySummaryRecord(
            firstTranscriptPartialMs=self._duration("first_transcript_partial"),
            finalTranscriptMs=self._duration("final_transcript"),
            firstAssistantTextMs=self._duration("first_assistant_text"),
            firstAssistantAudioPlaybackMs=self._duration("first_assistant_audio_playback"),
        )

    def _duration(self, stage: str) -> float | None:
        event = self._by_stage.get(stage)
        return event.durationMs if event else None
