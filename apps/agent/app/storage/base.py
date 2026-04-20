from __future__ import annotations

from typing import Protocol

from app.models import (
    DegradationEventRecord,
    LatencyEventRecord,
    LocalSessionEventsResponse,
    ReplayArtifactRecord,
    ReplayArtifactStatusRecord,
    SessionEventRecord,
    SessionRecord,
    SessionTimelineEventRecord,
    TranscriptEventRecord,
    TurnRecord,
    TurnTimingRecord,
)


class SessionStore(Protocol):
    def create_session(self, conversation_id: str | None = None, owner_user_id: str | None = None) -> SessionRecord: ...

    def load_session(self, conversation_id: str, session_id: str) -> SessionRecord: ...

    def load_session_by_id(self, session_id: str) -> SessionRecord: ...

    def save_session(self, session: SessionRecord) -> None: ...

    def append_session_event(self, event: SessionEventRecord) -> None: ...

    def append_transcript_event(self, event: TranscriptEventRecord) -> None: ...

    def append_latency_event(self, event: LatencyEventRecord) -> None: ...

    def append_timeline_event(self, event: SessionTimelineEventRecord) -> None: ...

    def load_timeline_events(self, conversation_id: str, session_id: str) -> list[SessionTimelineEventRecord]: ...

    def next_timeline_sequence(self, conversation_id: str, session_id: str) -> int: ...

    def save_turns(self, conversation_id: str, session_id: str, turns: list[TurnRecord]) -> None: ...

    def load_turns(self, conversation_id: str, session_id: str) -> list[TurnRecord]: ...

    def save_turn_timings(self, conversation_id: str, session_id: str, turn_timings: list[TurnTimingRecord]) -> None: ...

    def load_turn_timings(self, conversation_id: str, session_id: str) -> list[TurnTimingRecord]: ...

    def save_replay_artifact(self, conversation_id: str, session_id: str, artifact: ReplayArtifactRecord) -> None: ...

    def load_replay_artifact(self, conversation_id: str, session_id: str) -> ReplayArtifactRecord | None: ...

    def replay_artifact_status(self, conversation_id: str, session_id: str) -> ReplayArtifactStatusRecord: ...

    def load_degradation_events(self, conversation_id: str, session_id: str) -> list[DegradationEventRecord]: ...

    def load_events(self, conversation_id: str, session_id: str) -> LocalSessionEventsResponse: ...

    def upsert_turn_from_transcript(
        self,
        *,
        conversation_id: str,
        session_id: str,
        turn_id: str,
        role: str,
        text: str,
        created_at: str,
    ) -> None: ...
