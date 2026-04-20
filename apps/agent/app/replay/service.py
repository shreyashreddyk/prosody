from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from app.metrics.latency import iso_now, parse_iso
from app.models import (
    DegradationEventRecord,
    LatencyEventRecord,
    ReplayArtifactRecord,
    RollingLatencyMetricsRecord,
    RollingMetricStatRecord,
    SessionEventRecord,
    SessionTimelineEventRecord,
    SessionTimelineResponse,
    TranscriptEventRecord,
    TurnLatencySummaryRecord,
    TurnTimingRecord,
)
from app.storage.base import SessionStore
from app.storage.local_store import normalize_latency_stage


TURN_STAGE_TO_ATTR = {
    "first_user_audio": "firstUserAudioAt",
    "first_asr_partial": "firstAsrPartialAt",
    "final_asr": "finalAsrAt",
    "llm_request_start": "llmRequestStartAt",
    "llm_first_token": "llmFirstTokenAt",
    "tts_request_start": "ttsRequestStartAt",
    "tts_first_byte": "ttsFirstByteAt",
    "playback_start": "playbackStartAt",
    "turn_completed": "turnCompletedAt",
}

TURN_STAGE_TO_DURATION = {
    "first_asr_partial": "firstAsrPartialMs",
    "final_asr": "finalAsrMs",
    "llm_first_token": "llmFirstTokenMs",
    "tts_first_byte": "ttsFirstByteMs",
    "playback_start": "playbackStartMs",
    "turn_completed": "turnCompletedMs",
}

REQUIRED_TURN_STAGES = [
    "first_asr_partial",
    "final_asr",
    "llm_request_start",
    "llm_first_token",
    "tts_request_start",
    "tts_first_byte",
    "playback_start",
    "turn_completed",
]


@dataclass
class SessionArtifacts:
    timeline: list[SessionTimelineEventRecord]
    turn_timings: list[TurnTimingRecord]
    rolling_metrics: RollingLatencyMetricsRecord


def build_session_timeline(
    store: SessionStore,
    conversation_id: str,
    session_id: str,
) -> SessionTimelineResponse:
    snapshot = store.load_events(conversation_id, session_id)
    degradation_events = store.load_degradation_events(conversation_id, session_id)
    raw_timeline = store.load_timeline_events(conversation_id, session_id)
    artifacts = _build_artifacts(
        snapshot.sessionEvents,
        snapshot.transcriptEvents,
        snapshot.latencyEvents,
        degradation_events,
        raw_timeline,
        snapshot.session.status,
        snapshot.session.endedAt,
    )
    replay_status = store.replay_artifact_status(conversation_id, session_id)
    return SessionTimelineResponse(
        session=snapshot.session,
        timeline=artifacts.timeline,
        turnTimings=artifacts.turn_timings,
        rollingMetrics=artifacts.rolling_metrics,
        degradationEvents=degradation_events,
        replayArtifactStatus=replay_status,
    )


def generate_replay_artifact(
    store: SessionStore,
    conversation_id: str,
    session_id: str,
) -> ReplayArtifactRecord:
    snapshot = store.load_events(conversation_id, session_id)
    degradation_events = store.load_degradation_events(conversation_id, session_id)
    raw_timeline = store.load_timeline_events(conversation_id, session_id)
    artifacts = _build_artifacts(
        snapshot.sessionEvents,
        snapshot.transcriptEvents,
        snapshot.latencyEvents,
        degradation_events,
        raw_timeline,
        snapshot.session.status,
        snapshot.session.endedAt,
    )
    store.save_turn_timings(conversation_id, session_id, artifacts.turn_timings)
    artifact = ReplayArtifactRecord(
        schemaVersion="prosody.replay.v2",
        generatedAt=iso_now(),
        session=snapshot.session,
        transcript=sorted(snapshot.transcriptEvents, key=lambda item: (item.createdAt, item.id)),
        timeline=artifacts.timeline,
        turnTimings=artifacts.turn_timings,
        rollingMetrics=artifacts.rolling_metrics,
        degradationEvents=degradation_events,
        notes=["playback_start is approximated from the first outbound assistant audio frame in local mode."],
    )
    store.save_replay_artifact(conversation_id, session_id, artifact)
    return artifact


