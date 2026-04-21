from __future__ import annotations

import jwt

from app.auth import SupabaseAuthenticator
from app.config import Settings


def _settings(**overrides: object) -> Settings:
    values = {
        "port": 8000,
        "data_dir": ".",
        "web_allowed_origins": ["http://127.0.0.1:5173"],
        "llm_provider": "openai",
        "llm_model": "gpt-5-nano",
        "llm_system_prompt": "test",
        "openai_api_key": "test-openai",
        "deepgram_api_key": "test-deepgram",
        "elevenlabs_api_key": "test-eleven",
        "elevenlabs_voice_id": "voice-id",
        "supabase_url": "https://example.supabase.co",
        "supabase_anon_key": None,
        "supabase_service_role_key": "service-role",
        "supabase_jwt_secret": "test-jwt-secret",
        "smallwebrtc_ice_servers": ["stun:stun.l.google.com:19302"],
        "input_sample_rate": 16000,
        "output_sample_rate": 24000,
        "session_idle_timeout_secs": 90.0,
        "asr_stall_timeout_secs": 4.0,
        "llm_timeout_secs": 8.0,
        "tts_timeout_secs": 6.0,
        "transport_disconnect_grace_secs": 20.0,
    }
    values.update(overrides)
    return Settings(**values)


def test_supabase_authenticator_accepts_hs256_tokens(monkeypatch) -> None:
    authenticator = SupabaseAuthenticator(_settings())
    token = jwt.encode(
        {"sub": "user_123", "email": "user@example.com"},
        "test-jwt-secret",
        algorithm="HS256",
    )

    user = authenticator.validate(token)

    assert user.id == "user_123"
    assert user.email == "user@example.com"


def test_supabase_authenticator_rejects_hs256_tokens_without_secret() -> None:
    authenticator = SupabaseAuthenticator(_settings(supabase_jwt_secret=None))
    token = jwt.encode({"sub": "user_123"}, "other-secret", algorithm="HS256")

    try:
        authenticator.validate(token)
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("Expected HS256 token validation to fail without SUPABASE_JWT_SECRET")
