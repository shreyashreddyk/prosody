import type { Conversation } from "./conversation";
import type { FlashcardSet } from "./flashcards";
import type { Session } from "./session";
import type { Source } from "./source";
import type { Turn } from "./turn";

export interface UserProfile {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthSessionSummary {
  userId: string;
  email?: string;
  expiresAt?: number;
  accessToken: string;
}

export interface ConversationListItem {
  conversation: Conversation;
  latestSession?: Session;
  sessionCount: number;
  sourceCount: number;
}

export interface ConversationSummaryRecord {
  id: string;
  conversationId: string;
  sourceSessionId?: string;
  summaryText: string;
  generatedAt: string;
}

export interface ConversationWorkspace {
  conversation: Conversation;
  sessions: Session[];
  sources: Source[];
  turns: Turn[];
  summary?: ConversationSummaryRecord;
  flashcardSet?: FlashcardSet;
}

export interface AppBootstrapResponse {
  profile: UserProfile;
  conversations: ConversationListItem[];
  selectedConversationId?: string;
}
