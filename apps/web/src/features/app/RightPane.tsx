import { useState } from "react";
import type {
  ConversationSummaryRecord,
  DegradationEvent,
  FlashcardSet,
  ReplayArtifactStatus,
  RollingLatencyMetrics,
  Session,
  TurnTimingRecord,
} from "@prosody/contracts";
import { EmptyState, LatencyBar, LoadingSpinner, Panel, SectionTitle, StatusBadge } from "@prosody/ui";

/* ─── Helpers ─── */

function latestTurn(turns: TurnTimingRecord[]) {
  const sorted = [...turns].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return sorted.length === 0 ? null : sorted[sorted.length - 1];
}

function formatMs(value?: number) {
  return value == null ? "—" : `${Math.round(value)} ms`;
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

const LATENCY_STAGES = [
  { label: "First ASR", key: "firstAsrPartialMs" as const },
  { label: "Final ASR", key: "finalAsrMs" as const },
  { label: "LLM first token", key: "llmFirstTokenMs" as const },
  { label: "TTS first byte", key: "ttsFirstByteMs" as const },
  { label: "Playback start", key: "playbackStartMs" as const },
  { label: "Turn completed", key: "turnCompletedMs" as const },
];

const ROLLING_STAGES = [
  { label: "ASR partial", key: "firstAsrPartial" as const },
  { label: "Final ASR", key: "finalAsr" as const },
  { label: "LLM first token", key: "llmFirstToken" as const },
  { label: "TTS first byte", key: "ttsFirstByte" as const },
  { label: "Playback", key: "playbackStart" as const },
  { label: "Turn end", key: "turnCompleted" as const },
];

/* ─── Component ─── */

export function RightPane({
  summary,
  flashcardSet,
  turnTimings,
  rollingMetrics,
  degradationEvents,
  replayStatus,
  sessions,
  selectedSessionId,
  summaryLoading,
  flashcardsLoading,
  onGenerateSummary,
  onGenerateFlashcards,
}: {
  summary?: ConversationSummaryRecord;
  flashcardSet?: FlashcardSet;
  turnTimings: TurnTimingRecord[];
  rollingMetrics: RollingLatencyMetrics | null;
  degradationEvents: DegradationEvent[];
  replayStatus: ReplayArtifactStatus;
  sessions: Session[];
  selectedSessionId?: string;
  summaryLoading: boolean;
  flashcardsLoading: boolean;
  onGenerateSummary: () => void;
  onGenerateFlashcards: (sessionId: string) => void;
}) {
  const [flashcardSessionId, setFlashcardSessionId] = useState<string>(selectedSessionId ?? "");
  const [flippedCards, setFlippedCards] = useState<Set<string>>(new Set());

  const latest = latestTurn(turnTimings);
  const maxMs = latest
    ? Math.max(
        ...LATENCY_STAGES.map((s) => latest.durations[s.key] ?? 0).filter(Boolean),
        1
      )
    : 1;

  const activeDegradations = degradationEvents.filter((e) => !e.recoveredAt);
  const recoveredDegradations = degradationEvents.filter((e) => e.recoveredAt);
  const endedSessions = sessions.filter((s) => s.status === "ended");

  const toggleFlip = (id: string) => {
    setFlippedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="flex flex-col gap-4 overflow-y-auto h-full pl-1">
      {/* ── Summary ── */}
      <Panel title="Summary">
        {summary ? (
          <div className="space-y-2 animate-fade-in">
            <p className="text-sm text-text-primary leading-relaxed">
              {summary.summaryText}
            </p>
            <p className="text-[10px] text-text-muted">
              Generated{" "}
              {new Date(summary.generatedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        ) : (
          <EmptyState
            heading="No summary yet"
            description="Complete a session and generate a summary of your coaching."
          />
        )}
        <button
          className="btn-secondary text-xs mt-3 w-full"
          onClick={onGenerateSummary}
          disabled={summaryLoading}
        >
          {summaryLoading ? (
            <span className="flex items-center gap-2 justify-center"><LoadingSpinner size={14} /> Generating…</span>
          ) : (
            "Generate summary"
          )}
        </button>
      </Panel>

      {/* ── Metrics ── */}
      <Panel title="Session Metrics" subtle>
        {!selectedSessionId ? (
          <EmptyState
            heading="No session selected"
            description="Select a session from the left to view latency metrics."
          />
        ) : (
          <div className="space-y-4 animate-fade-in">
            {/* Latest turn breakdown */}
            <div>
              <SectionTitle>Latest turn</SectionTitle>
              {latest ? (
                <div className="space-y-2">
                  {LATENCY_STAGES.map((stage) => (
                    <LatencyBar
                      key={stage.key}
                      label={stage.label}
                      valueMs={latest.durations[stage.key]}
                      maxMs={maxMs}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-muted">
                  Metrics appear after the first completed turn.
                </p>
              )}
            </div>

            {/* Rolling metrics */}
            {rollingMetrics && (
              <div>
                <SectionTitle>Rolling (p50 / p95)</SectionTitle>
                <div className="text-xs space-y-1">
                  {ROLLING_STAGES.map((stage) => {
                    const stat = rollingMetrics[stage.key];
                    if (!stat.count) return null;
                    return (
                      <div
                        key={stage.key}
                        className="flex items-center justify-between text-text-secondary"
                      >
                        <span>{stage.label}</span>
                        <span className="font-mono text-text-muted">
                          {formatMs(stat.p50Ms)} / {formatMs(stat.p95Ms)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Degradation events */}
            <div>
              <SectionTitle>Degradation events</SectionTitle>
              {activeDegradations.length > 0 ? (
                <div className="space-y-1.5">
                  {activeDegradations.map((event) => (
                    <div key={event.id} className="flex items-center gap-2">
                      <StatusBadge tone={degradationTone(event.severity)}>
                        {degradationBadgeLabel(event.code)}
                      </StatusBadge>
                      <span className="text-[10px] text-text-muted truncate">
                        {event.message}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-muted">No active degradation events.</p>
              )}
              {recoveredDegradations.length > 0 && (
                <p className="text-[10px] text-text-muted mt-1.5">
                  Recovered:{" "}
                  {recoveredDegradations.map((e) => degradationBadgeLabel(e.code)).join(", ")}
                </p>
              )}
            </div>

            {/* Replay status */}
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>Replay artifact:</span>
              <StatusBadge tone={replayStatus.available ? "success" : "neutral"}>
                {replayStatus.available ? "Available" : "Pending"}
              </StatusBadge>
            </div>
          </div>
        )}
      </Panel>

      {/* ── Flashcards ── */}
      <Panel title="Flashcards" subtle>
        {/* Generation controls */}
        <div className="space-y-2 mb-3">
          <label className="text-xs text-text-secondary block">Session:</label>
          <select
            className="w-full rounded-lg bg-bg-surface-2 border border-border-subtle px-3 py-1.5
                       text-xs text-text-primary focus:outline-none focus:border-accent-teal"
            value={flashcardSessionId}
            onChange={(e) => setFlashcardSessionId(e.target.value)}
          >
            <option value="">Select a session</option>
            {endedSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.startedAt ?? s.createdAt ?? "").toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                ({s.status})
              </option>
            ))}
          </select>
          <button
            className="btn-secondary text-xs w-full"
            onClick={() => {
              if (flashcardSessionId) onGenerateFlashcards(flashcardSessionId);
            }}
            disabled={!flashcardSessionId || flashcardsLoading}
          >
            {flashcardsLoading ? (
              <span className="flex items-center gap-2 justify-center"><LoadingSpinner size={14} /> Generating…</span>
            ) : (
              "Generate flashcards"
            )}
          </button>
        </div>

        {/* Flashcard display */}
        {flashcardSet?.cards.length ? (
          <div className="space-y-2 animate-fade-in">
            {flashcardSet.cards.map((card) => (
              <button
                key={card.id}
                onClick={() => toggleFlip(card.id)}
                className="w-full text-left rounded-lg p-3 bg-[rgba(255,255,255,0.03)] border border-border-subtle
                           hover:border-border-default transition-all duration-200 cursor-pointer"
              >
                {flippedCards.has(card.id) ? (
                  <div className="animate-fade-in">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-accent-teal mb-1">
                      Answer
                    </p>
                    <p className="text-sm text-text-primary leading-relaxed">
                      {card.answer}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-accent-blue mb-1">
                      Prompt
                    </p>
                    <p className="text-sm text-text-primary leading-relaxed">
                      {card.prompt}
                    </p>
                  </div>
                )}
                <p className="text-[9px] text-text-muted mt-2">
                  {flippedCards.has(card.id) ? "Click to see prompt" : "Click to reveal answer"}
                </p>
              </button>
            ))}
            <p className="text-[10px] text-text-muted text-center">
              {flashcardSet.cards.length} cards ·{" "}
              Generated{" "}
              {new Date(flashcardSet.generatedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        ) : (
          <EmptyState
            heading="No flashcards yet"
            description="Generate flashcards from a completed session to study key coaching points."
          />
        )}
      </Panel>
    </aside>
  );
}
