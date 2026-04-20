from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class Settings:
    port: int
    data_dir: Path
    llm_provider: str
    llm_model: str
    llm_system_prompt: str
    openai_api_key: str | None
    deepgram_api_key: str | None
    elevenlabs_api_key: str | None
    elevenlabs_voice_id: str | None
    supabase_url: str | None
    supabase_anon_key: str | None
    supabase_service_role_key: str | None
    supabase_jwt_secret: str | None
    smallwebrtc_ice_servers: list[str]
    input_sample_rate: int
    output_sample_rate: int
    session_idle_timeout_secs: float
    asr_stall_timeout_secs: float
    llm_timeout_secs: float
    tts_timeout_secs: float
    transport_disconnect_grace_secs: float

    @classmethod
    def from_env(cls) -> "Settings":
        ice_servers = os.getenv("SMALLWEBRTC_ICE_SERVERS", "stun:stun.l.google.com:19302")
        return cls(
            port=int(os.getenv("PORT", "8000")),
            data_dir=Path(os.getenv("PROSODY_DATA_DIR", ".prosody-data")).resolve(),
            llm_provider=os.getenv("LLM_PROVIDER", "openai").strip().lower(),
            llm_model=os.getenv("LLM_MODEL", "gpt-4o-mini").strip(),
            llm_system_prompt=os.getenv(
                "LLM_SYSTEM_PROMPT",
                (
                    "You are Prosody, a concise realtime interview and presentation coach. "
                    "Respond with practical spoken coaching, keep answers short, and prioritize "
                    "clarity, confidence, and pacing."
                ),
            ).strip(),
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            deepgram_api_key=os.getenv("DEEPGRAM_API_KEY"),
            elevenlabs_api_key=os.getenv("ELEVENLABS_API_KEY"),
            elevenlabs_voice_id=os.getenv("ELEVENLABS_VOICE_ID"),
            supabase_url=os.getenv("SUPABASE_URL"),
            supabase_anon_key=os.getenv("SUPABASE_ANON_KEY"),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
            supabase_jwt_secret=os.getenv("SUPABASE_JWT_SECRET"),
            smallwebrtc_ice_servers=[item.strip() for item in ice_servers.split(",") if item.strip()],
            input_sample_rate=int(os.getenv("AUDIO_INPUT_SAMPLE_RATE", "16000")),
            output_sample_rate=int(os.getenv("AUDIO_OUTPUT_SAMPLE_RATE", "24000")),
            session_idle_timeout_secs=float(os.getenv("SESSION_IDLE_TIMEOUT_SECS", "90")),
            asr_stall_timeout_secs=float(os.getenv("ASR_STALL_TIMEOUT_SECS", "4")),
            llm_timeout_secs=float(os.getenv("LLM_TIMEOUT_SECS", "8")),
            tts_timeout_secs=float(os.getenv("TTS_TIMEOUT_SECS", "6")),
            transport_disconnect_grace_secs=float(os.getenv("TRANSPORT_DISCONNECT_GRACE_SECS", "20")),
        )
