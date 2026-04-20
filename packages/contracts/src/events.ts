export type LatencyStage =
  | "session_start"
  | "first_user_audio"
  | "first_transcript_partial"
  | "final_transcript"
  | "llm_request_start"
  | "first_assistant_text"
  | "tts_request_start"
  | "first_assistant_audio_playback";

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

export type DegradationCategory = "transport" | "provider" | "latency" | "source_processing";
export type DegradationSeverity = "info" | "warning" | "critical";

export interface DegradationEvent {
  id: string;
  conversationId: string;
  sessionId: string;
  category: DegradationCategory;
  severity: DegradationSeverity;
  message: string;
  createdAt: string;
  recoveredAt?: string;
}

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
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
  | "transport_failed";

export interface SessionEvent {
  id: string;
  conversationId: string;
  sessionId: string;
  type: SessionEventType;
  createdAt: string;
  details?: Record<string, string | number | boolean | null>;
}
