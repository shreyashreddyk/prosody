export type ConversationStatus = "active" | "archived";

export interface Conversation {
  id: string;
  title: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastSessionId?: string;
  summary?: string;
}
