import type { DegradationEvent, RealtimeConnectionState, Session, Turn } from "@prosody/contracts";
import { EmptyState, StatusBadge } from "@prosody/ui";
import { useEffect, useRef } from "react";
import type { TranscriptRow } from "./LiveSessionPanel";

/* ─── Helpers ─── */

function connectionStatusLabel(state: RealtimeConnectionState) {
  const map: Record<RealtimeConnectionState, string> = {
    idle: "Idle",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    connected: "Connected",
    live: "Listening",
    ending: "Ending",
    ended: "Session ended",
    failed: "Failed",
  };
  return map[state];
}

function connectionStatusTone(state: RealtimeConnectionState) {
  if (state === "live") return "success" as const;
  if (state === "failed") return "danger" as const;
  if (state === "reconnecting" || state === "connecting") return "warning" as const;
  return "neutral" as const;
}

function degradationBadgeLabel(code: DegradationEvent["code"]) {
  if (code === "asr_stall") return "ASR retry";
  if (code === "llm_timeout") return "LLM fallback";
  if (code === "tts_timeout") return "Text only";
  return "Reconnect";
}

function degradationTone(severity: DegradationEvent["severity"]) {
  if (severity === "critical") return "danger" as const;
  if (severity === "warning") return "warning" as const;
  return "neutral" as const;
}

/* ─── Session separator grouping ─── */

type SessionGroup = {
  sessionId: string;
  label: string;
  isLive: boolean;
  turnCount: number;
  rows: TranscriptRow[];
};

