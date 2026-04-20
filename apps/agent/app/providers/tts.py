from __future__ import annotations

from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

from app.providers.base import TtsProvider


class ElevenLabsWebSocketTtsProvider(TtsProvider):
    def __init__(self, *, api_key: str, voice_id: str, sample_rate: int):
        self._api_key = api_key
        self._voice_id = voice_id
        self._sample_rate = sample_rate

    def build(self) -> ElevenLabsTTSService:
        return ElevenLabsTTSService(
            api_key=self._api_key,
            sample_rate=self._sample_rate,
            settings=ElevenLabsTTSService.Settings(
                voice=self._voice_id,
                model="eleven_turbo_v2_5",
            ),
        )
