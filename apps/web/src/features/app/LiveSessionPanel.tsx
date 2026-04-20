import { useEffect, useRef, useState } from "react";
import { PipecatClient, type RTVIMessage, type TransportState } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import type {
  DegradationEvent,
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
import { getAgentBaseUrl } from "../../lib/supabase";

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
  turnId: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  createdAt: string;
};

type LiveSessionPanelProps = {
  accessToken: string;
  conversationId: string;
  selectedSessionId?: string;
  onSessionCreated: (session: Session) => void;
  onSessionEnded: () => void;
};

const STAGE_ROWS: Array<{ label: string; value: (turn: TurnTimingRecord) => number | undefined }> = [
  { label: "First ASR partial", value: (turn) => turn.durations.firstAsrPartialMs },
  { label: "Final ASR", value: (turn) => turn.durations.finalAsrMs },
  { label: "LLM first token", value: (turn) => turn.durations.llmFirstTokenMs },
  { label: "TTS first byte", value: (turn) => turn.durations.ttsFirstByteMs },
  { label: "Playback start", value: (turn) => turn.durations.playbackStartMs },
  { label: "Turn completed", value: (turn) => turn.durations.turnCompletedMs }
];

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
      turnId: event.turnId,
      role: event.role,
      text: event.text,
      final: event.kind === "final",
      createdAt: event.createdAt
    });
  }

  return Array.from(rows.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function latestTurn(turns: TurnTimingRecord[]) {
  const ordered = [...turns].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return ordered.length === 0 ? null : ordered[ordered.length - 1];
}

function formatMs(value?: number) {
  return value == null ? "--" : `${Math.round(value)} ms`;
}

function degradationBadgeLabel(code: DegradationEvent["code"]) {
  if (code === "asr_stall") {
    return "ASR retry";
  }
  if (code === "llm_timeout") {
    return "LLM fallback";
  }
  if (code === "tts_timeout") {
    return "Text only";
  }
  return "Reconnect";
}

export function LiveSessionPanel({
  accessToken,
  conversationId,
  selectedSessionId,
  onSessionCreated,
  onSessionEnded
}: LiveSessionPanelProps) {
  const clientRef = useRef<PipecatClient | null>(null);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>("idle");
  const [session, setSession] = useState<Session | null>(null);
  const [transcriptRows, setTranscriptRows] = useState<TranscriptRow[]>([]);
  const [turnTimings, setTurnTimings] = useState<TurnTimingRecord[]>([]);
  const [rollingMetrics, setRollingMetrics] = useState<RollingLatencyMetrics | null>(null);
  const [degradationEvents, setDegradationEvents] = useState<DegradationEvent[]>([]);
  const [replayStatus, setReplayStatus] = useState<ReplayArtifactStatus>({ available: false });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const resumeInFlightRef = useRef(false);

  const activeSessionId = session?.id ?? selectedSessionId;

  const upsertRow = (row: TranscriptRow) => {
    setTranscriptRows((current) => {
      const next = new Map(current.map((item) => [item.id, item]));
      next.set(row.id, row);
      return Array.from(next.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    });
  };

  const fetchEvents = async (sessionId: string) => {
    const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/events`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error("Unable to load session history");
    }
    const payload = (await response.json()) as LocalSessionEventsResponse;
    setSession(payload.session);
    if (payload.session.status === "reconnecting") {
      setConnectionState("reconnecting");
    }
    setTranscriptRows(mergeTranscriptEvents(payload.transcriptEvents));
  };

  const fetchTimeline = async (sessionId: string) => {
    const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/timeline`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error("Unable to load metrics");
    }
    const payload = (await response.json()) as SessionTimelineResponse;
    setSession(payload.session);
    setTurnTimings(payload.turnTimings);
    setRollingMetrics(payload.rollingMetrics);
    setDegradationEvents(payload.degradationEvents);
    setReplayStatus(payload.replayArtifactStatus);
  };

  const connectClient = async (offerEndpoint: string) => {
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
            turnId: `live:user:${data.timestamp}`,
            role: "user",
            text: data.text,
            final: data.final,
            createdAt: data.timestamp
          });
        },
        onBotLlmStarted: () => {
          upsertRow({
            id: "assistant-live",
            turnId: session?.id ?? "assistant-live",
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
          setErrorMessage((message.data as { message?: string } | undefined)?.message ?? "Session failed");
        }
      }
    });

    clientRef.current = client;
    await client.connect({
      webrtcRequestParams: {
        endpoint: offerEndpoint
      }
    });
  };

  const handleResume = async (sessionId: string) => {
    if (resumeInFlightRef.current) {
      return;
    }
    resumeInFlightRef.current = true;
    setConnectionState("reconnecting");

    try {
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }
      const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/resume`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error("Unable to resume the live session");
      }
      const payload = (await response.json()) as LocalSessionCreateResponse;
      setSession(payload.session);
      await connectClient(payload.offerEndpoint);
      await fetchEvents(payload.session.id);
      await fetchTimeline(payload.session.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to resume the live session");
    } finally {
      resumeInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!activeSessionId) {
      setSession(null);
      setTranscriptRows([]);
      setTurnTimings([]);
      setRollingMetrics(null);
      return;
    }

    void fetchEvents(activeSessionId).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load session history");
    });
    void fetchTimeline(activeSessionId).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load metrics");
    });
  }, [activeSessionId, accessToken]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchEvents(activeSessionId).catch(() => undefined);
      void fetchTimeline(activeSessionId).catch(() => undefined);
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [activeSessionId, accessToken]);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        void clientRef.current.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (session?.status === "reconnecting" && activeSessionId && connectionState !== "connecting" && connectionState !== "live") {
      void handleResume(activeSessionId);
    }
  }, [session?.status, activeSessionId, connectionState]);

  const handleStart = async () => {
    setErrorMessage(null);
    setConnectionState("connecting");

    try {
      const createResponse = await fetch(`${getAgentBaseUrl()}/api/local/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ conversation_id: conversationId })
      });

      if (!createResponse.ok) {
        throw new Error("Unable to create a live session");
      }

      const payload = (await createResponse.json()) as LocalSessionCreateResponse;
      setSession(payload.session);
      setTranscriptRows([]);
      setTurnTimings([]);
      setRollingMetrics(null);
      setDegradationEvents([]);
      onSessionCreated(payload.session);

      await connectClient(payload.offerEndpoint);
      await fetchEvents(payload.session.id);
      await fetchTimeline(payload.session.id);
    } catch (error) {
      setConnectionState("failed");
      setErrorMessage(error instanceof Error ? error.message : "Unable to start live session");
    }
  };

  const handleEnd = async () => {
    if (!session) {
      return;
    }

    try {
      await fetch(`${getAgentBaseUrl()}/api/local/sessions/${session.id}/end`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (clientRef.current) {
        await clientRef.current.disconnect();
      }
      setConnectionState("ended");
      await fetchEvents(session.id);
      await fetchTimeline(session.id);
      onSessionEnded();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to end live session");
    }
  };

  const latest = latestTurn(turnTimings);
  const activeDegradations = degradationEvents.filter((event) => !event.recoveredAt);
  const recoveredDegradations = degradationEvents.filter((event) => event.recoveredAt);
  const badgesByTurn = degradationEvents.reduce<Record<string, DegradationEvent[]>>((acc, event) => {
    if (!event.turnId) {
      return acc;
    }
    acc[event.turnId] = [...(acc[event.turnId] ?? []), event];
    return acc;
  }, {});

  return (
    <div className="live-session-stack">
      <Panel title="Live Voice Controls">
        <div className="session-toolbar">
          <StatusBadge
            tone={
              connectionState === "failed"
                ? "danger"
                : connectionState === "live"
                  ? "success"
                  : "warning"
            }
          >
            {connectionState}
          </StatusBadge>
          <div className="session-toolbar-actions">
            <button className="primary-button" onClick={() => void handleStart()} disabled={connectionState === "connecting" || connectionState === "live"}>
              Start session
            </button>
            <button className="secondary-button" onClick={() => void handleEnd()} disabled={!session || connectionState === "ended"}>
              End session
            </button>
          </div>
        </div>
        {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
      </Panel>

      <Panel title="Transcript History" subtle>
        <div className="transcript-list">
          {transcriptRows.length === 0 ? <p className="muted-copy">No transcript yet. Start a session or open a previous one.</p> : null}
          {transcriptRows.map((row) => (
            <article key={row.id} className={`transcript-row transcript-${row.role}`}>
              <p className="transcript-role">
                {row.role}
                {!row.final ? " · live" : ""}
              </p>
              <p>{row.text}</p>
              {badgesByTurn[row.turnId]?.length ? (
                <div className="degradation-badge-row">
                  {badgesByTurn[row.turnId].map((event) => (
                    <span key={event.id} className={`degradation-badge degradation-${event.severity}`}>
                      {degradationBadgeLabel(event.code)}
                      {event.recoveredAt ? " · recovered" : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Latest Turn Metrics" subtle>
        <SectionTitle>Latency breakdown</SectionTitle>
        {latest ? (
          <div className="metric-grid">
            {STAGE_ROWS.map((row) => (
              <div key={row.label} className="metric-card">
                <span>{row.label}</span>
                <strong>{formatMs(row.value(latest))}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-copy">Metrics appear after the first completed turn.</p>
        )}
        <p className="muted-copy">Replay artifact: {replayStatus.available ? `available${replayStatus.generatedAt ? ` · ${replayStatus.generatedAt}` : ""}` : "pending"}</p>
        {rollingMetrics ? (
          <p className="muted-copy">
            Rolling turn completion p50: {formatMs(rollingMetrics.turnCompleted.p50Ms)} · p95: {formatMs(rollingMetrics.turnCompleted.p95Ms)}
          </p>
        ) : null}
        {session?.status === "reconnecting" ? (
          <p className="muted-copy">Reconnect in progress. Prosody is attempting to resume the same session.</p>
        ) : null}
        {activeDegradations.length ? (
          <div className="resilience-list">
            {activeDegradations.map((event) => (
              <p key={event.id} className="muted-copy">
                {degradationBadgeLabel(event.code)} · {event.message}
              </p>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No active degraded state markers.</p>
        )}
        {recoveredDegradations.length ? (
          <p className="muted-copy">
            Recovered: {recoveredDegradations.map((event) => degradationBadgeLabel(event.code)).join(", ")}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
