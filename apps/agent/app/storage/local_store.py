from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Iterable

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


def iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def normalize_latency_stage(stage: str) -> str:
    return {
        "first_transcript_partial": "first_asr_partial",
        "final_transcript": "final_asr",
        "first_assistant_text": "llm_first_token",
        "first_assistant_audio_playback": "playback_start",
    }.get(stage, stage)


class LocalSessionStore:
    def __init__(self, root_dir: Path):
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def create_session(self, conversation_id: str | None = None, owner_user_id: str | None = None) -> SessionRecord:
        conversation_id = conversation_id or f"conv_{uuid.uuid4().hex[:12]}"
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        started_at = iso_now()
        record = SessionRecord(
            id=session_id,
            conversationId=conversation_id,
            transportKind="smallwebrtc",
            status="connecting",
            startedAt=started_at,
            createdAt=started_at,
            updatedAt=started_at,
        )
        session_dir = self.session_dir(conversation_id, session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        self._write_json(session_dir / "session.json", record.model_dump())
        self._write_json(session_dir / "turns.json", [])
        self._write_json(session_dir / "turn-timings.json", [])
        (session_dir / "transcript-events.jsonl").touch(exist_ok=True)
        (session_dir / "latency-events.jsonl").touch(exist_ok=True)
        (session_dir / "session-events.jsonl").touch(exist_ok=True)
        (session_dir / "timeline-events.jsonl").touch(exist_ok=True)
        return record

    def session_dir(self, conversation_id: str, session_id: str) -> Path:
        return self._root_dir / "conversations" / conversation_id / "sessions" / session_id

    def load_session(self, conversation_id: str, session_id: str) -> SessionRecord:
        payload = self._read_json(self.session_dir(conversation_id, session_id) / "session.json")
        return SessionRecord.model_validate(payload)

    def load_session_by_id(self, session_id: str) -> SessionRecord:
        for conv_dir in (self._root_dir / "conversations").glob("*"):
            session_path = conv_dir / "sessions" / session_id / "session.json"
            if session_path.exists():
                return SessionRecord.model_validate(self._read_json(session_path))
        raise KeyError(f"Unknown session: {session_id}")

    def ensure_conversation_owner(self, conversation_id: str, user_id: str) -> None:
        conversation_dir = self._root_dir / "conversations" / conversation_id
        if not conversation_dir.exists():
            raise KeyError(f"Unknown conversation: {conversation_id}")

    def ensure_session_owner(self, session_id: str, user_id: str) -> SessionRecord:
        return self.load_session_by_id(session_id)

    def save_session(self, session: SessionRecord) -> None:
        self._write_json(
            self.session_dir(session.conversationId, session.id) / "session.json",
            session.model_dump(),
        )

    def append_session_event(self, event: SessionEventRecord) -> None:
        self._append_jsonl(
            self.session_dir(event.conversationId, event.sessionId) / "session-events.jsonl",
            event.model_dump(),
        )
        self.append_timeline_event(
            SessionTimelineEventRecord(
                id=event.id,
                conversationId=event.conversationId,
                sessionId=event.sessionId,
                kind="session",
                createdAt=event.createdAt,
                sequence=self.next_timeline_sequence(event.conversationId, event.sessionId),
                details={"type": event.type, **(event.details or {})},
            )
        )

    def append_transcript_event(self, event: TranscriptEventRecord) -> None:
        self._append_jsonl(
            self.session_dir(event.conversationId, event.sessionId) / "transcript-events.jsonl",
            event.model_dump(),
        )
        self.append_timeline_event(
            SessionTimelineEventRecord(
                id=event.id,
                conversationId=event.conversationId,
                sessionId=event.sessionId,
                turnId=event.turnId,
                kind="transcript",
                createdAt=event.createdAt,
                sequence=self.next_timeline_sequence(event.conversationId, event.sessionId),
                details={"role": event.role, "kind": event.kind, "text": event.text},
            )
        )

    def append_latency_event(self, event: LatencyEventRecord) -> None:
        payload = event.model_copy(update={"stage": normalize_latency_stage(event.stage)})
        self._append_jsonl(
            self.session_dir(payload.conversationId, payload.sessionId) / "latency-events.jsonl",
            payload.model_dump(),
        )
        self.append_timeline_event(
            SessionTimelineEventRecord(
                id=payload.id,
                conversationId=payload.conversationId,
                sessionId=payload.sessionId,
                turnId=payload.turnId,
                kind="latency",
                stage=payload.stage,
                createdAt=payload.startedAt,
                sequence=self.next_timeline_sequence(payload.conversationId, payload.sessionId),
                details={"durationMs": payload.durationMs},
            )
        )

    def append_timeline_event(self, event: SessionTimelineEventRecord) -> None:
        self._append_jsonl(
            self.session_dir(event.conversationId, event.sessionId) / "timeline-events.jsonl",
            event.model_dump(),
        )

    def load_timeline_events(self, conversation_id: str, session_id: str) -> list[SessionTimelineEventRecord]:
        return self._read_jsonl(
            self.session_dir(conversation_id, session_id) / "timeline-events.jsonl",
            SessionTimelineEventRecord,
        )

    def next_timeline_sequence(self, conversation_id: str, session_id: str) -> int:
        path = self.session_dir(conversation_id, session_id) / "timeline-events.jsonl"
        if not path.exists():
            return 1
        with path.open("r", encoding="utf-8") as handle:
            return sum(1 for line in handle if line.strip()) + 1

    def save_turns(self, conversation_id: str, session_id: str, turns: Iterable[TurnRecord]) -> None:
        self._write_json(
            self.session_dir(conversation_id, session_id) / "turns.json",
            [turn.model_dump() for turn in turns],
        )

    def load_turns(self, conversation_id: str, session_id: str) -> list[TurnRecord]:
        payload = self._read_json(self.session_dir(conversation_id, session_id) / "turns.json")
        return [TurnRecord.model_validate(item) for item in payload]

    def save_turn_timings(
        self,
        conversation_id: str,
        session_id: str,
        turn_timings: Iterable[TurnTimingRecord],
    ) -> None:
        self._write_json(
            self.session_dir(conversation_id, session_id) / "turn-timings.json",
            [turn.model_dump() for turn in turn_timings],
        )

    def load_turn_timings(self, conversation_id: str, session_id: str) -> list[TurnTimingRecord]:
        path = self.session_dir(conversation_id, session_id) / "turn-timings.json"
        if not path.exists():
            return []
        payload = self._read_json(path)
        return [TurnTimingRecord.model_validate(item) for item in payload]

    def save_replay_artifact(
        self,
        conversation_id: str,
        session_id: str,
        artifact: ReplayArtifactRecord,
    ) -> None:
        self._write_json(
            self.session_dir(conversation_id, session_id) / "replay-artifact.json",
            artifact.model_dump(),
        )

    def load_replay_artifact(self, conversation_id: str, session_id: str) -> ReplayArtifactRecord | None:
        path = self.session_dir(conversation_id, session_id) / "replay-artifact.json"
        if not path.exists():
            return None
        return ReplayArtifactRecord.model_validate(self._read_json(path))

    def replay_artifact_status(self, conversation_id: str, session_id: str) -> ReplayArtifactStatusRecord:
        artifact = self.load_replay_artifact(conversation_id, session_id)
        if artifact is None:
            return ReplayArtifactStatusRecord(available=False)
        return ReplayArtifactStatusRecord(
            available=True,
            generatedAt=artifact.generatedAt,
            path=str(self.session_dir(conversation_id, session_id) / "replay-artifact.json"),
        )

    def load_degradation_events(self, conversation_id: str, session_id: str) -> list[DegradationEventRecord]:
        path = self.session_dir(conversation_id, session_id) / "degradation-events.jsonl"
        if not path.exists():
            return []
        return self._read_jsonl(path, DegradationEventRecord)

    def load_events(self, conversation_id: str, session_id: str) -> LocalSessionEventsResponse:
        session = self.load_session(conversation_id, session_id)
        session_events = self._read_jsonl(
            self.session_dir(conversation_id, session_id) / "session-events.jsonl",
            SessionEventRecord,
        )
        transcript_events = self._read_jsonl(
            self.session_dir(conversation_id, session_id) / "transcript-events.jsonl",
            TranscriptEventRecord,
        )
        latency_events = self._read_jsonl(
            self.session_dir(conversation_id, session_id) / "latency-events.jsonl",
            LatencyEventRecord,
        )
        turns = self.load_turns(conversation_id, session_id)
        return LocalSessionEventsResponse(
            session=session,
            sessionEvents=session_events,
            transcriptEvents=transcript_events,
            latencyEvents=latency_events,
            turns=turns,
        )

    def upsert_turn_from_transcript(
        self,
        *,
        conversation_id: str,
        session_id: str,
        turn_id: str,
        role: str,
        text: str,
        created_at: str,
    ) -> None:
        turns = self.load_turns(conversation_id, session_id)
        existing = next((turn for turn in turns if turn.id == turn_id), None)
        if existing:
            if role == "user":
                existing.userText = text
                if existing.finalAsrAt is None:
                    existing.finalAsrAt = created_at
            else:
                existing.assistantText = text
                if existing.completedAt is None:
                    existing.completedAt = created_at
            existing.updatedAt = created_at
        else:
            turns.append(
                TurnRecord(
                    id=turn_id,
                    conversationId=conversation_id,
                    sessionId=session_id,
                    turnIndex=len(turns) + 1,
                    userText=text if role == "user" else None,
                    assistantText=text if role == "assistant" else None,
                    finalAsrAt=created_at if role == "user" else None,
                    completedAt=created_at if role == "assistant" else None,
                    createdAt=created_at,
                    updatedAt=created_at,
                )
            )
        self.save_turns(conversation_id, session_id, turns)

    def _append_jsonl(self, path: Path, payload: dict) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload) + "\n")

    def _read_jsonl(self, path: Path, model):
        if not path.exists():
            return []
        result = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                result.append(model.model_validate(json.loads(line)))
        return result

    def _write_json(self, path: Path, payload) -> None:
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)

    def _read_json(self, path: Path):
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
