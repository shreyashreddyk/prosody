from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.models import LatencyEventRecord, SessionEventRecord, TranscriptEventRecord
from app.replay.service import build_session_timeline, generate_replay_artifact
from app.storage.local_store import LocalSessionStore


def _configure_env(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PROSODY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-deepgram")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-eleven")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice-id")


def _append_session_started(store: LocalSessionStore, conversation_id: str, session_id: str, created_at: str) -> None:
    store.append_session_event(
        SessionEventRecord(
            id="evt_session_started",
            conversationId=conversation_id,
            sessionId=session_id,
            type="session_started",
            createdAt=created_at,
        )
    )


def _append_latency(
    store: LocalSessionStore,
    conversation_id: str,
    session_id: str,
    event_id: str,
    stage: str,
    started_at: str,
    *,
    turn_id: str | None = None,
    duration_ms: float | None = None,
) -> None:
    store.append_latency_event(
        LatencyEventRecord(
            id=event_id,
            conversationId=conversation_id,
            sessionId=session_id,
            turnId=turn_id,
            stage=stage,
            startedAt=started_at,
            completedAt=started_at,
            durationMs=duration_ms,
        )
    )


def test_generate_replay_artifact_aggregates_multiple_turns(tmp_path: Path) -> None:
    store = LocalSessionStore(tmp_path)
    session = store.create_session("conv_observe")
    _append_session_started(store, session.conversationId, session.id, "2026-04-20T12:00:00Z")

    turn_one = "turn_one"
    turn_two = "turn_two"
    first_turn_events = [
        ("lat_1", "first_user_audio", "2026-04-20T12:00:01Z", 0.0),
        ("lat_2", "first_asr_partial", "2026-04-20T12:00:01.100000Z", 100.0),
        ("lat_3", "final_asr", "2026-04-20T12:00:01.400000Z", 400.0),
        ("lat_4", "llm_request_start", "2026-04-20T12:00:01.450000Z", 450.0),
        ("lat_5", "llm_first_token", "2026-04-20T12:00:01.700000Z", 700.0),
        ("lat_6", "tts_request_start", "2026-04-20T12:00:01.850000Z", 850.0),
        ("lat_7", "tts_first_byte", "2026-04-20T12:00:02Z", 1000.0),
        ("lat_8", "playback_start", "2026-04-20T12:00:02.050000Z", 1050.0),
        ("lat_9", "turn_completed", "2026-04-20T12:00:02.300000Z", 1300.0),
    ]
    second_turn_events = [
        ("lat_10", "first_user_audio", "2026-04-20T12:01:01Z", 0.0),
        ("lat_11", "first_asr_partial", "2026-04-20T12:01:01.200000Z", 200.0),
        ("lat_12", "final_asr", "2026-04-20T12:01:01.500000Z", 500.0),
        ("lat_13", "llm_request_start", "2026-04-20T12:01:01.550000Z", 550.0),
        ("lat_14", "llm_first_token", "2026-04-20T12:01:01.900000Z", 900.0),
        ("lat_15", "tts_request_start", "2026-04-20T12:01:02Z", 1000.0),
        ("lat_16", "tts_first_byte", "2026-04-20T12:01:02.300000Z", 1300.0),
        ("lat_17", "playback_start", "2026-04-20T12:01:02.450000Z", 1450.0),
        ("lat_18", "turn_completed", "2026-04-20T12:01:02.900000Z", 1900.0),
    ]

    for event_id, stage, started_at, duration_ms in first_turn_events:
        _append_latency(store, session.conversationId, session.id, event_id, stage, started_at, turn_id=turn_one, duration_ms=duration_ms)
    for event_id, stage, started_at, duration_ms in second_turn_events:
        _append_latency(store, session.conversationId, session.id, event_id, stage, started_at, turn_id=turn_two, duration_ms=duration_ms)

    artifact = generate_replay_artifact(store, session.conversationId, session.id)

    assert [turn.turnId for turn in artifact.turnTimings] == [turn_one, turn_two]
    assert artifact.turnTimings[0].status == "complete"
    assert artifact.turnTimings[0].durations.llmFirstTokenMs == 700.0
    assert artifact.turnTimings[1].durations.turnCompletedMs == 1900.0
    assert artifact.rollingMetrics.firstAsrPartial.p50Ms == 150.0
    assert artifact.rollingMetrics.firstAsrPartial.p95Ms == 195.0
    assert artifact.rollingMetrics.turnCompleted.p50Ms == 1600.0
    assert store.load_replay_artifact(session.conversationId, session.id) is not None
    assert store.load_turn_timings(session.conversationId, session.id)[1].turnId == turn_two


