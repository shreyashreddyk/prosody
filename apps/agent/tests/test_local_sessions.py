from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models import LatencyEventRecord, SessionEventRecord, TranscriptEventRecord
from app.providers.factory import ProviderFactory
from app.storage.local_store import LocalSessionStore, iso_now


def _configure_env(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PROSODY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-deepgram")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-eleven")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice-id")


def test_create_and_end_local_session(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        create_response = client.post("/api/local/sessions", json={})
        assert create_response.status_code == 200
        payload = create_response.json()
        assert payload["session"]["transportKind"] == "smallwebrtc"
        assert payload["session"]["status"] == "connecting"
        assert payload["offerEndpoint"].endswith(f"/api/local/sessions/{payload['session']['id']}/offer")

        events_response = client.get(f"/api/local/sessions/{payload['session']['id']}/events")
        assert events_response.status_code == 200
        events_payload = events_response.json()
        assert events_payload["latencyEvents"][0]["stage"] == "session_start"
        assert events_payload["sessionEvents"][0]["type"] == "session_started"

        end_response = client.post(f"/api/local/sessions/{payload['session']['id']}/end")
        assert end_response.status_code == 200
        assert end_response.json()["status"] == "ended"


def test_provider_factory_uses_openai_by_default(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)
    settings = Settings.from_env()
    bundle = ProviderFactory(settings).build()
    assert bundle.llm.build().__class__.__name__ == "OpenAILLMService"


def test_provider_factory_rejects_unknown_provider(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "unknown")
    settings = Settings.from_env()
    try:
        ProviderFactory(settings).build()
    except ValueError as exc:
        assert "Unsupported LLM provider" in str(exc)
    else:
        raise AssertionError("Expected ProviderFactory to reject unknown providers")


def test_local_store_persists_events_in_order(tmp_path: Path) -> None:
    store = LocalSessionStore(tmp_path)
    session = store.create_session("conv_test")
    store.append_session_event(
        SessionEventRecord(
            id="evt_1",
            conversationId=session.conversationId,
            sessionId=session.id,
            type="session_started",
            createdAt=iso_now(),
        )
    )
    store.append_transcript_event(
        TranscriptEventRecord(
            id="evt_2",
            conversationId=session.conversationId,
            sessionId=session.id,
            turnId="turn_1",
            role="user",
            kind="partial",
            text="hello",
            createdAt=iso_now(),
        )
    )
    store.append_latency_event(
        LatencyEventRecord(
            id="evt_3",
            conversationId=session.conversationId,
            sessionId=session.id,
            turnId="turn_1",
            stage="session_start",
            startedAt=iso_now(),
            completedAt=iso_now(),
            durationMs=0,
        )
    )

    snapshot = store.load_events(session.conversationId, session.id)
    assert [event.id for event in snapshot.sessionEvents] == ["evt_1"]
    assert [event.id for event in snapshot.transcriptEvents] == ["evt_2"]
    assert [event.id for event in snapshot.latencyEvents] == ["evt_3"]
