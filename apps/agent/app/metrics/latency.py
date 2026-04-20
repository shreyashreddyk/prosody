from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.models import LatencyEventRecord
from app.storage.local_store import LocalSessionStore, normalize_latency_stage


def iso_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class LatencyRecorder:
    def __init__(self, store: LocalSessionStore, conversation_id: str, session_id: str):
        self._store = store
        self._conversation_id = conversation_id
        self._session_id = session_id
        self._session_start_at: str | None = None
        self._turn_started_at: dict[str, str] = {}
        self._by_key: dict[tuple[str | None, str], LatencyEventRecord] = {}

    def seed_session_start(self, started_at: str) -> None:
        self._session_start_at = started_at

    def record_stage(
        self,
        stage: str,
        *,
        turn_id: str | None = None,
        occurred_at: str | None = None,
    ) -> LatencyEventRecord:
        normalized_stage = normalize_latency_stage(stage)
        key = (turn_id, normalized_stage)
        existing = self._by_key.get(key)
        if existing:
            return existing

        started_at = occurred_at or iso_now()
        if normalized_stage == "session_start":
            self._session_start_at = started_at

        if turn_id and turn_id not in self._turn_started_at:
            self._turn_started_at[turn_id] = started_at

        duration_ms = self._build_duration_ms(normalized_stage, turn_id, started_at)
        event = LatencyEventRecord(
            id=f"lat_{uuid.uuid4().hex[:12]}",
            conversationId=self._conversation_id,
            sessionId=self._session_id,
            turnId=turn_id,
            stage=normalized_stage,
            startedAt=started_at,
            completedAt=started_at,
            durationMs=duration_ms,
        )
        self._by_key[key] = event
        self._store.append_latency_event(event)
        return event

    def _build_duration_ms(self, stage: str, turn_id: str | None, started_at: str) -> float | None:
        if stage == "session_start":
            return 0

        reference = self._turn_started_at.get(turn_id) if turn_id else self._session_start_at
        if reference is None:
            return None
        return (parse_iso(started_at) - parse_iso(reference)).total_seconds() * 1000
