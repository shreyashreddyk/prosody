from __future__ import annotations

from typing import Protocol


class AsrProvider(Protocol):
    def build(self):
        ...


class LlmProvider(Protocol):
    def build(self):
        ...


class TtsProvider(Protocol):
    def build(self):
        ...
