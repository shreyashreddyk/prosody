export type TransportKind = "smallwebrtc" | "daily";
export type SessionStatus = "idle" | "connecting" | "reconnecting" | "live" | "ended" | "failed";

export interface Session {
  id: string;
  conversationId: string;
  transportKind: TransportKind;
  status: SessionStatus;
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
