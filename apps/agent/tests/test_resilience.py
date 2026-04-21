from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from pipecat.frames.frames import InputAudioRawFrame, LLMFullResponseStartFrame, LLMTextFrame, TTSStartedFrame, TranscriptionFrame

from app.auth import get_current_user
from app.main import app
from app.metrics.latency import LatencyRecorder
from app.models import AuthenticatedUser
from app.orchestrator.pipeline import SessionObserver
from app.resilience import ResiliencePolicy, SessionResilienceCoordinator
from app.storage.local_store import LocalSessionStore


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


def _build_observer(tmp_path: Path):
    store = LocalSessionStore(tmp_path)
    session = store.create_session("conv_resilience")
    policy = ResiliencePolicy(
        asr_stall_timeout_secs=0.01,
        llm_timeout_secs=0.01,
        tts_timeout_secs=0.01,
        transport_disconnect_grace_secs=0.02,
    )
    coordinator = SessionResilienceCoordinator(
        policy=policy,
        store=store,
        session=session,
        on_asr_timeout=lambda _turn_id, _event: None,
        on_llm_timeout=lambda _turn_id, _event: None,
        on_tts_timeout=lambda _turn_id, _event: None,
        on_disconnect_expired=lambda: None,
    )
    observer = SessionObserver(
        store=store,
        latency=LatencyRecorder(store, session.conversationId, session.id),
        conversation_id=session.conversationId,
        session_id=session.id,
        resilience=coordinator,
    )
    coordinator.set_callbacks(
        on_asr_timeout=observer.handle_asr_timeout,
        on_llm_timeout=observer.handle_llm_timeout,
        on_tts_timeout=observer.handle_tts_timeout,
        on_disconnect_expired=lambda: None,
    )
    return store, session, coordinator, observer


def test_local_store_persists_and_recovers_degradation_events(tmp_path: Path) -> None:
    store, session, coordinator, _observer = _build_observer(tmp_path)

    async def run_case():
        coordinator.on_transport_disconnected()
        await asyncio.sleep(0)
        degradation_events = store.load_degradation_events(session.conversationId, session.id)
        assert degradation_events[0].code == "transport_disconnect"
        assert degradation_events[0].recoveredAt is None

        coordinator.on_transport_resumed()
        recovered = store.load_degradation_events(session.conversationId, session.id)
        assert recovered[0].recoveredAt is not None

    asyncio.run(run_case())


def test_asr_stall_timeout_persists_event_and_repeat_prompt(tmp_path: Path) -> None:
    store, session, _coordinator, observer = _build_observer(tmp_path)

    async def run_case():
        await observer.on_push_frame(SimpleNamespace(frame=InputAudioRawFrame(b"\x00\x00", 16000, 1)))
        await asyncio.sleep(0.03)

    asyncio.run(run_case())

    snapshot = store.load_events(session.conversationId, session.id)
    degradation_events = store.load_degradation_events(session.conversationId, session.id)
    assert degradation_events[0].code == "asr_stall"
    assert snapshot.turns[0].assistantText == "I didn't catch that. Please repeat that answer."
    assert snapshot.turns[0].completedAt is not None


def test_llm_timeout_persists_event_and_short_fallback_response(tmp_path: Path) -> None:
    store, session, _coordinator, observer = _build_observer(tmp_path)

    async def run_case():
        await observer.on_push_frame(SimpleNamespace(frame=InputAudioRawFrame(b"\x00\x00", 16000, 1)))
        await observer.on_push_frame(
            SimpleNamespace(frame=TranscriptionFrame("hello", "user", "2026-04-20T12:00:01Z"))
        )
        await observer.on_push_frame(SimpleNamespace(frame=LLMFullResponseStartFrame()))
        await asyncio.sleep(0.03)

    asyncio.run(run_case())

    snapshot = store.load_events(session.conversationId, session.id)
    degradation_events = store.load_degradation_events(session.conversationId, session.id)
    assert degradation_events[0].code == "llm_timeout"
    assert snapshot.turns[0].assistantText == "I'm having trouble responding fully right now. Give me one more try."


