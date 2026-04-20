from __future__ import annotations

import json
import uuid
from collections import defaultdict
from dataclasses import dataclass

import httpx

from app.config import Settings
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
    TurnLatencySummaryRecord,
    TurnRecord,
    TurnTimingRecord,
)
from app.storage.local_store import iso_now


TURN_STAGE_FIELD = {
    "first_user_audio": "user_audio_capture_start_at",
    "first_asr_partial": "first_asr_partial_at",
    "final_asr": "final_asr_at",
    "llm_request_start": "llm_request_start_at",
    "llm_first_token": "llm_first_token_at",
    "tts_request_start": "tts_request_start_at",
    "tts_first_byte": "tts_first_byte_at",
    "playback_start": "playback_start_at",
    "turn_completed": "completed_at",
}


def normalize_latency_stage(stage: str) -> str:
    return {
        "first_transcript_partial": "first_asr_partial",
        "final_transcript": "final_asr",
        "first_assistant_text": "llm_first_token",
        "first_assistant_audio_playback": "playback_start",
    }.get(stage, stage)


@dataclass
class ConnectivityState:
    jwks_reachable: bool = False
    rest_reachable: bool = False


class SupabaseSessionStore:
    def __init__(self, settings: Settings):
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

        self._settings = settings
        self._base_url = settings.supabase_url.rstrip("/")
        self._client = httpx.Client(
            timeout=10.0,
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
        )
        self._transcript_events: dict[str, list[TranscriptEventRecord]] = defaultdict(list)
        self._session_events: dict[str, list[SessionEventRecord]] = defaultdict(list)
        self._replay_artifacts: dict[str, ReplayArtifactRecord] = {}
        self._turn_timings: dict[str, list[TurnTimingRecord]] = {}
        self._latency_sequence: dict[str, int] = defaultdict(int)
        self.connectivity = ConnectivityState()
        self.refresh_connectivity()

    def refresh_connectivity(self) -> ConnectivityState:
        try:
            self.connectivity.jwks_reachable = self._client.get(f"{self._base_url}/auth/v1/.well-known/jwks.json").is_success
        except Exception:
            self.connectivity.jwks_reachable = False

        try:
            self.connectivity.rest_reachable = self._client.get(f"{self._base_url}/rest/v1/").is_success
        except Exception:
            self.connectivity.rest_reachable = False
        return self.connectivity

    def close(self) -> None:
        self._client.close()

    def ensure_conversation_owner(self, conversation_id: str, user_id: str) -> None:
        response = self._get(
            "conversations",
            params={
                "select": "id",
                "id": f"eq.{conversation_id}",
                "owner_user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if not response:
            raise KeyError(f"Unknown conversation: {conversation_id}")

    def ensure_session_owner(self, session_id: str, user_id: str) -> SessionRecord:
        response = self._get(
            "sessions",
            params={
                "select": "*",
                "id": f"eq.{session_id}",
                "owner_user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if not response:
            raise KeyError(f"Unknown session: {session_id}")
        return self._map_session(response[0])

    def create_session(self, conversation_id: str | None = None, owner_user_id: str | None = None) -> SessionRecord:
        if conversation_id is None or owner_user_id is None:
            raise ValueError("conversation_id and owner_user_id are required")
        session_id = str(uuid.uuid4())
        started_at = iso_now()
        payload = {
            "id": session_id,
            "conversation_id": conversation_id,
            "owner_user_id": owner_user_id,
            "status": "connecting",
            "transport": "smallwebrtc",
            "started_at": started_at,
            "created_at": started_at,
            "updated_at": started_at,
        }
        self._post("sessions", payload)
        self._touch_conversation(conversation_id)
        return SessionRecord(
            id=session_id,
            conversationId=conversation_id,
            transportKind="smallwebrtc",
            status="connecting",
            startedAt=started_at,
            createdAt=started_at,
            updatedAt=started_at,
        )

    def load_session(self, conversation_id: str, session_id: str) -> SessionRecord:
        response = self._get(
            "sessions",
            params={"select": "*", "id": f"eq.{session_id}", "conversation_id": f"eq.{conversation_id}", "limit": "1"},
        )
        if not response:
            raise KeyError(f"Unknown session: {session_id}")
        return self._map_session(response[0])

    def load_session_by_id(self, session_id: str) -> SessionRecord:
        response = self._get("sessions", params={"select": "*", "id": f"eq.{session_id}", "limit": "1"})
        if not response:
            raise KeyError(f"Unknown session: {session_id}")
        return self._map_session(response[0])

    def save_session(self, session: SessionRecord) -> None:
        payload = {
            "status": session.status,
            "transport": session.transportKind,
            "started_at": session.startedAt,
            "ended_at": session.endedAt,
            "updated_at": iso_now(),
        }
        self._patch("sessions", payload, {"id": f"eq.{session.id}"})
        self._touch_conversation(session.conversationId)

    def append_session_event(self, event: SessionEventRecord) -> None:
        self._session_events[event.sessionId].append(event)

    def append_transcript_event(self, event: TranscriptEventRecord) -> None:
        self._transcript_events[event.sessionId].append(event)

    def append_latency_event(self, event: LatencyEventRecord) -> None:
        self._latency_sequence[event.sessionId] += 1
        normalized_stage = normalize_latency_stage(event.stage)
        self._post(
            "latency_events",
            {
                "id": event.id,
                "session_id": event.sessionId,
                "conversation_id": event.conversationId,
                "owner_user_id": self._session_owner_id(event.sessionId),
                "turn_id": event.turnId,
                "name": normalized_stage,
                "sequence": self._latency_sequence[event.sessionId],
                "source": "agent",
                "metadata": {"durationMs": event.durationMs},
                "timestamp": event.startedAt,
            },
        )
        if event.turnId:
            field_name = TURN_STAGE_FIELD.get(normalized_stage)
            if field_name and self._get("turns", params={"select": "id", "id": f"eq.{event.turnId}", "limit": "1"}):
                self._patch("turns", {field_name: event.startedAt, "updated_at": event.startedAt}, {"id": f"eq.{event.turnId}"})

    def append_degradation_event(self, event: DegradationEventRecord) -> None:
        self._post(
            "degradation_events",
            {
                "id": event.id,
                "conversation_id": event.conversationId,
                "session_id": event.sessionId,
                "owner_user_id": self._session_owner_id(event.sessionId),
                "turn_id": event.turnId,
                "category": event.category,
                "severity": event.severity,
                "provider": event.provider,
                "code": event.code,
                "message": event.message,
                "details": event.details or {},
                "created_at": event.createdAt,
                "recovered_at": event.recoveredAt,
            },
        )

    def recover_degradation_event(self, conversation_id: str, session_id: str, event_id: str, recovered_at: str) -> None:
        self._patch(
            "degradation_events",
            {"recovered_at": recovered_at},
            {
                "id": f"eq.{event_id}",
                "conversation_id": f"eq.{conversation_id}",
                "session_id": f"eq.{session_id}",
            },
        )

    def append_timeline_event(self, event: SessionTimelineEventRecord) -> None:
        return None

    def load_timeline_events(self, conversation_id: str, session_id: str) -> list[SessionTimelineEventRecord]:
        return []

    def next_timeline_sequence(self, conversation_id: str, session_id: str) -> int:
        return self._latency_sequence[session_id] + len(self._session_events[session_id]) + len(self._transcript_events[session_id]) + 1

    def save_turns(self, conversation_id: str, session_id: str, turns: list[TurnRecord]) -> None:
        return None

    def load_turns(self, conversation_id: str, session_id: str) -> list[TurnRecord]:
        rows = self._get(
            "turns",
            params={
                "select": "*",
                "conversation_id": f"eq.{conversation_id}",
                "session_id": f"eq.{session_id}",
                "order": "turn_index.asc",
            },
        )
        return [self._map_turn(row) for row in rows]

    def save_turn_timings(self, conversation_id: str, session_id: str, turn_timings: list[TurnTimingRecord]) -> None:
        self._turn_timings[session_id] = turn_timings

    def load_turn_timings(self, conversation_id: str, session_id: str) -> list[TurnTimingRecord]:
        return self._turn_timings.get(session_id, [])

    def save_replay_artifact(self, conversation_id: str, session_id: str, artifact: ReplayArtifactRecord) -> None:
        self._replay_artifacts[session_id] = artifact

    def load_replay_artifact(self, conversation_id: str, session_id: str) -> ReplayArtifactRecord | None:
        return self._replay_artifacts.get(session_id)

    def replay_artifact_status(self, conversation_id: str, session_id: str) -> ReplayArtifactStatusRecord:
        artifact = self._replay_artifacts.get(session_id)
        if artifact:
            return ReplayArtifactStatusRecord(available=True, generatedAt=artifact.generatedAt)
        session = self.load_session(conversation_id, session_id)
        if session.endedAt:
            return ReplayArtifactStatusRecord(available=True, generatedAt=session.endedAt)
        return ReplayArtifactStatusRecord(available=False)

    def load_degradation_events(self, conversation_id: str, session_id: str) -> list[DegradationEventRecord]:
        rows = self._get(
            "degradation_events",
            params={
                "select": "*",
                "conversation_id": f"eq.{conversation_id}",
                "session_id": f"eq.{session_id}",
                "order": "timestamp.asc",
            },
        )
        return [
            DegradationEventRecord(
                id=row["id"],
                conversationId=row["conversation_id"],
                sessionId=row["session_id"],
                turnId=row.get("turn_id"),
                category=row.get("category", row.get("reason", "provider")),
                severity=row.get("severity", "warning"),
                provider=row.get("provider"),
                code=row.get("code", "transport_disconnect"),
                message=row["message"],
                details=row.get("details") or {},
                createdAt=row.get("created_at", row.get("timestamp", iso_now())),
                recoveredAt=row.get("recovered_at", row.get("recovery")),
            )
            for row in rows
        ]

    def load_events(self, conversation_id: str, session_id: str) -> LocalSessionEventsResponse:
        session = self.load_session(conversation_id, session_id)
        turns = self.load_turns(conversation_id, session_id)
        transcript_events = self._build_transcript_events(turns, session_id)
        transcript_events.extend(self._transcript_events.get(session_id, []))
        transcript_events = sorted(transcript_events, key=lambda item: (item.createdAt, item.id))
        latency_events = self._load_latency_events(conversation_id, session_id)
        session_events = self._build_session_events(session)
        session_events.extend(self._session_events.get(session_id, []))
        session_events = sorted(session_events, key=lambda item: (item.createdAt, item.id))
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
        existing_rows = self._get("turns", params={"select": "*", "id": f"eq.{turn_id}", "limit": "1"})
        if existing_rows:
            payload = {
                "updated_at": created_at,
                "user_text" if role == "user" else "assistant_text": text,
            }
            if role == "user":
                payload["final_asr_at"] = created_at
            else:
                payload["completed_at"] = created_at
            self._patch("turns", payload, {"id": f"eq.{turn_id}"})
            return

        turn_count = len(self._get("turns", params={"select": "id", "session_id": f"eq.{session_id}"}))
        payload = {
            "id": turn_id,
            "conversation_id": conversation_id,
            "session_id": session_id,
            "owner_user_id": self._session_owner_id(session_id),
            "turn_index": turn_count + 1,
            "user_text": text if role == "user" else None,
            "assistant_text": text if role == "assistant" else None,
            "final_asr_at": created_at if role == "user" else None,
            "completed_at": created_at if role == "assistant" else None,
            "created_at": created_at,
            "updated_at": created_at,
        }
        payload.update(self._turn_fields_from_latency(conversation_id, session_id, turn_id))
        self._post("turns", payload)

    def _build_session_events(self, session: SessionRecord) -> list[SessionEventRecord]:
        events = [
            SessionEventRecord(
                id=f"{session.id}:session_started",
                conversationId=session.conversationId,
                sessionId=session.id,
                type="session_started",
                createdAt=session.startedAt or session.createdAt or iso_now(),
            )
        ]
        if session.endedAt:
            events.append(
                SessionEventRecord(
                    id=f"{session.id}:session_ended",
                    conversationId=session.conversationId,
                    sessionId=session.id,
                    type="session_ended",
                    createdAt=session.endedAt,
                )
            )
        return events

    def _build_transcript_events(self, turns: list[TurnRecord], session_id: str) -> list[TranscriptEventRecord]:
        events: list[TranscriptEventRecord] = []
        for turn in turns:
            if turn.userText:
                events.append(
                    TranscriptEventRecord(
                        id=f"{turn.id}:user",
                        conversationId=turn.conversationId,
                        sessionId=session_id,
                        turnId=turn.id,
                        role="user",
                        kind="final",
                        text=turn.userText,
                        createdAt=turn.finalAsrAt or turn.createdAt,
                    )
                )
            if turn.assistantText:
                events.append(
                    TranscriptEventRecord(
                        id=f"{turn.id}:assistant",
                        conversationId=turn.conversationId,
                        sessionId=session_id,
                        turnId=turn.id,
                        role="assistant",
                        kind="final",
                        text=turn.assistantText,
                        createdAt=turn.completedAt or turn.updatedAt or turn.createdAt,
                    )
                )
        return events

    def _load_latency_events(self, conversation_id: str, session_id: str) -> list[LatencyEventRecord]:
        rows = self._get(
            "latency_events",
            params={
                "select": "*",
                "conversation_id": f"eq.{conversation_id}",
                "session_id": f"eq.{session_id}",
                "order": "sequence.asc",
            },
        )
        events = []
        for row in rows:
            started_at = row.get("started_at") or row.get("timestamp")
            completed_at = row.get("completed_at") or started_at
            duration_ms = row.get("duration_ms")
            if duration_ms is None and isinstance(row.get("metadata"), dict):
                duration_ms = row["metadata"].get("durationMs")
            events.append(
                LatencyEventRecord(
                    id=row["id"],
                    conversationId=row["conversation_id"],
                    sessionId=row["session_id"],
                    turnId=row.get("turn_id"),
                    stage=normalize_latency_stage(row.get("name", row.get("stage"))),
                    startedAt=started_at,
                    completedAt=completed_at,
                    durationMs=duration_ms,
                )
            )
        return events

    def _session_owner_id(self, session_id: str) -> str:
        rows = self._get("sessions", params={"select": "owner_user_id", "id": f"eq.{session_id}", "limit": "1"})
        if not rows:
            raise KeyError(f"Unknown session: {session_id}")
        return rows[0]["owner_user_id"]

    def _touch_conversation(self, conversation_id: str) -> None:
        self._patch("conversations", {"updated_at": iso_now()}, {"id": f"eq.{conversation_id}"})

    def _turn_fields_from_latency(self, conversation_id: str, session_id: str, turn_id: str) -> dict[str, str]:
        rows = self._get(
            "latency_events",
            params={
                "select": "*",
                "conversation_id": f"eq.{conversation_id}",
                "session_id": f"eq.{session_id}",
                "turn_id": f"eq.{turn_id}",
            },
        )
        payload: dict[str, str] = {}
        for row in rows:
            field_name = TURN_STAGE_FIELD.get(normalize_latency_stage(row.get("name", "")))
            if field_name:
                payload[field_name] = row.get("timestamp")
        return payload

    def _map_session(self, row: dict) -> SessionRecord:
        return SessionRecord(
            id=row["id"],
            conversationId=row["conversation_id"],
            transportKind=row.get("transport_kind") or row.get("transport") or "smallwebrtc",
            status=row["status"],
            startedAt=row.get("started_at"),
            endedAt=row.get("ended_at"),
            createdAt=row.get("created_at"),
            updatedAt=row.get("updated_at"),
        )

    def _map_turn(self, row: dict) -> TurnRecord:
        durations = TurnLatencySummaryRecord()
        if row.get("user_audio_capture_start_at") and row.get("first_asr_partial_at"):
            durations.firstAsrPartialMs = self._duration_ms(row["user_audio_capture_start_at"], row["first_asr_partial_at"])
        if row.get("user_audio_capture_start_at") and row.get("final_asr_at"):
            durations.finalAsrMs = self._duration_ms(row["user_audio_capture_start_at"], row["final_asr_at"])
        if row.get("user_audio_capture_start_at") and row.get("llm_first_token_at"):
            durations.llmFirstTokenMs = self._duration_ms(row["user_audio_capture_start_at"], row["llm_first_token_at"])
        if row.get("user_audio_capture_start_at") and row.get("tts_first_byte_at"):
            durations.ttsFirstByteMs = self._duration_ms(row["user_audio_capture_start_at"], row["tts_first_byte_at"])
        if row.get("user_audio_capture_start_at") and row.get("playback_start_at"):
            durations.playbackStartMs = self._duration_ms(row["user_audio_capture_start_at"], row["playback_start_at"])
        if row.get("user_audio_capture_start_at") and row.get("completed_at"):
            durations.turnCompletedMs = self._duration_ms(row["user_audio_capture_start_at"], row["completed_at"])
        return TurnRecord(
            id=row["id"],
            conversationId=row["conversation_id"],
            sessionId=row["session_id"],
            turnIndex=row["turn_index"],
            userText=row.get("user_text"),
            assistantText=row.get("assistant_text"),
            userAudioCaptureStartAt=row.get("user_audio_capture_start_at"),
            firstAsrPartialAt=row.get("first_asr_partial_at"),
            finalAsrAt=row.get("final_asr_at"),
            llmRequestStartAt=row.get("llm_request_start_at"),
            llmFirstTokenAt=row.get("llm_first_token_at"),
            ttsRequestStartAt=row.get("tts_request_start_at"),
            ttsFirstByteAt=row.get("tts_first_byte_at"),
            playbackStartAt=row.get("playback_start_at"),
            completedAt=row.get("completed_at"),
            createdAt=row["created_at"],
            updatedAt=row.get("updated_at"),
            latencySummary=durations,
        )

    def _duration_ms(self, start: str, end: str) -> float:
        from app.metrics.latency import parse_iso

        return (parse_iso(end) - parse_iso(start)).total_seconds() * 1000

    def _get(self, table: str, *, params: dict[str, str]) -> list[dict]:
        response = self._client.get(f"{self._base_url}/rest/v1/{table}", params=params)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else [payload]

    def _post(self, table: str, payload: dict) -> None:
        response = self._client.post(
            f"{self._base_url}/rest/v1/{table}",
            content=json.dumps(payload),
            headers={"Prefer": "return=minimal"},
        )
        response.raise_for_status()

    def _patch(self, table: str, payload: dict, filters: dict[str, str]) -> None:
        response = self._client.patch(
            f"{self._base_url}/rest/v1/{table}",
            params=filters,
            content=json.dumps(payload),
            headers={"Prefer": "return=minimal"},
        )
        response.raise_for_status()
