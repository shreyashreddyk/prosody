from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings
from app.providers.asr import DeepgramFluxAsrProvider
from app.providers.llm import OpenAiLlmProvider
from app.providers.tts import ElevenLabsWebSocketTtsProvider


@dataclass(slots=True)
class ProviderBundle:
    asr: DeepgramFluxAsrProvider
    llm: OpenAiLlmProvider
    tts: ElevenLabsWebSocketTtsProvider


class ProviderFactory:
    def __init__(self, settings: Settings):
        self._settings = settings

    def build(self) -> ProviderBundle:
        if not self._settings.deepgram_api_key:
            raise ValueError("DEEPGRAM_API_KEY is required for local realtime sessions")
        if not self._settings.elevenlabs_api_key or not self._settings.elevenlabs_voice_id:
            raise ValueError("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required")
        if self._settings.llm_provider != "openai":
            raise ValueError(f"Unsupported LLM provider: {self._settings.llm_provider}")
        if not self._settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required for the OpenAI LLM provider")

        return ProviderBundle(
            asr=DeepgramFluxAsrProvider(
                api_key=self._settings.deepgram_api_key,
                sample_rate=self._settings.input_sample_rate,
            ),
            llm=OpenAiLlmProvider(
                api_key=self._settings.openai_api_key,
                model=self._settings.llm_model,
            ),
            tts=ElevenLabsWebSocketTtsProvider(
                api_key=self._settings.elevenlabs_api_key,
                voice_id=self._settings.elevenlabs_voice_id,
                sample_rate=self._settings.output_sample_rate,
            ),
        )
