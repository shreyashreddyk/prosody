import { useEffect, useState } from "react";
import type { Conversation, DegradationEvent, FlashcardSet, Session, Source } from "@prosody/contracts";
import { Panel, SectionTitle, StatusBadge } from "@prosody/ui";

type AgentHealth = "checking" | "ready" | "offline";

const previewConversation: Conversation = {
  id: "conv_demo",
  title: "Staff interview prep",
  status: "active",
  createdAt: "2026-04-20T12:00:00.000Z",
  updatedAt: "2026-04-20T12:30:00.000Z",
  lastSessionId: "sess_demo",
  summary: "Focus on concise storytelling, strong examples, and pacing."
};

const previewSession: Session = {
  id: "sess_demo",
  conversationId: "conv_demo",
  transportKind: "smallwebrtc",
  status: "idle",
  startedAt: "2026-04-20T12:05:00.000Z"
};

const previewSources: Source[] = [
  {
    id: "src_resume",
    conversationId: "conv_demo",
    kind: "document",
    filename: "resume.pdf",
    mimeType: "application/pdf",
    processingStatus: "ready",
    storagePath: "sources/conv_demo/resume.pdf"
  },
  {
    id: "src_job",
    conversationId: "conv_demo",
    kind: "notes",
    filename: "job-notes.md",
    mimeType: "text/markdown",
    processingStatus: "processing"
  }
];

const previewFlashcards: FlashcardSet = {
  id: "flash_demo",
  conversationId: "conv_demo",
  generatedAt: "2026-04-20T12:40:00.000Z",
  cards: [
    {
      id: "card_1",
      prompt: "Describe a system you designed under latency constraints.",
      answer: "Frame the constraints, the tradeoffs, and how you measured success.",
      tags: ["systems", "latency"]
    },
    {
      id: "card_2",
      prompt: "How do you recover when a presentation loses momentum?",
      answer: "Reset the structure, restate the goal, and re-engage with a concrete example.",
      tags: ["presenting", "recovery"]
    }
  ]
};

const previewDegradation: DegradationEvent = {
  id: "deg_demo",
  conversationId: "conv_demo",
  sessionId: "sess_demo",
  category: "transport",
  severity: "info",
  message: "Camera coaching is unavailable in the current scaffold and will degrade to voice-only guidance.",
  createdAt: "2026-04-20T12:45:00.000Z"
};

function App() {
  const [agentHealth, setAgentHealth] = useState<AgentHealth>("checking");

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      try {
        const baseUrl = import.meta.env.VITE_AGENT_BASE_URL ?? "http://127.0.0.1:8000";
        const response = await fetch(`${baseUrl}/health/ready`);

        if (!cancelled) {
          setAgentHealth(response.ok ? "ready" : "offline");
        }
      } catch {
        if (!cancelled) {
          setAgentHealth("offline");
        }
      }
    };

    void checkHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Realtime interview and presentation coaching</p>
        <h1>Prosody</h1>
        <p className="hero-copy">
          A production-style multimodal coaching workspace with persistent conversations, live session controls,
          transcript history, flashcards, and latency-aware system feedback.
        </p>
        <div className="hero-actions">
          <button className="primary-button" type="button">
            View product shell
          </button>
          <button className="secondary-button" type="button">
            Sign in with Google
          </button>
        </div>
      </header>

      <main className="workspace-preview">
        <Panel title="Workspace">
          <div className="workspace-header">
            <div>
              <SectionTitle>Authenticated preview shell</SectionTitle>
              <p className="muted">
                This layout reserves the three-pane product model without implementing auth, persistence, or realtime
                transport yet.
              </p>
            </div>
            <StatusBadge tone={agentHealth === "ready" ? "success" : agentHealth === "checking" ? "warning" : "danger"}>
              Agent {agentHealth}
            </StatusBadge>
          </div>

          <div className="three-pane-layout">
            <Panel title="Conversations and Sources" subtle>
              <SectionTitle>{previewConversation.title}</SectionTitle>
              <p className="muted">Conversation status: {previewConversation.status}</p>
              <p className="muted">Last session: {previewConversation.lastSessionId}</p>
              <ul className="list">
                {previewSources.map((source) => (
                  <li key={source.id}>
                    <strong>{source.filename}</strong>
                    <span>{source.processingStatus}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Transcript and Live Controls" subtle>
              <SectionTitle>Session {previewSession.id}</SectionTitle>
              <p className="muted">Transport target: {previewSession.transportKind}</p>
              <p className="muted">Current state: {previewSession.status}</p>
              <div className="transcript-card">
                <p className="speaker">Coach</p>
                <p>
                  Welcome back. This scaffold reserves the future transcript stream, turn history, and live voice
                  controls.
                </p>
              </div>
              <div className="control-row">
                <button className="primary-button" type="button">
                  Start session
                </button>
                <button className="secondary-button" type="button">
                  Upload source
                </button>
              </div>
            </Panel>

            <Panel title="Summary, Flashcards, and Metrics" subtle>
              <SectionTitle>Conversation summary</SectionTitle>
              <p className="muted">{previewConversation.summary}</p>
              <SectionTitle>Flashcards</SectionTitle>
              <ul className="list">
                {previewFlashcards.cards.map((card) => (
                  <li key={card.id}>
                    <strong>{card.prompt}</strong>
                    <span>{card.answer}</span>
                  </li>
                ))}
              </ul>
              <SectionTitle>Degraded-mode preview</SectionTitle>
              <p className="muted">{previewDegradation.message}</p>
            </Panel>
          </div>
        </Panel>
      </main>
    </div>
  );
}

export default App;
