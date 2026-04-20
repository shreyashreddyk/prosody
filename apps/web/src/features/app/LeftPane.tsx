import type { ConversationListItem, Session, Source } from "@prosody/contracts";
import { EmptyState, Panel, StatusBadge } from "@prosody/ui";
import { useRef, useState } from "react";

function formatRelativeTime(value?: string) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sourceStatusTone(status: string) {
  if (status === "ready") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "warning" as const;
}

function sessionStatusTone(status: string) {
  if (status === "live") return "success" as const;
  if (status === "reconnecting") return "warning" as const;
  if (status === "failed") return "danger" as const;
  return "neutral" as const;
}

export function LeftPane({
  conversations,
  activeConversationId,
  sessions,
  sources,
  selectedSessionId,
  uploading,
  onSelectConversation,
  onSelectSession,
  onUpload,
}: {
  conversations: ConversationListItem[];
  activeConversationId?: string;
  sessions: Session[];
  sources: Source[];
  selectedSessionId?: string;
  uploading: boolean;
  onSelectConversation: (id: string) => void;
  onSelectSession: (id: string) => void;
  onUpload: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  };

  return (
    <aside className="flex flex-col gap-4 overflow-y-auto h-full pr-1">
      {/* ── Conversations ── */}
      <Panel title="Conversations">
        {conversations.length === 0 ? (
          <EmptyState
            heading="No conversations yet"
            description="Create one to start your first persistent workspace."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {conversations.map((item) => (
              <button
                key={item.conversation.id}
                onClick={() => onSelectConversation(item.conversation.id)}
                className={`w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150 border
                  ${
                    activeConversationId === item.conversation.id
                      ? "border-l-2 border-l-accent-teal border-border-active bg-[rgba(23,42,49,0.6)]"
                      : "border-transparent hover:bg-[rgba(255,255,255,0.03)]"
                  }`}
              >
                <p className="text-sm font-medium text-text-primary truncate">
                  {item.conversation.title}
                </p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {item.sessionCount} sessions · {item.sourceCount} sources
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  {formatRelativeTime(
                    item.conversation.lastActivityAt ?? item.conversation.updatedAt
                  )}
                </p>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Session History ── */}
      <Panel title="Session History" subtle>
        {sessions.length === 0 ? (
          <EmptyState
            heading="No sessions yet"
            description="Start a live call to begin coaching."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`w-full text-left rounded-lg px-3 py-2 transition-all duration-150 border
                  ${
                    selectedSessionId === s.id
                      ? "border-l-2 border-l-accent-teal border-border-active bg-[rgba(23,42,49,0.6)]"
                      : "border-transparent hover:bg-[rgba(255,255,255,0.03)]"
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-text-secondary truncate">
                    {new Date(s.startedAt ?? s.createdAt ?? "").toLocaleString(
                      undefined,
                      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                    )}
                  </p>
                  <StatusBadge
                    tone={sessionStatusTone(s.status)}
                    pulse={s.status === "live" || s.status === "reconnecting"}
                  >
                    {s.status}
                  </StatusBadge>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Sources ── */}
      <Panel title="Sources" subtle>
        {/* Upload zone */}
        <div
          className={`relative rounded-lg border-2 border-dashed transition-colors duration-200 mb-3 cursor-pointer
            ${dragOver ? "border-accent-teal bg-accent-teal/5" : "border-border-subtle hover:border-border-default"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex items-center justify-center py-3 px-4">
            <span className="text-xs text-text-secondary">
              {uploading ? "Uploading…" : dragOver ? "Drop file here" : "↑ Upload source"}
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
        </div>

        {sources.length === 0 ? (
          <p className="text-xs text-text-muted leading-relaxed">
            Upload prompt notes, resumes, or presentation material to attach them to
            this conversation.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 bg-[rgba(255,255,255,0.02)]"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">
                    {source.filename}
                  </p>
                  <p className="text-[10px] text-text-muted">
                    {source.sizeBytes
                      ? `${Math.round(source.sizeBytes / 1024)} KB`
                      : "—"}
                  </p>
                </div>
                <StatusBadge
                  tone={sourceStatusTone(source.processingStatus)}
                  pulse={source.processingStatus === "pending"}
                >
                  {source.processingStatus}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </aside>
  );
}
