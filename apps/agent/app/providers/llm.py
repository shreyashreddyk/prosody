from __future__ import annotations

from pipecat.services.openai.llm import OpenAILLMService

from app.providers.base import LlmProvider


class OpenAiLlmProvider(LlmProvider):
    def __init__(self, *, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def build(self) -> OpenAILLMService:
        return OpenAILLMService(
            api_key=self._api_key,
            settings=OpenAILLMService.Settings(
                model=self._model,
                temperature=0.6,
            ),
        )
