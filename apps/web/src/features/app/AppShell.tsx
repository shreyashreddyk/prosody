import type { Session } from "@prosody/contracts";
import { Panel, SectionTitle, StatusBadge } from "@prosody/ui";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { createConversation, loadBootstrap, loadConversationWorkspace, uploadSource } from "./data";
import { LiveSessionPanel } from "./LiveSessionPanel";

function formatDate(value?: string) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

export function AppShell() {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const { user, session, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("Prosody user");
  const [conversations, setConversations] = useState<Awaited<ReturnType<typeof loadBootstrap>>["conversations"]>([]);
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof loadConversationWorkspace>> | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refreshBootstrap = async (preferredConversationId?: string) => {
    if (!user) {
      return;
    }
    const bootstrap = await loadBootstrap(user);
    setProfileName(bootstrap.profile.displayName ?? bootstrap.profile.email ?? "Prosody user");
    setConversations(bootstrap.conversations);

    const targetConversationId = preferredConversationId ?? conversationId ?? bootstrap.selectedConversationId;
    if (targetConversationId) {
      navigate(`/app/conversations/${targetConversationId}`, { replace: !conversationId });
    }
  };

  const refreshWorkspace = async (targetConversationId: string) => {
    const nextWorkspace = await loadConversationWorkspace(targetConversationId);
    setWorkspace(nextWorkspace);
    setSelectedSessionId((current) => current ?? nextWorkspace.sessions[0]?.id);
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    setLoading(true);
    void refreshBootstrap()
      .then(async () => {
        const targetConversationId = conversationId;
        if (targetConversationId) {
          await refreshWorkspace(targetConversationId);
        }
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load Prosody");
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!conversationId) {
      setWorkspace(null);
      return;
    }
    void refreshWorkspace(conversationId).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load conversation workspace");
    });
  }, [conversationId]);

  if (!session || !user) {
    return <Navigate to="/" replace />;
  }

  const activeConversationId = conversationId ?? conversations[0]?.conversation.id;

  const handleCreateConversation = async () => {
    try {
      const created = await createConversation(user.id, `Conversation ${conversations.length + 1}`);
      await refreshBootstrap(created.id);
      await refreshWorkspace(created.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create conversation");
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !activeConversationId) {
      return;
    }
    try {
      setUploading(true);
      await uploadSource(user.id, activeConversationId, file);
      await refreshWorkspace(activeConversationId);
      await refreshBootstrap(activeConversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to upload source");
    } finally {
      setUploading(false);
    }
  };

  const handleSessionCreated = async (createdSession: Session) => {
    setSelectedSessionId(createdSession.id);
    if (activeConversationId) {
      await refreshBootstrap(activeConversationId);
      await refreshWorkspace(activeConversationId);
    }
  };

  const handleSessionEnded = async () => {
    if (activeConversationId) {
      await refreshBootstrap(activeConversationId);
      await refreshWorkspace(activeConversationId);
    }
  };

  if (loading) {
    return <div className="app-shell-loading">Loading your Prosody workspace…</div>;
  }

  return (
    <main className="product-shell">
      <header className="product-header">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h1>{profileName}</h1>
          <p className="muted-copy">Prosody reopens your most recent conversation and keeps every live session attached to it.</p>
        </div>
        <div className="header-actions">
          <button className="primary-button" onClick={() => void handleCreateConversation()}>
            New conversation
          </button>
          <button className="secondary-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {errorMessage ? <p className="inline-error app-level-error">{errorMessage}</p> : null}

      <section className="three-pane-layout">
        <aside className="pane-left">
          <Panel title="Conversations">
            <div className="conversation-list">
              {conversations.length === 0 ? <p className="muted-copy">No conversations yet. Create one to start your first persistent workspace.</p> : null}
              {conversations.map((item) => (
                <button
                  key={item.conversation.id}
                  className={`conversation-item ${activeConversationId === item.conversation.id ? "conversation-item-active" : ""}`}
                  onClick={() => navigate(`/app/conversations/${item.conversation.id}`)}
                >
                  <strong>{item.conversation.title}</strong>
                  <span>{item.sessionCount} sessions · {item.sourceCount} sources</span>
                  <span>Updated {formatDate(item.conversation.lastActivityAt ?? item.conversation.updatedAt)}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Session History" subtle>
            {workspace?.sessions.length ? (
              <div className="session-list">
                {workspace.sessions.map((item) => (
                  <button
                    key={item.id}
                    className={`session-item ${selectedSessionId === item.id ? "session-item-active" : ""}`}
                    onClick={() => setSelectedSessionId(item.id)}
                  >
                    <strong>{item.transportKind}</strong>
                    <span>{item.status}</span>
                    <span>{formatDate(item.startedAt ?? item.createdAt)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted-copy">Sessions will accumulate here as the conversation grows.</p>
            )}
          </Panel>

          <Panel title="Sources" subtle>
            <label className="upload-control">
              <span>{uploading ? "Uploading…" : "Upload source"}</span>
              <input type="file" onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)} />
            </label>
            <div className="source-list">
              {workspace?.sources.length ? (
                workspace.sources.map((source) => (
                  <div key={source.id} className="source-item">
                    <strong>{source.filename}</strong>
                    <span>{source.processingStatus}</span>
                    <span>{source.sizeBytes ? `${Math.round(source.sizeBytes / 1024)} KB` : "size unavailable"}</span>
                  </div>
                ))
              ) : (
                <p className="muted-copy">Upload prompt notes, resumes, or presentation material to attach them to this conversation.</p>
              )}
            </div>
          </Panel>
        </aside>

        <section className="pane-center">
          {activeConversationId ? (
            <LiveSessionPanel
              accessToken={session.access_token}
              conversationId={activeConversationId}
              selectedSessionId={selectedSessionId}
              onSessionCreated={handleSessionCreated}
              onSessionEnded={handleSessionEnded}
            />
          ) : (
            <Panel title="Conversation Workspace">
              <p className="muted-copy">Create a conversation to unlock live voice coaching, transcript history, and source attachments.</p>
            </Panel>
          )}
        </section>

        <aside className="pane-right">
          <Panel title="Summary">
            <SectionTitle>Conversation recap</SectionTitle>
            <p>{workspace?.summary?.summaryText ?? "No summary has been generated yet for this conversation."}</p>
          </Panel>

          <Panel title="Flashcards" subtle>
            <SectionTitle>Study set</SectionTitle>
            {workspace?.flashcardSet?.cards.length ? (
              <div className="flashcard-list">
                {workspace.flashcardSet.cards.map((card) => (
                  <article key={card.id} className="flashcard-item">
                    <strong>{card.prompt}</strong>
                    <p>{card.answer}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-copy">Flashcards are schema-ready and will appear here when generation is wired in a later step.</p>
            )}
          </Panel>

          <Panel title="Workspace Metrics" subtle>
            <SectionTitle>Persistence health</SectionTitle>
            <div className="metric-card">
              <span>Selected conversation</span>
              <strong>{workspace?.conversation.title ?? "None"}</strong>
            </div>
            <div className="metric-card">
              <span>Turns in history</span>
              <strong>{workspace?.turns.length ?? 0}</strong>
            </div>
            <div className="metric-card">
              <span>Latest session</span>
              <strong>{workspace?.sessions[0]?.status ?? "No sessions"}</strong>
            </div>
            <div className="metric-card">
              <span>Auth isolation</span>
              <StatusBadge tone="success">user scoped</StatusBadge>
            </div>
          </Panel>
        </aside>
      </section>
    </main>
  );
}
