from __future__ import annotations

from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.transcriptions.language import Language

from app.providers.base import AsrProvider


class DeepgramFluxAsrProvider(AsrProvider):
    def __init__(self, *, api_key: str, sample_rate: int):
        self._api_key = api_key
        self._sample_rate = sample_rate

    def build(self) -> DeepgramFluxSTTService:
        return DeepgramFluxSTTService(
            api_key=self._api_key,
            sample_rate=self._sample_rate,
            settings=DeepgramFluxSTTService.Settings(
                model="flux-general-en",
                language=Language.EN,
                min_confidence=0.0,
            ),
        )
