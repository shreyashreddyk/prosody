from __future__ import annotations

import json

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

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


def test_supabase_authenticator_accepts_rs256_tokens_via_httpx_jwks(monkeypatch) -> None:
    authenticator = SupabaseAuthenticator(_settings())
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk["kid"] = "test-kid"
    token = jwt.encode(
        {"sub": "user_rs256", "email": "rsa@example.com"},
        private_key,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )

    class DummyResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"keys": [public_jwk]}

    monkeypatch.setattr(authenticator._client, "get", lambda _url: DummyResponse())

    user = authenticator.validate(token)

    assert user.id == "user_rs256"
    assert user.email == "rsa@example.com"
