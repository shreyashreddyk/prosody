from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.config import Settings
from app.main import app
from app.models import AuthenticatedUser, LatencyEventRecord, SessionEventRecord, TranscriptEventRecord
from app.providers.factory import ProviderFactory
from app.storage.local_store import LocalSessionStore, iso_now


def _configure_env(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PROSODY_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-deepgram")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-eleven")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice-id")


def _override_user() -> AuthenticatedUser:
    return AuthenticatedUser(id="user_test", email="user@example.com")


def test_create_and_end_local_session_requires_auth_and_persists_events(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
      seed = client.app.state.store.create_session("conv_auth")
      client.app.dependency_overrides[get_current_user] = _override_user

      create_response = client.post("/api/local/sessions", json={"conversation_id": seed.conversationId})
      assert create_response.status_code == 200
      payload = create_response.json()
      assert payload["session"]["transportKind"] == "smallwebrtc"
      assert payload["session"]["status"] == "connecting"

      events_response = client.get(f"/api/local/sessions/{payload['session']['id']}/events")
      assert events_response.status_code == 200
      events_payload = events_response.json()
      assert events_payload["latencyEvents"][0]["stage"] == "session_start"
      uuid.UUID(events_payload["latencyEvents"][0]["id"])
      assert events_payload["sessionEvents"][0]["type"] == "session_started"

      end_response = client.post(f"/api/local/sessions/{payload['session']['id']}/end")
      assert end_response.status_code == 200
      assert end_response.json()["status"] == "ended"

      client.app.dependency_overrides.clear()


def test_local_session_routes_reject_missing_auth(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        response = client.post("/api/local/sessions", json={"conversation_id": "conv_missing"})
    assert response.status_code == 401


def test_local_session_create_route_handles_allowed_cors_preflight(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        response = client.options(
            "/api/local/sessions",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert "POST" in response.headers["access-control-allow-methods"]
    allow_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allow_headers
    assert "content-type" in allow_headers


def test_local_session_offer_route_handles_allowed_cors_preflight(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        seed = client.app.state.store.create_session("conv_offer")
        client.app.dependency_overrides[get_current_user] = _override_user
        create_response = client.post("/api/local/sessions", json={"conversation_id": seed.conversationId})
        session_id = create_response.json()["session"]["id"]

        response = client.options(
            f"/api/local/sessions/{session_id}/offer",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
        assert "POST" in response.headers["access-control-allow-methods"]
        assert "content-type" in response.headers["access-control-allow-headers"].lower()
        client.app.dependency_overrides.clear()


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


def test_ending_session_without_audio_emits_classification_log(tmp_path: Path, monkeypatch, capsys, caplog) -> None:
    _configure_env(tmp_path, monkeypatch)
    caplog.set_level(logging.INFO)

    with TestClient(app) as client:
        seed = client.app.state.store.create_session("conv_diag")
        client.app.dependency_overrides[get_current_user] = _override_user

        create_response = client.post("/api/local/sessions", json={"conversation_id": seed.conversationId})
        session_id = create_response.json()["session"]["id"]

        end_response = client.post(f"/api/local/sessions/{session_id}/end")
        assert end_response.status_code == 200

        stderr_output = capsys.readouterr().err
        assert "session-ended-without-inbound-audio" in stderr_output
        assert session_id in stderr_output
        client.app.dependency_overrides.clear()


def test_session_logging_excludes_sensitive_headers(tmp_path: Path, monkeypatch, caplog) -> None:
    _configure_env(tmp_path, monkeypatch)
    caplog.set_level(logging.INFO)

    with TestClient(app) as client:
        seed = client.app.state.store.create_session("conv_logging")
        client.app.dependency_overrides[get_current_user] = _override_user

        response = client.post("/api/local/sessions", json={"conversation_id": seed.conversationId})
        assert response.status_code == 200

        assert "authorization" not in caplog.text.lower()
        assert "bearer " not in caplog.text.lower()
        assert "sdp" not in caplog.text.lower()
        client.app.dependency_overrides.clear()
