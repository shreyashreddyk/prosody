from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str


class ProviderConfigState(BaseModel):
    deepgram_configured: bool
    elevenlabs_configured: bool
    daily_configured: bool
    supabase_configured: bool


class MetaResponse(BaseModel):
    service: str
    version: str
    realtime_status: str
    intended_local_transport: str
    intended_deployed_transport: str
    provider_config: ProviderConfigState


class LocalSessionCreateRequest(BaseModel):
    conversation_id: str | None = None


class SessionRecord(BaseModel):
    id: str
    conversationId: str
    transportKind: Literal["smallwebrtc", "daily"] = "smallwebrtc"
    status: Literal["idle", "connecting", "live", "ended", "failed"] = "idle"
    startedAt: str | None = None
    endedAt: str | None = None


class LocalSessionCreateResponse(BaseModel):
    conversationId: str
    session: SessionRecord
    offerEndpoint: str


class SessionEventRecord(BaseModel):
    id: str
    conversationId: str
    sessionId: str
    type: Literal["session_started", "session_ended", "transport_connected", "transport_failed"]
    createdAt: str
    details: dict[str, str | int | float | bool | None] | None = None


class TranscriptEventRecord(BaseModel):
    id: str
    conversationId: str
    sessionId: str
    turnId: str
    role: Literal["user", "assistant"]
    kind: Literal["partial", "final"]
    text: str
    createdAt: str


class TurnLatencySummaryRecord(BaseModel):
    firstAsrPartialMs: float | None = None
    finalAsrMs: float | None = None
    llmFirstTokenMs: float | None = None
    ttsFirstByteMs: float | None = None
    playbackStartMs: float | None = None
    turnCompletedMs: float | None = None


class TurnTimingRecord(BaseModel):
    turnId: str
    userTurnId: str | None = None
    assistantTurnId: str | None = None
    startedAt: str
    completedAt: str | None = None
    status: Literal["complete", "partial", "failed"]
    firstUserAudioAt: str | None = None
    firstAsrPartialAt: str | None = None
    finalAsrAt: str | None = None
    llmRequestStartAt: str | None = None
    llmFirstTokenAt: str | None = None
    ttsRequestStartAt: str | None = None
    ttsFirstByteAt: str | None = None
    playbackStartAt: str | None = None
    turnCompletedAt: str | None = None
    missingStages: list[str] = Field(default_factory=list)
    durations: TurnLatencySummaryRecord = Field(default_factory=TurnLatencySummaryRecord)


class TurnRecord(BaseModel):
    id: str
    conversationId: str
    sessionId: str
    role: Literal["user", "assistant", "system"]
    transcriptText: str
    createdAt: str
    latencySummary: TurnLatencySummaryRecord | None = None


class LatencyEventRecord(BaseModel):
    id: str
    conversationId: str
    sessionId: str
    turnId: str | None = None
    stage: Literal[
        "session_start",
        "first_user_audio",
        "first_asr_partial",
        "final_asr",
        "llm_request_start",
        "llm_first_token",
        "tts_request_start",
        "tts_first_byte",
        "playback_start",
        "turn_completed",
    ]
    startedAt: str
    completedAt: str | None = None
    durationMs: float | None = None


class SessionTimelineEventRecord(BaseModel):
    id: str
    conversationId: str
    sessionId: str
    turnId: str | None = None
    kind: Literal["session", "transcript", "latency", "degradation", "replay"]
    stage: str | None = None
    createdAt: str
    sequence: int
    details: dict[str, str | int | float | bool | None] | None = None


class DegradationEventRecord(BaseModel):
    id: str
    conversationId: str
    sessionId: str
    category: Literal["transport", "provider", "latency", "source_processing"]
    severity: Literal["info", "warning", "critical"]
    message: str
    createdAt: str
    recoveredAt: str | None = None


class RollingMetricStatRecord(BaseModel):
    count: int = 0
    p50Ms: float | None = None
    p95Ms: float | None = None


class RollingLatencyMetricsRecord(BaseModel):
    firstAsrPartial: RollingMetricStatRecord = Field(default_factory=RollingMetricStatRecord)
    finalAsr: RollingMetricStatRecord = Field(default_factory=RollingMetricStatRecord)
    llmFirstToken: RollingMetricStatRecord = Field(default_factory=RollingMetricStatRecord)
    ttsFirstByte: RollingMetricStatRecord = Field(default_factory=RollingMetricStatRecord)
    playbackStart: RollingMetricStatRecord = Field(default_factory=RollingMetricStatRecord)
    turnCompleted: RollingMetricStatRecord = Field(default_factory=RollingMetricStatRecord)


class ReplayArtifactStatusRecord(BaseModel):
    available: bool
    generatedAt: str | None = None
    path: str | None = None


class ReplayArtifactRecord(BaseModel):
    schemaVersion: str
    generatedAt: str
    session: SessionRecord
    transcript: list[TranscriptEventRecord]
    timeline: list[SessionTimelineEventRecord]
    turnTimings: list[TurnTimingRecord]
    rollingMetrics: RollingLatencyMetricsRecord
    degradationEvents: list[DegradationEventRecord]
    notes: list[str] = Field(default_factory=list)


class LocalSessionEventsResponse(BaseModel):
    session: SessionRecord
    sessionEvents: list[SessionEventRecord]
    transcriptEvents: list[TranscriptEventRecord]
    latencyEvents: list[LatencyEventRecord]
    turns: list[TurnRecord]


class SessionTimelineResponse(BaseModel):
    session: SessionRecord
    timeline: list[SessionTimelineEventRecord]
    turnTimings: list[TurnTimingRecord]
    rollingMetrics: RollingLatencyMetricsRecord
    degradationEvents: list[DegradationEventRecord]
    replayArtifactStatus: ReplayArtifactStatusRecord


class SmallWebRTCOfferRequest(BaseModel):
    sdp: str
    type: str
    pc_id: str | None = None
    restart_pc: bool | None = None
    requestData: Any | None = None


class SmallWebRTCOfferResponse(BaseModel):
    sdp: str
    type: str
    pc_id: str


class IceCandidateRecord(BaseModel):
    candidate: str
    sdp_mid: str
    sdp_mline_index: int


class SmallWebRTCPatchRequestModel(BaseModel):
    pc_id: str
    candidates: list[IceCandidateRecord] = Field(default_factory=list)