def _build_artifacts(
    session_events: list[SessionEventRecord],
    transcript_events: list[TranscriptEventRecord],
    latency_events: list[LatencyEventRecord],
    degradation_events: list[DegradationEventRecord],
    raw_timeline: list[SessionTimelineEventRecord],
    session_status: str,
    session_ended_at: str | None,
) -> SessionArtifacts:
    timeline = _normalized_timeline(session_events, transcript_events, latency_events, degradation_events, raw_timeline)
    turn_timings = _build_turn_timings(transcript_events, latency_events, session_events, session_status, session_ended_at)
    rolling_metrics = _build_rolling_metrics(turn_timings)
    return SessionArtifacts(
        timeline=timeline,
        turn_timings=turn_timings,
        rolling_metrics=rolling_metrics,
    )


def _normalized_timeline(
    session_events: list[SessionEventRecord],
    transcript_events: list[TranscriptEventRecord],
    latency_events: list[LatencyEventRecord],
    degradation_events: list[DegradationEventRecord],
    raw_timeline: list[SessionTimelineEventRecord],
) -> list[SessionTimelineEventRecord]:
    if raw_timeline:
        normalized = [
            event.model_copy(update={"stage": normalize_latency_stage(event.stage) if event.stage else None})
            for event in raw_timeline
        ]
        existing_ids = {event.id for event in normalized}
        sequence = max((event.sequence for event in normalized), default=0) + 1
        for event in sorted(degradation_events, key=lambda item: (item.createdAt, item.id)):
            if event.id in existing_ids:
                continue
            normalized.append(
                SessionTimelineEventRecord(
                    id=event.id,
                    conversationId=event.conversationId,
                    sessionId=event.sessionId,
                    turnId=event.turnId,
                    kind="degradation",
                    createdAt=event.createdAt,
                    sequence=sequence,
                    details={
                        "category": event.category,
                        "severity": event.severity,
                        "provider": event.provider,
                        "code": event.code,
                        "message": event.message,
                        "recoveredAt": event.recoveredAt,
                        **(event.details or {}),
                    },
                )
            )
            sequence += 1
        return sorted(normalized, key=lambda item: (item.sequence, item.createdAt, item.id))

    derived: list[SessionTimelineEventRecord] = []
    sequence = 1
    for event in sorted(session_events, key=lambda item: (item.createdAt, item.id)):
        derived.append(
            SessionTimelineEventRecord(
                id=event.id,
                conversationId=event.conversationId,
                sessionId=event.sessionId,
                kind="session",
                createdAt=event.createdAt,
                sequence=sequence,
                details={"type": event.type, **(event.details or {})},
            )
        )
        sequence += 1
    for event in sorted(transcript_events, key=lambda item: (item.createdAt, item.id)):
        derived.append(
            SessionTimelineEventRecord(
                id=event.id,
                conversationId=event.conversationId,
                sessionId=event.sessionId,
                turnId=event.turnId,
                kind="transcript",
                createdAt=event.createdAt,
                sequence=sequence,
                details={"role": event.role, "kind": event.kind, "text": event.text},
            )
        )
        sequence += 1
    for event in sorted(latency_events, key=lambda item: (item.startedAt, item.id)):
        derived.append(
            SessionTimelineEventRecord(
                id=event.id,
                conversationId=event.conversationId,
                sessionId=event.sessionId,
                turnId=event.turnId,
                kind="latency",
                stage=normalize_latency_stage(event.stage),
                createdAt=event.startedAt,
                sequence=sequence,
                details={"durationMs": event.durationMs},
            )
        )
        sequence += 1
    for event in sorted(degradation_events, key=lambda item: (item.createdAt, item.id)):
        derived.append(
            SessionTimelineEventRecord(
                id=event.id,
                conversationId=event.conversationId,
                sessionId=event.sessionId,
                turnId=event.turnId,
                kind="degradation",
                createdAt=event.createdAt,
                sequence=sequence,
                details={
                    "category": event.category,
                    "severity": event.severity,
                    "provider": event.provider,
                    "code": event.code,
                    "message": event.message,
                    "recoveredAt": event.recoveredAt,
                    **(event.details or {}),
                },
            )
        )
        sequence += 1
    return sorted(derived, key=lambda item: (item.sequence, item.createdAt, item.id))


