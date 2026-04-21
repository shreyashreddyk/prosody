import type { Session } from "@prosody/contracts";
import { LoadingSpinner } from "@prosody/ui";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { createConversation, loadBootstrap, loadConversationWorkspace, uploadSource } from "./data";
import { getAgentBaseUrl } from "../../lib/supabase";
import { AppHeader } from "./AppHeader";
import { LeftPane } from "./LeftPane";
import { CenterPane } from "./CenterPane";
import { RightPane } from "./RightPane";
import { useLiveSession } from "./LiveSessionPanel";

function formatRelativeTime(value?: string) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AppShell() {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const { user, session: authSession, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("Prosody user");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [conversations, setConversations] = useState<Awaited<ReturnType<typeof loadBootstrap>>["conversations"]>([]);
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof loadConversationWorkspace>> | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);

  const activeConversationId = conversationId ?? conversations[0]?.conversation.id;

  /* ── Data loading ── */

  const refreshBootstrap = async (preferredConversationId?: string) => {
    if (!user) return;
    const bootstrap = await loadBootstrap(user);
    setProfileName(bootstrap.profile.displayName ?? bootstrap.profile.email ?? "Prosody user");
    setAvatarUrl(bootstrap.profile.avatarUrl);
    setConversations(bootstrap.conversations);

    const targetConversationId = preferredConversationId ?? conversationId ?? bootstrap.selectedConversationId;
    if (targetConversationId) {
      navigate(`/app/conversations/${targetConversationId}`, { replace: !conversationId });
    }
  };

  const refreshWorkspace = async (targetConversationId: string) => {
    const nextWorkspace = await loadConversationWorkspace(targetConversationId);
    setWorkspace(nextWorkspace);
    setSelectedSessionId((current) => {
      if (!current) {
        return nextWorkspace.sessions[0]?.id;
      }
      return nextWorkspace.sessions.some((session) => session.id === current)
        ? current
        : nextWorkspace.sessions[0]?.id;
    });
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    void refreshBootstrap()
      .then(async () => {
        const targetConversationId = conversationId;
        if (targetConversationId) {
          await refreshWorkspace(targetConversationId);
        }
        // Show welcome-back for returning users
        setShowWelcome(true);
        setTimeout(() => setShowWelcome(false), 5000);
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

  /* ── Live session hook ── */

  const liveSession = useLiveSession({
    accessToken: authSession?.access_token ?? "",
    conversationId: activeConversationId ?? "",
    selectedSessionId,
    onSessionCreated: async (createdSession: Session) => {
      setSelectedSessionId(createdSession.id);
      if (activeConversationId) {
        await refreshBootstrap(activeConversationId);
        await refreshWorkspace(activeConversationId);
      }
    },
    onSessionEnded: async () => {
      if (activeConversationId) {
        await refreshBootstrap(activeConversationId);
        await refreshWorkspace(activeConversationId);
      }
    },
  });

  /* ── Handlers ── */

  const handleCreateConversation = async () => {
    try {
      const created = await createConversation(user!.id, `Conversation ${conversations.length + 1}`);
      await refreshBootstrap(created.id);
      await refreshWorkspace(created.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create conversation");
    }
  };

  const handleUpload = async (file: File) => {
    if (!activeConversationId) return;
    try {
      setUploading(true);
      await uploadSource(user!.id, activeConversationId, file);
      await refreshWorkspace(activeConversationId);
      await refreshBootstrap(activeConversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to upload source");
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!activeConversationId || !authSession) return;
    try {
      setSummaryLoading(true);
      const response = await fetch(
        `${getAgentBaseUrl()}/api/conversations/${activeConversationId}/summary`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authSession.access_token}`,
          },
        }
      );
      if (!response.ok) throw new Error("Unable to generate summary");
      await refreshWorkspace(activeConversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Summary generation failed");
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleGenerateFlashcards = async (sessionId: string) => {
    if (!activeConversationId || !authSession) return;
    try {
      setFlashcardsLoading(true);
      const response = await fetch(
        `${getAgentBaseUrl()}/api/conversations/${activeConversationId}/sessions/${sessionId}/flashcards`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authSession.access_token}`,
          },
        }
      );
      if (!response.ok) throw new Error("Unable to generate flashcards");
      await refreshWorkspace(activeConversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Flashcard generation failed");
    } finally {
      setFlashcardsLoading(false);
    }
  };

  /* ── Guards ── */

  if (!authSession || !user) {
    return <Navigate to="/" replace />;
  }

  /* ── Loading state ── */

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-bg-primary">
        <LoadingSpinner size={32} />
        <p className="text-text-secondary text-sm">Loading your Prosody workspace…</p>
      </div>
    );
  }

  /* ── First-time user: no conversations ── */

  const isFirstTime = conversations.length === 0;

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden">
      <AppHeader
        profileName={profileName}
        avatarUrl={avatarUrl}
        onSignOut={() => void signOut()}
        onNewConversation={() => void handleCreateConversation()}
      />

      {/* Error banner */}
      {errorMessage && (
        <div className="px-5 py-2 bg-surface-danger border-b border-accent-red/20">
          <p className="text-xs text-accent-red">{errorMessage}</p>
        </div>
      )}

      {/* Welcome-back banner */}
      {showWelcome && !isFirstTime && workspace && (
        <div className="px-5 py-2 bg-surface-info border-b border-accent-blue/20 animate-fade-in">
          <p className="text-xs text-accent-blue">
            Welcome back — continuing "{workspace.conversation.title}"{" "}
            <span className="text-text-muted">
              (last activity {formatRelativeTime(workspace.conversation.lastActivityAt ?? workspace.conversation.updatedAt)})
            </span>
          </p>
        </div>
      )}

      {/* Three-pane layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-0 overflow-hidden">
        {/* Left pane */}
        <div className="hidden lg:block border-r border-border-subtle p-3 overflow-hidden">
          <LeftPane
            conversations={conversations}
            activeConversationId={activeConversationId}
            sessions={workspace?.sessions ?? []}
            sources={workspace?.sources ?? []}
            selectedSessionId={selectedSessionId}
            uploading={uploading}
            onSelectConversation={(id) => navigate(`/app/conversations/${id}`)}
            onSelectSession={(id) => setSelectedSessionId(id)}
            onUpload={(file) => void handleUpload(file)}
          />
        </div>

        {/* Center pane */}
        <div className="overflow-hidden">
          {isFirstTime ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 animate-fade-in">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-teal mb-3">
                Welcome to Prosody
              </p>
              <h2 className="text-2xl font-bold mb-3">
                Create your first workspace
              </h2>
              <p className="text-text-secondary text-sm max-w-sm mb-6 leading-relaxed">
                A workspace holds your coaching sessions, uploaded sources,
                transcripts, summaries, and flashcards — all in one place.
              </p>
              <button
                className="btn-primary text-sm px-6 py-2.5"
                onClick={() => void handleCreateConversation()}
              >
                + Create workspace
              </button>
              <p className="text-text-muted text-xs mt-4 max-w-xs leading-relaxed">
                After creating a workspace, upload your resume or prompt notes,
                then start a live session.
              </p>
            </div>
          ) : (
            <CenterPane
              connectionState={liveSession.connectionState}
              transcriptRows={liveSession.transcriptRows}
              allSessions={workspace?.sessions ?? []}
              allTurns={workspace?.turns ?? []}
              currentLiveSessionId={liveSession.session?.id}
              degradationEvents={liveSession.degradationEvents}
              errorMessage={liveSession.errorMessage}
              hasConversation={!!activeConversationId}
              onStart={() => void liveSession.startSession()}
              onEnd={() => void liveSession.endSession()}
            />
          )}
        </div>

        {/* Right pane */}
        <div className="hidden lg:block border-l border-border-subtle p-3 overflow-hidden">
          <RightPane
            summary={workspace?.summary}
            flashcardSet={workspace?.flashcardSet}
            turnTimings={liveSession.turnTimings}
            rollingMetrics={liveSession.rollingMetrics}
            degradationEvents={liveSession.degradationEvents}
            replayStatus={liveSession.replayStatus}
            sessions={workspace?.sessions ?? []}
            selectedSessionId={selectedSessionId}
            summaryLoading={summaryLoading}
            flashcardsLoading={flashcardsLoading}
            onGenerateSummary={() => void handleGenerateSummary()}
            onGenerateFlashcards={(sessionId) => void handleGenerateFlashcards(sessionId)}
          />
        </div>
      </div>
    </div>
  );
}
