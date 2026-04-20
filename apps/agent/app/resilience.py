from __future__ import annotations

import asyncio
import inspect
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable

from app.models import DegradationEventRecord, SessionRecord
from app.storage.base import SessionStore
from app.storage.local_store import iso_now


FallbackCallback = Callable[[str, DegradationEventRecord], Awaitable[None] | None]
DisconnectExpiryCallback = Callable[[], Awaitable[None] | None]


@dataclass(slots=True)
class ResiliencePolicy:
    asr_stall_timeout_secs: float
    llm_timeout_secs: float
    tts_timeout_secs: float
    transport_disconnect_grace_secs: float


class SessionResilienceCoordinator:
    def __init__(
        self,
        *,
        policy: ResiliencePolicy,
        store: SessionStore,
        session: SessionRecord,
        on_asr_timeout: FallbackCallback,
        on_llm_timeout: FallbackCallback,
        on_tts_timeout: FallbackCallback,
        on_disconnect_expired: DisconnectExpiryCallback,
    ):
        self._policy = policy
        self._store = store
        self._session = session
        self._on_asr_timeout = on_asr_timeout
        self._on_llm_timeout = on_llm_timeout
        self._on_tts_timeout = on_tts_timeout
        self._on_disconnect_expired = on_disconnect_expired
        self._turn_timers: dict[tuple[str, str], asyncio.Task] = {}
        self._disconnect_task: asyncio.Task | None = None
        self._transport_disconnect_event_id: str | None = None

    @property
    def transport_disconnect_event_id(self) -> str | None:
        return self._transport_disconnect_event_id

    def set_callbacks(
        self,
        *,
        on_asr_timeout: FallbackCallback,
        on_llm_timeout: FallbackCallback,
        on_tts_timeout: FallbackCallback,
        on_disconnect_expired: DisconnectExpiryCallback,
    ) -> None:
        self._on_asr_timeout = on_asr_timeout
        self._on_llm_timeout = on_llm_timeout
        self._on_tts_timeout = on_tts_timeout
        self._on_disconnect_expired = on_disconnect_expired

    def close(self) -> None:
        for task in list(self._turn_timers.values()):
            task.cancel()
        self._turn_timers.clear()
        if self._disconnect_task:
            self._disconnect_task.cancel()
            self._disconnect_task = None

    def on_first_user_audio(self, turn_id: str) -> None:
        self._arm_turn_timer(
            "asr",
            turn_id,
            self._policy.asr_stall_timeout_secs,
            self._handle_asr_timeout,
        )

    def on_asr_partial(self, turn_id: str) -> None:
        self._cancel_turn_timer("asr", turn_id)

    def on_final_asr(self, turn_id: str) -> None:
        self._cancel_turn_timer("asr", turn_id)

    def on_llm_request_start(self, turn_id: str) -> None:
        self._arm_turn_timer(
            "llm",
            turn_id,
            self._policy.llm_timeout_secs,
            self._handle_llm_timeout,
        )

    def on_llm_first_token(self, turn_id: str) -> None:
        self._cancel_turn_timer("llm", turn_id)

    def on_tts_request_start(self, turn_id: str) -> None:
        self._arm_turn_timer(
            "tts",
            turn_id,
            self._policy.tts_timeout_secs,
            self._handle_tts_timeout,
        )

    def on_tts_first_byte(self, turn_id: str) -> None:
        self._cancel_turn_timer("tts", turn_id)

    def on_turn_finished(self, turn_id: str) -> None:
        self._cancel_turn_timer("asr", turn_id)
        self._cancel_turn_timer("llm", turn_id)
        self._cancel_turn_timer("tts", turn_id)

    def on_transport_disconnected(self) -> None:
        if self._disconnect_task and not self._disconnect_task.done():
            return

        created_at = iso_now()
        event = self._append_degradation(
            turn_id=None,
            category="transport",
            severity="warning",
            provider="transport",
            code="transport_disconnect",
            message="Transport disconnected. Waiting for reconnect.",
            details={"graceSeconds": self._policy.transport_disconnect_grace_secs},
            created_at=created_at,
        )
        self._transport_disconnect_event_id = event.id
        self._disconnect_task = asyncio.create_task(self._run_disconnect_grace_window())

    def on_transport_resumed(self) -> None:
        if self._disconnect_task:
            self._disconnect_task.cancel()
            self._disconnect_task = None
        if self._transport_disconnect_event_id:
            self._store.recover_degradation_event(
                self._session.conversationId,
                self._session.id,
                self._transport_disconnect_event_id,
                iso_now(),
            )
            self._transport_disconnect_event_id = None

    def _arm_turn_timer(
        self,
        phase: str,
        turn_id: str,
        timeout_secs: float,
        handler: Callable[[str], Awaitable[None]],
    ) -> None:
        self._cancel_turn_timer(phase, turn_id)
        self._turn_timers[(phase, turn_id)] = asyncio.create_task(self._run_turn_timeout(phase, turn_id, timeout_secs, handler))

    def _cancel_turn_timer(self, phase: str, turn_id: str) -> None:
        task = self._turn_timers.pop((phase, turn_id), None)
        if task:
            task.cancel()

    async def _run_turn_timeout(
        self,
        phase: str,
        turn_id: str,
        timeout_secs: float,
        handler: Callable[[str], Awaitable[None]],
    ) -> None:
        try:
            await asyncio.sleep(timeout_secs)
            if (phase, turn_id) not in self._turn_timers:
                return
            await handler(turn_id)
        except asyncio.CancelledError:
            return
        finally:
            self._turn_timers.pop((phase, turn_id), None)

    async def _run_disconnect_grace_window(self) -> None:
        try:
            await asyncio.sleep(self._policy.transport_disconnect_grace_secs)
            await self._maybe_await(self._on_disconnect_expired())
        except asyncio.CancelledError:
            return
        finally:
            self._disconnect_task = None

    async def _handle_asr_timeout(self, turn_id: str) -> None:
        event = self._append_degradation(
            turn_id=turn_id,
            category="provider",
            severity="warning",
            provider="asr",
            code="asr_stall",
            message="ASR stalled before a partial transcript arrived.",
            details={"timeoutSeconds": self._policy.asr_stall_timeout_secs, "fallbackMode": "repeat_prompt"},
        )
        await self._maybe_await(self._on_asr_timeout(turn_id, event))

    async def _handle_llm_timeout(self, turn_id: str) -> None:
        event = self._append_degradation(
            turn_id=turn_id,
            category="provider",
            severity="critical",
            provider="llm",
            code="llm_timeout",
            message="LLM timed out before the first token arrived.",
            details={"timeoutSeconds": self._policy.llm_timeout_secs, "fallbackMode": "short_response"},
        )
        await self._maybe_await(self._on_llm_timeout(turn_id, event))

    async def _handle_tts_timeout(self, turn_id: str) -> None:
        event = self._append_degradation(
            turn_id=turn_id,
            category="provider",
            severity="warning",
            provider="tts",
            code="tts_timeout",
            message="TTS timed out before audio playback started.",
            details={"timeoutSeconds": self._policy.tts_timeout_secs, "fallbackMode": "text_only"},
        )
        await self._maybe_await(self._on_tts_timeout(turn_id, event))

    def _append_degradation(
        self,
        *,
        turn_id: str | None,
        category: str,
        severity: str,
        provider: str | None,
        code: str,
        message: str,
        details: dict[str, str | int | float | bool | None] | None = None,
        created_at: str | None = None,
    ) -> DegradationEventRecord:
        event = DegradationEventRecord(
            id=f"deg_{uuid.uuid4().hex[:12]}",
            conversationId=self._session.conversationId,
            sessionId=self._session.id,
            turnId=turn_id,
            category=category,
            severity=severity,
            provider=provider,
            code=code,
            message=message,
            details=details,
            createdAt=created_at or iso_now(),
        )
        self._store.append_degradation_event(event)
        return event

    async def _maybe_await(self, result) -> None:
        if inspect.isawaitable(result):
            await result