def test_tts_timeout_persists_text_only_fallback(tmp_path: Path) -> None:
    store, session, _coordinator, observer = _build_observer(tmp_path)

    async def run_case():
        await observer.on_push_frame(SimpleNamespace(frame=InputAudioRawFrame(b"\x00\x00", 16000, 1)))
        await observer.on_push_frame(
            SimpleNamespace(frame=TranscriptionFrame("hello", "user", "2026-04-20T12:00:01Z"))
        )
        await observer.on_push_frame(SimpleNamespace(frame=LLMFullResponseStartFrame()))
        await observer.on_push_frame(SimpleNamespace(frame=LLMTextFrame("Short answer.")))
        await observer.on_push_frame(SimpleNamespace(frame=TTSStartedFrame()))
        await asyncio.sleep(0.03)

    asyncio.run(run_case())

    snapshot = store.load_events(session.conversationId, session.id)
    degradation_events = store.load_degradation_events(session.conversationId, session.id)
    assert degradation_events[0].code == "tts_timeout"
    assert degradation_events[0].details == {"timeoutSeconds": 0.01, "fallbackMode": "text_only"}
    assert snapshot.turns[0].assistantText == "Short answer."


def test_resume_route_rejects_sessions_that_are_not_reconnecting(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        seed = client.app.state.store.create_session("conv_resume")
        client.app.dependency_overrides[get_current_user] = _override_user

        create_response = client.post("/api/local/sessions", json={"conversation_id": seed.conversationId})
        session_id = create_response.json()["session"]["id"]
        response = client.post(f"/api/local/sessions/{session_id}/resume")

        assert response.status_code == 409
        client.app.dependency_overrides.clear()


def test_transport_disconnect_resume_and_expiry_are_persisted(tmp_path: Path, monkeypatch) -> None:
    _configure_env(tmp_path, monkeypatch)

    with TestClient(app) as client:
        seed = client.app.state.store.create_session("conv_transport")
        client.app.dependency_overrides[get_current_user] = _override_user

        create_response = client.post("/api/local/sessions", json={"conversation_id": seed.conversationId})
        session_id = create_response.json()["session"]["id"]
        manager = client.app.state.session_manager
        realtime = manager._require_session(session_id)

        asyncio.run(manager._on_transport_disconnected(realtime))
        reconnect_response = client.post(f"/api/local/sessions/{session_id}/resume")
        assert reconnect_response.status_code == 200
        assert reconnect_response.json()["session"]["status"] == "reconnecting"

        asyncio.run(manager._on_transport_connected(realtime))
        degradation_events = client.app.state.store.load_degradation_events(realtime.session.conversationId, realtime.session.id)
        assert degradation_events[0].recoveredAt is not None

        asyncio.run(manager._on_transport_disconnected(realtime))
        asyncio.run(manager._expire_reconnect(realtime))
        snapshot = client.app.state.store.load_events(realtime.session.conversationId, realtime.session.id)
        assert snapshot.session.status == "failed"
        assert snapshot.sessionEvents[-1].type == "transport_failed"
        client.app.dependency_overrides.clear()


def test_latency_and_degradation_events_use_uuid_ids(tmp_path: Path) -> None:
    store, session, coordinator, observer = _build_observer(tmp_path)

    async def run_case():
        await observer.on_push_frame(SimpleNamespace(frame=InputAudioRawFrame(b"\x00\x00", 16000, 1)))
        coordinator.on_transport_disconnected()
        await asyncio.sleep(0)

    asyncio.run(run_case())

    snapshot = store.load_events(session.conversationId, session.id)
    degradation_events = store.load_degradation_events(session.conversationId, session.id)
    uuid.UUID(snapshot.latencyEvents[0].id)
    uuid.UUID(degradation_events[0].id)
