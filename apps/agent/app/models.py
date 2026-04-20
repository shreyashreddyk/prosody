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
    firstTranscriptPartialMs: float | None = None
    finalTranscriptMs: float | None = None
    firstAssistantTextMs: float | None = None
    firstAssistantAudioPlaybackMs: float | None = None


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
        "first_transcript_partial",
        "final_transcript",
        "llm_request_start",
        "first_assistant_text",
        "tts_request_start",
        "first_assistant_audio_playback",
    ]
    startedAt: str
    completedAt: str | None = None
    durationMs: float | None = None


class LocalSessionEventsResponse(BaseModel):
    session: SessionRecord
    sessionEvents: list[SessionEventRecord]
    transcriptEvents: list[TranscriptEventRecord]
    latencyEvents: list[LatencyEventRecord]
    turns: list[TurnRecord]


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
