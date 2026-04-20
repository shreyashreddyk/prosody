import { useEffect, useRef, useState } from "react";
import { PipecatClient, type RTVIMessage, type TransportState } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import type {
  LatencyEvent,
  ReplayArtifactStatus,
  RealtimeConnectionState,
  RollingLatencyMetrics,
  Session,
  SessionTimelineResponse,
  TranscriptEvent,
  TurnTimingRecord
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
  createdAt: string;
};

const SESSION_STORAGE_KEY = "prosody.local.sessionId";

const STAGE_ROWS: Array<{ label: string; value: (turn: TurnTimingRecord) => number | undefined }> = [
  { label: "First ASR partial", value: (turn) => turn.durations.firstAsrPartialMs },
  { label: "Final ASR", value: (turn) => turn.durations.finalAsrMs },
  { label: "LLM first token", value: (turn) => turn.durations.llmFirstTokenMs },
  { label: "TTS first byte", value: (turn) => turn.durations.ttsFirstByteMs },
  { label: "Playback start", value: (turn) => turn.durations.playbackStartMs },
  { label: "Turn completed", value: (turn) => turn.durations.turnCompletedMs }
];

const ROLLING_ROWS: Array<{ label: string; metric: keyof RollingLatencyMetrics }> = [
  { label: "First ASR partial", metric: "firstAsrPartial" },
  { label: "Final ASR", metric: "finalAsr" },
  { label: "LLM first token", metric: "llmFirstToken" },
  { label: "TTS first byte", metric: "ttsFirstByte" },
  { label: "Playback start", metric: "playbackStart" },
  { label: "Turn completed", metric: "turnCompleted" }
];

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
    const key = `${event.turnId}:${event.role}`;
    rows.set(key, {
      id: key,
      role: event.role,
      text: event.text,
      final: event.kind === "final",
      createdAt: event.createdAt
    });
  }

  return Array.from(rows.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function formatMs(value?: number) {
  return value == null ? "--" : `${Math.round(value)} ms`;
}

function latestTurn(turns: TurnTimingRecord[]) {
  const ordered = [...turns].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return ordered.length === 0 ? null : ordered[ordered.length - 1];
}

export function LocalSessionPage() {
  const clientRef = useRef<PipecatClient | null>(null);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>("idle");
  const [session, setSession] = useState<Session | null>(null);
  const [transcriptRows, setTranscriptRows] = useState<TranscriptRow[]>([]);
  const [latencyEvents, setLatencyEvents] = useState<LatencyEvent[]>([]);
  const [turnTimings, setTurnTimings] = useState<TurnTimingRecord[]>([]);
  const [rollingMetrics, setRollingMetrics] = useState<RollingLatencyMetrics | null>(null);
  const [degradationCount, setDegradationCount] = useState(0);
  const [replayStatus, setReplayStatus] = useState<ReplayArtifactStatus>({ available: false });
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [agentHealth, setAgentHealth] = useState<"checking" | "ready" | "offline">("checking");

  const upsertRow = (row: TranscriptRow) => {
    setTranscriptRows((current) => {
      const next = new Map(current.map((item) => [item.id, item]));
      next.set(row.id, row);
      return Array.from(next.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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

  const fetchTimeline = async (sessionId: string) => {
    const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/timeline`);
    if (!response.ok) {
      throw new Error("Unable to load session timeline");
    }
    const payload = (await response.json()) as SessionTimelineResponse;
    setTurnTimings(payload.turnTimings);
    setRollingMetrics(payload.rollingMetrics);
    setDegradationCount(payload.degradationEvents.length);
    setReplayStatus(payload.replayArtifactStatus);
    setTimelineError(null);
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
    void fetchTimeline(existingSessionId).catch((error: unknown) => {
      setTimelineError(error instanceof Error ? error.message : "Unable to load metrics");
    });
  }, []);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchEvents(session.id).catch(() => undefined);
      void fetchTimeline(session.id).catch((error: unknown) => {
        setTimelineError(error instanceof Error ? error.message : "Unable to load metrics");
      });
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
    setTimelineError(null);
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
      setTurnTimings([]);
      setRollingMetrics(null);
      setDegradationCount(0);
      setReplayStatus({ available: false });
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
              id: `live:user:${data.timestamp}`,
              role: "user",
              text: data.text,
              final: data.final,
              createdAt: data.timestamp
            });
          },
          onBotLlmStarted: () => {
            upsertRow({
              id: "assistant-live",
              role: "assistant",
              text: "",
              final: false,
              createdAt: new Date().toISOString()
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
      await fetchTimeline(payload.session.id);
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
        await fetchTimeline(activeSessionId);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to end the local session");
    } finally {
      setConnectionState("ended");
    }
  };

  const latest = latestTurn(turnTimings);

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Prosody v2</p>
        <h1>Observable Realtime Voice Loop</h1>
        <p className="hero-copy">
          Local-only Pipecat voice session with normalized timing events, replayable session artifacts, and a live
          metrics panel.
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
          <StatusBadge tone={replayStatus.available ? "success" : "warning"}>
            Replay {replayStatus.available ? "ready" : "pending"}
          </StatusBadge>
        </div>

        <div className="local-layout">
          <Panel title="Controls">
            <SectionTitle>Session</SectionTitle>
            <p className="muted">Local transport: `SmallWebRTCTransport`</p>
            <p className="muted">Current session: {session?.id ?? "none"}</p>
            <p className="muted">Replay artifact: {replayStatus.path ?? "not generated yet"}</p>
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
            <SectionTitle>Raw milestones</SectionTitle>
            <ul className="list compact-list">
              {latencyEvents.length === 0 ? (
                <li>
                  <span>No latency events recorded yet.</span>
                </li>
              ) : (
                latencyEvents.map((event) => (
                  <li key={event.id}>
                    <strong>{event.stage}</strong>
                    <span>{event.durationMs == null ? event.startedAt : `${Math.round(event.durationMs)} ms`}</span>
                  </li>
                ))
              )}
            </ul>
          </Panel>

          <Panel title="Metrics">
            <SectionTitle>Latest turn breakdown</SectionTitle>
            {timelineError ? <p className="error-copy">{timelineError}</p> : null}
            {!latest ? (
              <p className="muted">No completed or partial turn timings yet.</p>
            ) : (
              <div className="metrics-stack">
                <div className="metric-banner">
                  <span>Turn {latest.turnId}</span>
                  <span>{latest.status}</span>
                </div>
                <ul className="list compact-list">
                  {STAGE_ROWS.map((row) => (
                    <li key={row.label}>
                      <strong>{row.label}</strong>
                      <span>{formatMs(row.value(latest))}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted">Missing stages: {latest.missingStages.length === 0 ? "none" : latest.missingStages.join(", ")}</p>
              </div>
            )}

            <SectionTitle>Rolling p50 / p95</SectionTitle>
            {rollingMetrics == null ? (
              <p className="muted">Rolling metrics will populate after timeline data arrives.</p>
            ) : (
              <ul className="list compact-list">
                {ROLLING_ROWS.map(({ label, metric }) => (
                  <li key={metric}>
                    <strong>{label}</strong>
                    <span>
                      p50 {formatMs(rollingMetrics[metric].p50Ms)} / p95 {formatMs(rollingMetrics[metric].p95Ms)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <SectionTitle>Degraded markers</SectionTitle>
            <p className="muted">
              {degradationCount === 0
                ? "No degraded events recorded yet. Placeholder is ready for future fallback markers."
                : `${degradationCount} degraded events recorded.`}
            </p>
          </Panel>
        </div>
      </main>
    </div>
  );
}