function groupBySession(
  transcriptRows: TranscriptRow[],
  allSessions: Session[],
  allTurns: Turn[],
  currentLiveSessionId?: string
): SessionGroup[] {
  // Get unique session IDs in order from transcript rows, or from persisted turns
  const sessionIds: string[] = [];
  const seen = new Set<string>();

  // From persisted turns
  for (const t of allTurns) {
    if (!seen.has(t.sessionId)) {
      seen.add(t.sessionId);
      sessionIds.push(t.sessionId);
    }
  }
  // From live transcript rows (might not have a real sessionId yet)
  for (const r of transcriptRows) {
    if (r.sessionId && !seen.has(r.sessionId)) {
      seen.add(r.sessionId);
      sessionIds.push(r.sessionId);
    }
  }

  // If no session grouping available, return a single group
  if (sessionIds.length === 0 && transcriptRows.length > 0) {
    return [{
      sessionId: "",
      label: "Live session",
      isLive: true,
      turnCount: transcriptRows.length,
      rows: transcriptRows,
    }];
  }

  const sessionMap = new Map(allSessions.map((s) => [s.id, s]));
  const groups: SessionGroup[] = [];

  for (const sid of sessionIds) {
    const session = sessionMap.get(sid);
    const turnCount = allTurns.filter((t) => t.sessionId === sid).length;
    const rows = transcriptRows.filter((r) => r.sessionId === sid);
    const isLive = sid === currentLiveSessionId;

    // Build label from session data
    let label = "Session";
    if (session) {
      const dt = session.startedAt ?? session.createdAt;
      if (dt) {
        label = new Date(dt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }

    groups.push({ sessionId: sid, label, isLive, turnCount, rows });
  }

  // If we have live rows not tied to a session, add them
  const ungroupedLiveRows = transcriptRows.filter((r) => !r.sessionId || !seen.has(r.sessionId));
  if (ungroupedLiveRows.length > 0) {
    groups.push({
      sessionId: currentLiveSessionId ?? "",
      label: "Live session",
      isLive: true,
      turnCount: ungroupedLiveRows.length,
      rows: ungroupedLiveRows,
    });
  }

  return groups;
}

/* ─── Component ─── */

export function CenterPane({
  connectionState,
  transcriptRows,
  allSessions,
  allTurns,
  currentLiveSessionId,
  degradationEvents,
  errorMessage,
  hasConversation,
  onStart,
  onEnd,
}: {
  connectionState: RealtimeConnectionState;
  transcriptRows: TranscriptRow[];
  allSessions: Session[];
  allTurns: Turn[];
  currentLiveSessionId?: string;
  degradationEvents: DegradationEvent[];
  errorMessage: string | null;
  hasConversation: boolean;
  onStart: () => void;
  onEnd: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Badge lookup by turnId
  const badgesByTurn = degradationEvents.reduce<Record<string, DegradationEvent[]>>((acc, event) => {
    if (!event.turnId) return acc;
    acc[event.turnId] = [...(acc[event.turnId] ?? []), event];
    return acc;
  }, {});

  // Auto-scroll to bottom on new transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptRows.length]);

  // Build session groups for transcript display
  // For persisted turns, build rows from Turn data
  const persistedRows: TranscriptRow[] = allTurns.flatMap((turn) => {
    const rows: TranscriptRow[] = [];
    if (turn.userText) {
      rows.push({
        id: `${turn.id}:user`,
        turnId: turn.id,
        sessionId: turn.sessionId,
        role: "user",
        text: turn.userText,
        final: true,
        createdAt: turn.createdAt,
      });
    }
    if (turn.assistantText) {
      rows.push({
        id: `${turn.id}:assistant`,
        turnId: turn.id,
        sessionId: turn.sessionId,
        role: "assistant",
        text: turn.assistantText,
        final: true,
        createdAt: turn.completedAt ?? turn.createdAt,
      });
    }
    return rows;
  });

  // Combine persisted rows with live transcript rows, deduplicating by id
  const rowMap = new Map<string, TranscriptRow>();
  for (const row of persistedRows) rowMap.set(row.id, row);
  for (const row of transcriptRows) rowMap.set(row.id, row); // live rows overwrite persisted
  const combinedRows = Array.from(rowMap.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sessionGroups = groupBySession(combinedRows, allSessions, allTurns, currentLiveSessionId);

  const isActive = connectionState === "live" || connectionState === "connecting" || connectionState === "connected";
  const activeDegradations = degradationEvents.filter((e) => !e.recoveredAt);

  if (!hasConversation) {
    return (
      <section className="flex items-center justify-center h-full">
        <EmptyState
          heading="Welcome to Prosody"
          description="Create a conversation to unlock live voice coaching, transcript history, and source attachments."
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col h-full">
      {/* ── Scrollable transcript area ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {sessionGroups.length === 0 && transcriptRows.length === 0 ? (
          <EmptyState
            heading="Start a session to begin coaching"
            description="Your coach will respond in real time. The full transcript is saved to your workspace."
          />
        ) : (
          sessionGroups.map((group) => (
            <div key={group.sessionId || "live"} className="mb-6 animate-fade-in">
              {/* Session separator */}
              <div className="flex items-center gap-2 mb-3 px-1">
                {group.isLive ? (
                  <span className="w-2 h-2 rounded-full bg-accent-teal animate-pulse-dot" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-text-muted" />
                )}
                <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                  {group.label}
                </span>
                <span className="text-[10px] text-text-muted">
                  · {group.turnCount} turns
                </span>
                {group.isLive && (
                  <StatusBadge tone="success" pulse>Live</StatusBadge>
                )}
                <div className="flex-1 border-t border-border-subtle" />
              </div>

              {/* Turn cards */}
              <div className="space-y-2">
                {group.rows.map((row) => (
                  <article
                    key={row.id}
                    className={`rounded-lg px-4 py-3 bg-[rgba(255,255,255,0.02)] border-l-2 transition-all duration-200
                      ${row.role === "user"
                        ? "border-l-accent-blue"
                        : "border-l-accent-teal"
                      }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
                      {row.role === "user" ? "You" : "Coach"}
                      {!row.final && (
                        <span className="ml-2 text-accent-teal animate-pulse-dot">●</span>
                      )}
                    </p>
                    <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                      {row.text}
                      {!row.final && (
                        <span className="inline-block w-0.5 h-4 bg-accent-teal ml-0.5 animate-pulse-dot align-text-bottom" />
                      )}
                    </p>
                    {/* Degradation badges */}
                    {badgesByTurn[row.turnId]?.length ? (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {badgesByTurn[row.turnId].map((event) => (
                          <StatusBadge key={event.id} tone={degradationTone(event.severity)}>
                            {degradationBadgeLabel(event.code)}
                            {event.recoveredAt ? " · recovered" : ""}
                          </StatusBadge>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Live Dock (fixed at bottom) ── */}
      <div className={`shrink-0 border-t px-4 py-3 bg-bg-surface-1/80 backdrop-blur-sm
        ${activeDegradations.length > 0
          ? "border-accent-red/40"
          : "border-border-subtle"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          {/* Status */}
          <div className="flex items-center gap-2">
            <StatusBadge
              tone={connectionStatusTone(connectionState)}
              pulse={isActive || connectionState === "reconnecting"}
            >
              {connectionStatusLabel(connectionState)}
            </StatusBadge>
            {activeDegradations.length > 0 && (
              <span className="text-[10px] text-accent-red font-medium">
                Degraded — text-only mode
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              className="btn-primary text-xs px-4 py-1.5"
              onClick={onStart}
              disabled={isActive}
            >
              Start session
            </button>
            <button
              className="btn-secondary text-xs px-4 py-1.5"
              onClick={onEnd}
              disabled={!currentLiveSessionId || connectionState === "ended"}
            >
              End session
            </button>
          </div>
        </div>

        {/* Error */}
        {errorMessage && (
          <p className="text-xs text-accent-red mt-2">{errorMessage}</p>
        )}

        {/* Reconnect notice */}
        {connectionState === "reconnecting" && (
          <p className="text-xs text-text-muted mt-2">
            Reconnect in progress. Prosody is attempting to resume the same session.
          </p>
        )}
      </div>
    </section>
  );
}
