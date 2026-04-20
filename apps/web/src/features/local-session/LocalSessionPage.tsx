import { useEffect, useRef, useState } from "react";
import { PipecatClient, type RTVIMessage, type TransportState } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import type {
  LatencyEvent,
  RealtimeConnectionState,
  Session,
  TranscriptEvent
} from "@prosody/contracts";
import { Panel, SectionTitle, StatusBadge } from "@prosody/ui";

type LocalSessionCreateResponse = {
  conversationId: string;
  session: Session;
  offerEndpoint: string;
};

type LocalSessionEventsResponse = {
  session: Session;
  transcriptEvents: TranscriptEvent[];
  latencyEvents: LatencyEvent[];
};

type TranscriptRow = {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
};

const SESSION_STORAGE_KEY = "prosody.local.sessionId";

function getAgentBaseUrl() {
  return import.meta.env.VITE_AGENT_BASE_URL ?? "http://127.0.0.1:8000";
}

function mapTransportState(state: TransportState): RealtimeConnectionState {
  if (state === "connecting" || state === "initializing" || state === "initialized") {
    return "connecting";
  }
  if (state === "connected" || state === "ready") {
    return "connected";
  }
  if (state === "disconnecting") {
    return "ending";
  }
  if (state === "error") {
    return "failed";
  }
  return "idle";
}

function mergeTranscriptEvents(events: TranscriptEvent[]): TranscriptRow[] {
  const rows = new Map<string, TranscriptRow>();

  for (const event of events) {
    rows.set(event.turnId, {
      id: event.turnId,
      role: event.role,
      text: event.text,
      final: event.kind === "final"
    });
  }

  return Array.from(rows.values());
}

