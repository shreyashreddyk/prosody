from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Iterable

from app.models import (
    LatencyEventRecord,
    LocalSessionEventsResponse,
    SessionEventRecord,
    SessionRecord,
    TranscriptEventRecord,
    TurnLatencySummaryRecord,
    TurnRecord,
)


def iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class LocalSessionStore:
    def __init__(self, root_dir: Path):
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def create_session(self, conversation_id: str | None = None) -> SessionRecord:
        conversation_id = conversation_id or f"conv_{uuid.uuid4().hex[:12]}"
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        started_at = iso_now()
        record = SessionRecord(
            id=session_id,
            conversationId=conversation_id,
            transportKind="smallwebrtc",
            status="connecting",
            startedAt=started_at,
        )
        session_dir = self.session_dir(conversation_id, session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        self._write_json(session_dir / "session.json", record.model_dump())
        self._write_json(session_dir / "turns.json", [])
        (session_dir / "transcript-events.jsonl").touch(exist_ok=True)
        (session_dir / "latency-events.jsonl").touch(exist_ok=True)
        (session_dir / "session-events.jsonl").touch(exist_ok=True)
        return record

    def session_dir(self, conversation_id: str, session_id: str) -> Path:
        return self._root_dir / "conversations" / conversation_id / "sessions" / session_id

    def load_session(self, conversation_id: str, session_id: str) -> SessionRecord:
        payload = self._read_json(self.session_dir(conversation_id, session_id) / "session.json")
        return SessionRecord.model_validate(payload)

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

    def append_transcript_event(self, event: TranscriptEventRecord) -> None:
        self._append_jsonl(
            self.session_dir(event.conversationId, event.sessionId) / "transcript-events.jsonl",
            event.model_dump(),
        )

    def append_latency_event(self, event: LatencyEventRecord) -> None:
        self._append_jsonl(
            self.session_dir(event.conversationId, event.sessionId) / "latency-events.jsonl",
            event.model_dump(),
        )

    def save_turns(self, conversation_id: str, session_id: str, turns: Iterable[TurnRecord]) -> None:
        self._write_json(
            self.session_dir(conversation_id, session_id) / "turns.json",
            [turn.model_dump() for turn in turns],
        )

    def load_turns(self, conversation_id: str, session_id: str) -> list[TurnRecord]:
        payload = self._read_json(self.session_dir(conversation_id, session_id) / "turns.json")
        return [TurnRecord.model_validate(item) for item in payload]

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
        latency_summary: TurnLatencySummaryRecord | None = None,
    ) -> None:
        turns = self.load_turns(conversation_id, session_id)
        existing = next((turn for turn in turns if turn.id == turn_id), None)
        if existing:
            existing.transcriptText = text
            existing.latencySummary = latency_summary
        else:
            turns.append(
                TurnRecord(
                    id=turn_id,
                    conversationId=conversation_id,
                    sessionId=session_id,
                    role=role,
                    transcriptText=text,
                    createdAt=created_at,
                    latencySummary=latency_summary,
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