def test_timeline_ordering_and_missing_events_are_preserved(tmp_path: Path) -> None:
    store = LocalSessionStore(tmp_path)
    session = store.create_session("conv_partial")
    _append_session_started(store, session.conversationId, session.id, "2026-04-20T13:00:00Z")
    _append_latency(
        store,
        session.conversationId,
        session.id,
        "lat_session",
        "session_start",
        "2026-04-20T13:00:00Z",
        duration_ms=0.0,
    )
    _append_latency(
        store,
        session.conversationId,
        session.id,
        "lat_turn_audio",
        "first_user_audio",
        "2026-04-20T13:00:01Z",
        turn_id="turn_partial",
        duration_ms=0.0,
    )
    _append_latency(
        store,
        session.conversationId,
        session.id,
        "lat_turn_final_asr",
        "final_asr",
        "2026-04-20T13:00:01.400000Z",
        turn_id="turn_partial",
        duration_ms=400.0,
    )
    _append_latency(
        store,
        session.conversationId,
        session.id,
        "lat_turn_llm_start",
        "llm_request_start",
        "2026-04-20T13:00:01.500000Z",
        turn_id="turn_partial",
        duration_ms=500.0,
    )
    store.append_transcript_event(
        TranscriptEventRecord(
            id="evt_user_final",
            conversationId=session.conversationId,
            sessionId=session.id,
            turnId="turn_partial",
            role="user",
            kind="final",
            text="Tell me about event loops",
            createdAt="2026-04-20T13:00:01.400000Z",
        )
    )
    session.status = "ended"
    session.endedAt = "2026-04-20T13:00:03Z"
    store.save_session(session)
    store.append_session_event(
        SessionEventRecord(
            id="evt_session_ended",
            conversationId=session.conversationId,
            sessionId=session.id,
            type="session_ended",
            createdAt="2026-04-20T13:00:03Z",
        )
    )

    artifact = generate_replay_artifact(store, session.conversationId, session.id)
    timeline = build_session_timeline(store, session.conversationId, session.id)

    assert [event.sequence for event in timeline.timeline] == sorted(event.sequence for event in timeline.timeline)
    assert timeline.timeline[0].details == {"type": "session_started"}
    assert artifact.turnTimings[0].status == "partial"
    assert "llm_first_token" in artifact.turnTimings[0].missingStages
    assert "turn_completed" in artifact.turnTimings[0].missingStages
    assert timeline.replayArtifactStatus.available is True


def test_timeline_route_supports_persisted_session_reload(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        create_response = client.post("/api/local/sessions", json={})
        session_id = create_response.json()["session"]["id"]
        end_response = client.post(f"/api/local/sessions/{session_id}/end")
        assert end_response.status_code == 200

        timeline_response = client.get(f"/api/local/sessions/{session_id}/timeline")
        assert timeline_response.status_code == 200
        payload = timeline_response.json()
        assert payload["replayArtifactStatus"]["available"] is True
        assert "timeline" in payload

    with TestClient(app) as client:
        timeline_response = client.get(f"/api/local/sessions/{session_id}/timeline")
        assert timeline_response.status_code == 200
        assert timeline_response.json()["session"]["id"] == session_id


def test_timeline_route_returns_404_for_unknown_session(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        response = client.get("/api/local/sessions/sess_missing/timeline")
        assert response.status_code == 404
