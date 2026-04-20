export interface TurnLatencySummary {
  firstAsrPartialMs?: number;
  finalAsrMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstByteMs?: number;
  playbackStartMs?: number;
  turnCompletedMs?: number;
}

export type TurnTimingStatus = "complete" | "partial" | "failed";

export interface TurnTimingRecord {
  turnId: string;
  userTurnId?: string;
  assistantTurnId?: string;
  startedAt: string;
  completedAt?: string;
  status: TurnTimingStatus;
  firstUserAudioAt?: string;
  firstAsrPartialAt?: string;
  finalAsrAt?: string;
  llmRequestStartAt?: string;
  llmFirstTokenAt?: string;
  ttsRequestStartAt?: string;
  ttsFirstByteAt?: string;
  playbackStartAt?: string;
  turnCompletedAt?: string;
  missingStages: import("./events").LatencyStage[];
  durations: TurnLatencySummary;
}

export type TurnRole = "user" | "assistant" | "system";

export interface Turn {
  id: string;
  conversationId: string;
  sessionId: string;
  turnIndex: number;
  userText?: string;
  assistantText?: string;
  userAudioCaptureStartAt?: string;
  firstAsrPartialAt?: string;
  finalAsrAt?: string;
  llmRequestStartAt?: string;
  llmFirstTokenAt?: string;
  ttsRequestStartAt?: string;
  ttsFirstByteAt?: string;
  playbackStartAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
  latencySummary?: TurnLatencySummary;
}