export function LocalSessionPage() {
  const clientRef = useRef<PipecatClient | null>(null);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>("idle");
  const [session, setSession] = useState<Session | null>(null);
  const [transcriptRows, setTranscriptRows] = useState<TranscriptRow[]>([]);
  const [latencyEvents, setLatencyEvents] = useState<LatencyEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [agentHealth, setAgentHealth] = useState<"checking" | "ready" | "offline">("checking");

  const upsertRow = (row: TranscriptRow) => {
    setTranscriptRows((current) => {
      const next = new Map(current.map((item) => [item.id, item]));
      next.set(row.id, row);
      return Array.from(next.values());
    });
  };

  const fetchEvents = async (sessionId: string) => {
    const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/events`);
    if (!response.ok) {
      throw new Error("Unable to load session events");
    }
    const payload = (await response.json()) as LocalSessionEventsResponse;
    setSession(payload.session);
    setTranscriptRows(mergeTranscriptEvents(payload.transcriptEvents));
    setLatencyEvents(payload.latencyEvents);
  };

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      try {
        const response = await fetch(`${getAgentBaseUrl()}/health/ready`);
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

  useEffect(() => {
    const existingSessionId =
      new URLSearchParams(window.location.search).get("sessionId") ?? localStorage.getItem(SESSION_STORAGE_KEY);

    if (!existingSessionId) {
      return;
    }

    void fetchEvents(existingSessionId).catch(() => {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    });
  }, []);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchEvents(session.id).catch(() => undefined);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [session?.id]);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        void clientRef.current.disconnect();
      }
    };
  }, []);

  const handleStart = async () => {
    setErrorMessage(null);
    setConnectionState("connecting");

    try {
      const createResponse = await fetch(`${getAgentBaseUrl()}/api/local/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      if (!createResponse.ok) {
        throw new Error("Unable to create local session");
      }

      const payload = (await createResponse.json()) as LocalSessionCreateResponse;
      setSession(payload.session);
      setTranscriptRows([]);
      setLatencyEvents([]);
      localStorage.setItem(SESSION_STORAGE_KEY, payload.session.id);
      const url = new URL(window.location.href);
      url.searchParams.set("sessionId", payload.session.id);
      window.history.replaceState({}, "", url);

      const client = new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onTransportStateChanged: (state) => {
            setConnectionState(mapTransportState(state));
          },
          onBotReady: () => {
            setConnectionState("live");
          },
          onUserTranscript: (data) => {
            upsertRow({
              id: `user-${data.timestamp}`,
              role: "user",
              text: data.text,
              final: data.final
            });
          },
          onBotLlmStarted: () => {
            upsertRow({
              id: "assistant-live",
              role: "assistant",
              text: "",
              final: false
            });
          },
          onBotLlmText: (data) => {
            setTranscriptRows((current) =>
              current.map((row) =>
                row.id === "assistant-live"
                  ? { ...row, text: `${row.text}${data.text}`, final: false }
                  : row
              )
            );
          },
          onBotLlmStopped: () => {
            setTranscriptRows((current) =>
              current.map((row) => (row.id === "assistant-live" ? { ...row, final: true } : row))
            );
          },
          onError: (message: RTVIMessage) => {
            setConnectionState("failed");
            setErrorMessage((message.data as { message?: string } | undefined)?.message ?? "Session failed");
          }
        }
      });

      clientRef.current = client;
      await client.connect({
        webrtcRequestParams: {
          endpoint: payload.offerEndpoint
        }
      });
      await fetchEvents(payload.session.id);
    } catch (error) {
      setConnectionState("failed");
      setErrorMessage(error instanceof Error ? error.message : "Unable to start the local session");
    }
  };

  const handleEnd = async () => {
    const activeSessionId = session?.id;
    setConnectionState("ending");

    try {
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }

      if (activeSessionId) {
        await fetch(`${getAgentBaseUrl()}/api/local/sessions/${activeSessionId}/end`, {
          method: "POST"
        });
        await fetchEvents(activeSessionId);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to end the local session");
    } finally {
      setConnectionState("ended");
    }
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Prosody v1</p>
        <h1>Local Realtime Voice Loop</h1>
        <p className="hero-copy">
          Local-only Pipecat voice session with SmallWebRTC transport, live transcripts, and persisted latency
          events.
        </p>
      </header>

      <main className="workspace-preview">
        <div className="status-row">
          <StatusBadge tone={agentHealth === "ready" ? "success" : agentHealth === "checking" ? "warning" : "danger"}>
            Agent {agentHealth}
          </StatusBadge>
          <StatusBadge tone={connectionState === "failed" ? "danger" : connectionState === "live" ? "success" : "warning"}>
            Session {connectionState}
          </StatusBadge>
        </div>

        <div className="local-layout">
          <Panel title="Controls">
            <SectionTitle>Session</SectionTitle>
            <p className="muted">Local transport: `SmallWebRTCTransport`</p>
            <p className="muted">Current session: {session?.id ?? "none"}</p>
            <div className="control-row">
              <button className="primary-button" type="button" onClick={handleStart} disabled={connectionState === "connecting" || connectionState === "live"}>
                Start session
              </button>
              <button className="secondary-button" type="button" onClick={handleEnd} disabled={!session || connectionState === "idle" || connectionState === "ended"}>
                End session
              </button>
            </div>
            {errorMessage ? <p className="error-copy">{errorMessage}</p> : null}
          </Panel>

          <Panel title="Transcript">
            <SectionTitle>Live transcript</SectionTitle>
            <div className="transcript-list">
              {transcriptRows.length === 0 ? (
                <p className="muted">No transcript yet. Start a session and speak a short prompt.</p>
              ) : (
                transcriptRows.map((row) => (
                  <div key={row.id} className="transcript-card">
                    <p className="speaker">{row.role}</p>
                    <p>{row.text || "..."}</p>
                    <p className="muted">{row.final ? "final" : "live"}</p>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Latency">
            <SectionTitle>Captured milestones</SectionTitle>
            <ul className="list">
              {latencyEvents.length === 0 ? (
                <li>
                  <span>No latency events recorded yet.</span>
                </li>
              ) : (
                latencyEvents.map((event) => (
                  <li key={event.id}>
                    <strong>{event.stage}</strong>
                    <span>{event.durationMs ? `${Math.round(event.durationMs)} ms` : event.startedAt}</span>
                  </li>
                ))
              )}
            </ul>
          </Panel>
        </div>
      </main>
    </div>
  );
}
