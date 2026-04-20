export type LatencyStage =
  | "session_start"
  | "first_user_audio"
  | "first_asr_partial"
  | "final_asr"
  | "llm_request_start"
  | "llm_first_token"
  | "tts_request_start"
  | "tts_first_byte"
  | "playback_start"
  | "turn_completed";

export interface LatencyEvent {
  id: string;
  conversationId: string;
  sessionId: string;
  turnId?: string;
  stage: LatencyStage;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export type SessionTimelineEventKind = "session" | "transcript" | "latency" | "degradation" | "replay";

export interface SessionTimelineEvent {
  id: string;
  conversationId: string;
  sessionId: string;
  turnId?: string;
  kind: SessionTimelineEventKind;
  stage?: LatencyStage;
  createdAt: string;
  sequence: number;
  details?: Record<string, string | number | boolean | null>;
}

export type DegradationCategory = "transport" | "provider" | "latency" | "source_processing";
export type DegradationSeverity = "info" | "warning" | "critical";
export type DegradationProvider = "asr" | "llm" | "tts" | "transport";
export type DegradationCode =
  | "asr_stall"
  | "llm_timeout"
  | "tts_timeout"
  | "transport_disconnect";

export interface DegradationEvent {
  id: string;
  conversationId: string;
  sessionId: string;
  turnId?: string;
  category: DegradationCategory;
  severity: DegradationSeverity;
  provider?: DegradationProvider;
  code: DegradationCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
  createdAt: string;
  recoveredAt?: string;
}

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "live"
  | "ending"
  | "ended"
  | "failed";

export type TranscriptEventKind = "partial" | "final";

export interface TranscriptEvent {
  id: string;
  conversationId: string;
  sessionId: string;
  turnId: string;
  role: "user" | "assistant";
  kind: TranscriptEventKind;
  text: string;
  createdAt: string;
}

export type SessionEventType =
  | "session_started"
  | "session_ended"
  | "transport_connected"
  | "transport_disconnected"
  | "transport_reconnecting"
  | "transport_resumed"
  | "transport_failed";

export interface SessionEvent {
  id: string;
  conversationId: string;
  sessionId: string;
  type: SessionEventType;
  createdAt: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface RollingMetricStat {
  count: number;
  p50Ms?: number;
  p95Ms?: number;
}

export interface RollingLatencyMetrics {
  firstAsrPartial: RollingMetricStat;
  finalAsr: RollingMetricStat;
  llmFirstToken: RollingMetricStat;
  ttsFirstByte: RollingMetricStat;
  playbackStart: RollingMetricStat;
  turnCompleted: RollingMetricStat;
}

export interface ReplayArtifactStatus {
  available: boolean;
  generatedAt?: string;
  path?: string;
}

export interface ReplayArtifactRecord {
  schemaVersion: string;
  generatedAt: string;
  session: import("./session").Session;
  transcript: TranscriptEvent[];
  timeline: SessionTimelineEvent[];
  turnTimings: import("./turn").TurnTimingRecord[];
  rollingMetrics: RollingLatencyMetrics;
  degradationEvents: DegradationEvent[];
  notes: string[];
}

export interface SessionTimelineResponse {
  session: import("./session").Session;
  timeline: SessionTimelineEvent[];
  turnTimings: import("./turn").TurnTimingRecord[];
  rollingMetrics: RollingLatencyMetrics;
  degradationEvents: DegradationEvent[];
  replayArtifactStatus: ReplayArtifactStatus;
}