def _build_turn_timings(
    transcript_events: list[TranscriptEventRecord],
    latency_events: list[LatencyEventRecord],
    session_events: list[SessionEventRecord],
    session_status: str,
    session_ended_at: str | None,
) -> list[TurnTimingRecord]:
    by_turn: dict[str, TurnTimingRecord] = {}
    ordered_latency = sorted(latency_events, key=lambda item: (item.startedAt, item.id))

    for event in ordered_latency:
        if not event.turnId:
            continue
        stage = normalize_latency_stage(event.stage)
        turn = by_turn.get(event.turnId)
        if turn is None:
            turn = TurnTimingRecord(
                turnId=event.turnId,
                userTurnId=f"{event.turnId}:user",
                assistantTurnId=f"{event.turnId}:assistant",
                startedAt=event.startedAt,
                status="partial",
            )
            by_turn[event.turnId] = turn

        if parse_iso(event.startedAt) < parse_iso(turn.startedAt):
            turn.startedAt = event.startedAt

        attr_name = TURN_STAGE_TO_ATTR.get(stage)
        if attr_name and getattr(turn, attr_name) is None:
            setattr(turn, attr_name, event.startedAt)

        duration_name = TURN_STAGE_TO_DURATION.get(stage)
        if duration_name and getattr(turn.durations, duration_name) is None:
            setattr(turn.durations, duration_name, event.durationMs)

        if stage == "turn_completed":
            turn.completedAt = event.startedAt
            turn.status = "complete"

    transcript_by_turn: dict[str, list[TranscriptEventRecord]] = {}
    for event in transcript_events:
        transcript_by_turn.setdefault(event.turnId, []).append(event)

    for turn_id, items in transcript_by_turn.items():
        turn = by_turn.get(turn_id)
        if turn is None:
            first = min(items, key=lambda item: (item.createdAt, item.id))
            turn = TurnTimingRecord(
                turnId=turn_id,
                userTurnId=f"{turn_id}:user",
                assistantTurnId=f"{turn_id}:assistant",
                startedAt=first.createdAt,
                status="partial",
            )
            by_turn[turn_id] = turn

    failed_at = _failed_at(session_events)
    for turn in by_turn.values():
        if turn.completedAt is None and session_ended_at is not None:
            turn.completedAt = session_ended_at
        if turn.status != "complete":
            turn.status = "failed" if session_status == "failed" or failed_at else "partial"
        if turn.turnCompletedAt and turn.durations.turnCompletedMs is None:
            turn.durations.turnCompletedMs = _duration_ms(turn.startedAt, turn.turnCompletedAt)
        turn.missingStages = [
            stage
            for stage in REQUIRED_TURN_STAGES
            if getattr(turn, TURN_STAGE_TO_ATTR[stage]) is None
        ]

    return sorted(by_turn.values(), key=lambda item: (item.startedAt, item.turnId))


def _failed_at(session_events: list[SessionEventRecord]) -> str | None:
    failed = [event.createdAt for event in session_events if event.type == "transport_failed"]
    return min(failed) if failed else None


def _build_rolling_metrics(turn_timings: list[TurnTimingRecord]) -> RollingLatencyMetricsRecord:
    return RollingLatencyMetricsRecord(
        firstAsrPartial=_stat([turn.durations.firstAsrPartialMs for turn in turn_timings]),
        finalAsr=_stat([turn.durations.finalAsrMs for turn in turn_timings]),
        llmFirstToken=_stat([turn.durations.llmFirstTokenMs for turn in turn_timings]),
        ttsFirstByte=_stat([turn.durations.ttsFirstByteMs for turn in turn_timings]),
        playbackStart=_stat([turn.durations.playbackStartMs for turn in turn_timings]),
        turnCompleted=_stat([turn.durations.turnCompletedMs for turn in turn_timings]),
    )


def _stat(values: list[float | None]) -> RollingMetricStatRecord:
    usable = sorted(value for value in values if value is not None)
    if not usable:
        return RollingMetricStatRecord(count=0)
    return RollingMetricStatRecord(
        count=len(usable),
        p50Ms=_percentile(usable, 0.5),
        p95Ms=_percentile(usable, 0.95),
    )


def _percentile(values: list[float], percentile: float) -> float:
    if len(values) == 1:
        return values[0]
    raw_index = (len(values) - 1) * percentile
    lower_index = int(raw_index)
    upper_index = min(lower_index + 1, len(values) - 1)
    if lower_index == upper_index:
        return values[lower_index]
    weight = raw_index - lower_index
    return values[lower_index] + (values[upper_index] - values[lower_index]) * weight


def _duration_ms(started_at: str, ended_at: str) -> float:
    return (parse_iso(ended_at) - parse_iso(started_at)).total_seconds() * 1000
