import type {
  AppBootstrapResponse,
  Conversation,
  ConversationListItem,
  ConversationSummaryRecord,
  ConversationWorkspace,
  FlashcardSet,
  Session,
  Source,
  Turn,
  UserProfile
} from "@prosody/contracts";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

type ConversationRow = {
  id: string;
  owner_user_id: string;
  title: string;
  status?: string | null;
  archived?: boolean | null;
  last_session_id?: string | null;
  last_activity_at?: string | null;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  conversation_id: string;
  status: string;
  transport?: string | null;
  transport_kind?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SourceRow = {
  id: string;
  conversation_id: string;
  filename: string;
  mime_type: string;
  storage_bucket?: string | null;
  storage_path?: string | null;
  size_bytes?: number | null;
  status?: string | null;
  processing_status?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type TurnRow = {
  id: string;
  conversation_id: string;
  session_id: string;
  turn_index: number;
  user_text?: string | null;
  assistant_text?: string | null;
  user_audio_capture_start_at?: string | null;
  first_asr_partial_at?: string | null;
  final_asr_at?: string | null;
  llm_request_start_at?: string | null;
  llm_first_token_at?: string | null;
  tts_request_start_at?: string | null;
  tts_first_byte_at?: string | null;
  playback_start_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
};

function mapConversation(row: ConversationRow, latestSummary?: string): Conversation {
  return {
    id: row.id,
    title: row.title,
    status: row.status === "archived" || row.archived ? "archived" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSessionId: row.last_session_id ?? undefined,
    lastActivityAt: row.last_activity_at ?? row.updated_at,
    latestSummary
  };
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    transportKind: (row.transport_kind ?? row.transport ?? "smallwebrtc") as Session["transportKind"],
    status: row.status as Session["status"],
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: "document",
    filename: row.filename,
    mimeType: row.mime_type,
    storageBucket: row.storage_bucket ?? "conversation-sources",
    storagePath: row.storage_path ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    processingStatus: (row.processing_status ?? row.status ?? "pending") as Source["processingStatus"],
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

function mapTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    userText: row.user_text ?? undefined,
    assistantText: row.assistant_text ?? undefined,
    userAudioCaptureStartAt: row.user_audio_capture_start_at ?? undefined,
    firstAsrPartialAt: row.first_asr_partial_at ?? undefined,
    finalAsrAt: row.final_asr_at ?? undefined,
    llmRequestStartAt: row.llm_request_start_at ?? undefined,
    llmFirstTokenAt: row.llm_first_token_at ?? undefined,
    ttsRequestStartAt: row.tts_request_start_at ?? undefined,
    ttsFirstByteAt: row.tts_first_byte_at ?? undefined,
    playbackStartAt: row.playback_start_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined
  };
}

async function ensureProfileRow(user: User): Promise<UserProfile> {
  const displayName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : user.email;
  const avatarUrl = typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : undefined;

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: displayName,
        avatar_url: avatarUrl
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: data.display_name ?? undefined,
    avatarUrl: data.avatar_url ?? undefined,
    createdAt: data.created_at ?? undefined,
    updatedAt: data.updated_at ?? undefined
  };
}

