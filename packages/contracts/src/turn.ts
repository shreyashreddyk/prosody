export interface TurnLatencySummary {
  firstAsrPartialMs?: number;
  finalAsrMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstByteMs?: number;
  playbackStartMs?: number;
}

export type TurnRole = "user" | "assistant" | "system";

export interface Turn {
  id: string;
  conversationId: string;
  sessionId: string;
  role: TurnRole;
  transcriptText: string;
  createdAt: string;
  latencySummary?: TurnLatencySummary;
}
