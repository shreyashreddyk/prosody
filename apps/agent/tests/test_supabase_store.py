from __future__ import annotations

from collections import defaultdict
import uuid

from app.models import DegradationEventRecord, LatencyEventRecord
from app.storage.supabase_store import SupabaseSessionStore


def _build_store() -> SupabaseSessionStore:
    store = object.__new__(SupabaseSessionStore)
    store._latency_sequence = defaultdict(int)
    return store


def test_create_session_falls_back_to_live_status_when_connecting_is_rejected() -> None:
    store = _build_store()
    captured_payloads: list[dict] = []

    def fake_post(table: str, payload: dict) -> None:
        assert table == "sessions"
        captured_payloads.append(payload)
        if payload["status"] == "connecting":
            raise RuntimeError("Supabase insert failed for sessions: new row violates check constraint sessions_status_check")

    store._post = fake_post
    store._touch_conversation = lambda _conversation_id: None

    session = store.create_session(conversation_id="conv_test", owner_user_id="user_test")

    assert session.status == "connecting"
    assert any(payload["status"] == "live" for payload in captured_payloads)


def test_append_latency_event_falls_back_to_canonical_columns_when_legacy_shape_is_missing() -> None:
    store = _build_store()
    captured_payloads: list[dict] = []
    store._session_owner_id = lambda _session_id: "user_test"
    store._get = lambda _table, *, params: []

    def fake_post(table: str, payload: dict) -> None:
        assert table == "latency_events"
        captured_payloads.append(payload)
        if "name" in payload:
            raise RuntimeError("Supabase insert failed for latency_events: Could not find the 'name' column")

    store._post = fake_post

    event = LatencyEventRecord(
        id=str(uuid.uuid4()),
        conversationId="conv_test",
        sessionId="sess_test",
        stage="session_start",
        startedAt="2026-04-20T15:00:00Z",
        completedAt="2026-04-20T15:00:00Z",
        durationMs=0.0,
    )

    store.append_latency_event(event)

    assert captured_payloads[0]["name"] == "session_start"
    assert captured_payloads[1]["stage"] == "session_start"
    assert captured_payloads[1]["started_at"] == event.startedAt


def test_append_degradation_event_falls_back_to_canonical_columns_when_legacy_shape_is_missing() -> None:
    store = _build_store()
    captured_payloads: list[dict] = []
    store._session_owner_id = lambda _session_id: "user_test"

    def fake_post(table: str, payload: dict) -> None:
        assert table == "degradation_events"
        captured_payloads.append(payload)
        if "reason" in payload:
            raise RuntimeError("Supabase insert failed for degradation_events: Could not find the 'reason' column")

    store._post = fake_post

    event = DegradationEventRecord(
        id=str(uuid.uuid4()),
        conversationId="conv_test",
        sessionId="sess_test",
        turnId="turn_test",
        category="provider",
        severity="warning",
        provider="tts",
        code="tts_timeout",
        message="Timed out",
        details={"timeoutSeconds": 6},
        createdAt="2026-04-20T15:05:00Z",
    )

    store.append_degradation_event(event)

    assert captured_payloads[0]["reason"] == "provider"
    assert captured_payloads[1]["category"] == "provider"
    assert captured_payloads[1]["created_at"] == event.createdAt
    assert captured_payloads[1]["provider"] == "tts"


def test_append_degradation_event_falls_back_when_provider_column_is_missing() -> None:
    store = _build_store()
    captured_payloads: list[dict] = []
    store._session_owner_id = lambda _session_id: "user_test"

    def fake_post(table: str, payload: dict) -> None:
        assert table == "degradation_events"
        captured_payloads.append(payload)
        if "provider" in payload:
            raise RuntimeError("Supabase insert failed for degradation_events: Could not find the 'provider' column")

    store._post = fake_post

    event = DegradationEventRecord(
        id=str(uuid.uuid4()),
        conversationId="conv_test",
        sessionId="sess_test",
        turnId="turn_test",
        category="transport",
        severity="warning",
        provider="transport",
        code="no_inbound_audio",
        message="No inbound audio arrived",
        details={"watchdogSeconds": 5},
        createdAt="2026-04-21T15:05:00Z",
    )

    store.append_degradation_event(event)

    assert "provider" in captured_payloads[0]
    assert "provider" in captured_payloads[1]
    providerless_payloads = [payload for payload in captured_payloads if "provider" not in payload]
    assert providerless_payloads
    assert providerless_payloads[0]["reason"] == "transport"


def test_append_degradation_event_falls_back_to_legacy_minimal_shape() -> None:
    store = _build_store()
    captured_payloads: list[dict] = []
    store._session_owner_id = lambda _session_id: "user_test"

    def fake_post(table: str, payload: dict) -> None:
        assert table == "degradation_events"
        captured_payloads.append(payload)
        disallowed_keys = {"turn_id", "provider", "code", "details", "category", "created_at", "recovered_at"}
        present_disallowed = disallowed_keys.intersection(payload)
        if present_disallowed:
            missing_key = sorted(present_disallowed)[0]
            raise RuntimeError(f"Supabase insert failed for degradation_events: Could not find the '{missing_key}' column")

    store._post = fake_post

    event = DegradationEventRecord(
        id=str(uuid.uuid4()),
        conversationId="conv_test",
        sessionId="sess_test",
        turnId=None,
        category="transport",
        severity="warning",
        provider="transport",
        code="no_inbound_audio",
        message="No inbound audio arrived",
        details={"watchdogSeconds": 5},
        createdAt="2026-04-21T15:05:00Z",
    )

    store.append_degradation_event(event)

    assert captured_payloads[-1] == {
        "id": event.id,
        "conversation_id": "conv_test",
        "session_id": "sess_test",
        "owner_user_id": "user_test",
        "severity": "warning",
        "message": "No inbound audio arrived",
        "reason": "transport",
        "timestamp": "2026-04-21T15:05:00Z",
        "recovery": None,
    }


def test_recover_degradation_event_falls_back_to_canonical_column_when_legacy_shape_is_missing() -> None:
    store = _build_store()
    captured_payloads: list[dict] = []

    def fake_patch(table: str, payload: dict, filters: dict[str, str]) -> None:
        assert table == "degradation_events"
        assert filters["id"] == "eq.event_test"
        captured_payloads.append(payload)
        if "recovery" in payload:
            raise RuntimeError("Supabase update failed for degradation_events: Could not find the 'recovery' column")

    store._patch = fake_patch

    store.recover_degradation_event(
        conversation_id="conv_test",
        session_id="sess_test",
        event_id="event_test",
        recovered_at="2026-04-20T15:06:00Z",
    )

    assert captured_payloads[0] == {"recovery": "2026-04-20T15:06:00Z"}
    assert captured_payloads[1] == {"recovered_at": "2026-04-20T15:06:00Z"}