export async function loadBootstrap(user: User): Promise<AppBootstrapResponse> {
  const profile = await ensureProfileRow(user);

  const { data: summaryRows } = await supabase
    .from("conversation_summaries")
    .select("*")
    .order("generated_at", { ascending: false });

  const latestSummaryByConversation = new Map<string, string>();
  for (const row of summaryRows ?? []) {
    if (!latestSummaryByConversation.has(row.conversation_id)) {
      latestSummaryByConversation.set(row.conversation_id, row.summary_text);
    }
  }

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  const conversationRows = (conversations ?? []) as ConversationRow[];
  const conversationIds = conversationRows.map((row) => row.id);

  const [{ data: sessions }, { data: sources }] = await Promise.all([
    conversationIds.length
      ? supabase.from("sessions").select("*").in("conversation_id", conversationIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length
      ? supabase.from("sources").select("*").in("conversation_id", conversationIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);

  const latestSessionByConversation = new Map<string, Session>();
  const sessionCountByConversation = new Map<string, number>();
  for (const row of ((sessions as { data?: SessionRow[] })?.data ?? []) as SessionRow[]) {
    sessionCountByConversation.set(row.conversation_id, (sessionCountByConversation.get(row.conversation_id) ?? 0) + 1);
    if (!latestSessionByConversation.has(row.conversation_id)) {
      latestSessionByConversation.set(row.conversation_id, mapSession(row));
    }
  }

  const sourceCountByConversation = new Map<string, number>();
  for (const row of ((sources as { data?: SourceRow[] })?.data ?? []) as SourceRow[]) {
    sourceCountByConversation.set(row.conversation_id, (sourceCountByConversation.get(row.conversation_id) ?? 0) + 1);
  }

  const items: ConversationListItem[] = conversationRows.map((row) => ({
    conversation: mapConversation(row, latestSummaryByConversation.get(row.id)),
    latestSession: latestSessionByConversation.get(row.id),
    sessionCount: sessionCountByConversation.get(row.id) ?? 0,
    sourceCount: sourceCountByConversation.get(row.id) ?? 0
  }));

  return {
    profile,
    conversations: items,
    selectedConversationId: items[0]?.conversation.id
  };
}

export async function createConversation(userId: string, title: string): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      id: crypto.randomUUID(),
      owner_user_id: userId,
      title,
      archived: false
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapConversation(data as ConversationRow);
}

export async function loadConversationWorkspace(conversationId: string): Promise<ConversationWorkspace> {
  const [{ data: conversation, error: conversationError }, { data: sessions }, { data: sources }, { data: turns }, { data: summaries }, { data: flashcards }] =
    await Promise.all([
      supabase.from("conversations").select("*").eq("id", conversationId).single(),
      supabase.from("sessions").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: false }),
      supabase.from("sources").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: false }),
      supabase.from("turns").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true }),
      supabase.from("conversation_summaries").select("*").eq("conversation_id", conversationId).order("generated_at", { ascending: false }).limit(1),
      supabase.from("flashcard_sets").select("*").eq("conversation_id", conversationId).order("generated_at", { ascending: false }).limit(1)
    ]);

  if (conversationError) {
    throw conversationError;
  }

  const summaryRow = summaries?.[0];
  const flashcardRow = flashcards?.[0];

  const summary: ConversationSummaryRecord | undefined = summaryRow
    ? {
        id: summaryRow.id,
        conversationId: summaryRow.conversation_id,
        sourceSessionId: summaryRow.source_session_id ?? undefined,
        summaryText: summaryRow.summary_text,
        generatedAt: summaryRow.generated_at
      }
    : undefined;

  const flashcardSet: FlashcardSet | undefined = flashcardRow
    ? {
        id: flashcardRow.id,
        conversationId: flashcardRow.conversation_id,
        generatedAt: flashcardRow.generated_at,
        cards: Array.isArray(flashcardRow.cards) ? flashcardRow.cards : []
      }
    : undefined;

  return {
    conversation: mapConversation(conversation as ConversationRow, summary?.summaryText),
    sessions: ((sessions ?? []) as SessionRow[]).map(mapSession),
    sources: ((sources ?? []) as SourceRow[]).map(mapSource),
    turns: ((turns ?? []) as TurnRow[]).map(mapTurn),
    summary,
    flashcardSet
  };
}

export async function uploadSource(userId: string, conversationId: string, file: File): Promise<void> {
  const sourceId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const storagePath = `user/${userId}/conversations/${conversationId}/sources/${sourceId}/${safeName}`;

  const { error: insertError } = await supabase.from("sources").insert({
    id: sourceId,
    conversation_id: conversationId,
    owner_user_id: userId,
    filename: file.name,
    mime_type: file.type || "application/octet-stream",
    storage_path: storagePath,
    size_bytes: file.size,
    status: "pending"
  });

  if (insertError) {
    throw insertError;
  }

  const { error: uploadError } = await supabase.storage.from("conversation-sources").upload(storagePath, file, {
    upsert: false
  });

  if (uploadError) {
    await supabase
      .from("sources")
      .update({ status: "failed", error_message: uploadError.message })
      .eq("id", sourceId);
    throw uploadError;
  }

  const { error: updateError } = await supabase
    .from("sources")
    .update({ status: "ready", error_message: null })
    .eq("id", sourceId);

  if (updateError) {
    throw updateError;
  }
}
