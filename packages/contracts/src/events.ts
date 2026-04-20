export type LatencyStage =
  | "audio_capture_start"
  | "first_asr_partial"
  | "final_asr"
  | "llm_request_start"
  | "llm_first_token"
  | "tts_request_start"
  | "tts_first_byte"
  | "playback_start"
  | "turn_complete";

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
