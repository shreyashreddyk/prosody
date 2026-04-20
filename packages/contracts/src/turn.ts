export interface TurnLatencySummary {
  firstTranscriptPartialMs?: number;
  finalTranscriptMs?: number;
  firstAssistantTextMs?: number;
  firstAssistantAudioPlaybackMs?: number;
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
