import { useEffect, useRef, useState, useCallback } from "react";
import { PipecatClient, type RTVIMessage, type TransportState } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import type {
  DegradationEvent,
  RealtimeConnectionState,
  RollingLatencyMetrics,
  Session,
  SessionTimelineResponse,
  TranscriptEvent,
  TurnTimingRecord,
  ReplayArtifactStatus,
} from "@prosody/contracts";
import { getAgentBaseUrl } from "../../lib/supabase";
import {
  appendLiveDiagnostic,
  captureClientTrackDiagnostics,
  ensureLiveDiagnosticsInstalled,
  snapshotPeerConnections,
  startPeerConnectionStatsPolling,
  setActiveLiveDiagnosticsSession,
  stopPeerConnectionStatsPolling,
} from "./liveDiagnostics";

/* ─── Types ─── */

type LocalSessionCreateResponse = {
  conversationId: string;
  session: Session;
  offerEndpoint: string;
};

type LocalSessionEventsResponse = {
  session: Session;
  transcriptEvents: TranscriptEvent[];
};

export type TranscriptRow = {
  id: string;
  turnId: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  createdAt: string;
};

/* ─── Helpers ─── */

function mapTransportState(state: TransportState): RealtimeConnectionState {
  if (state === "connecting" || state === "initializing" || state === "initialized") return "connecting";
  if (state === "connected" || state === "ready") return "connected";
  if (state === "disconnecting") return "ending";
  if (state === "error") return "failed";
  return "idle";
}

function mergeTranscriptEvents(events: TranscriptEvent[]): TranscriptRow[] {
  const rows = new Map<string, TranscriptRow>();
  for (const event of events) {
    const key = `${event.turnId}:${event.role}`;
    rows.set(key, {
      id: key,
      turnId: event.turnId,
      sessionId: event.sessionId,
      role: event.role,
      text: event.text,
      final: event.kind === "final",
      createdAt: event.createdAt,
    });
  }
  return Array.from(rows.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function readResponseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    return payload.detail ?? payload.message ?? fallback;
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

/* ─── Hook ─── */

export function useLiveSession({
  accessToken,
  conversationId,
  selectedSessionId,
  onSessionCreated,
  onSessionEnded,
}: {
  accessToken: string;
  conversationId: string;
  selectedSessionId?: string;
  onSessionCreated: (session: Session) => void;
  onSessionEnded: () => void;
}) {
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
  const awaitingFirstTurnRef = useRef(false);
  const sawLocalAudioRef = useRef(false);
  const selectedMicLabelRef = useRef<string | null>(null);
  const connectionStateRef = useRef<RealtimeConnectionState>("idle");

  const activeSessionId = session?.id ?? selectedSessionId;

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    ensureLiveDiagnosticsInstalled();
  }, []);

  useEffect(() => {
    setActiveLiveDiagnosticsSession(activeSessionId ?? null);
    return () => {
      setActiveLiveDiagnosticsSession(null);
    };
  }, [activeSessionId]);

  const upsertRow = useCallback((row: TranscriptRow) => {
    setTranscriptRows((current) => {
      const next = new Map(current.map((item) => [item.id, item]));
      next.set(row.id, row);
      return Array.from(next.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const fetchEvents = useCallback(async (sessionId: string) => {
    appendLiveDiagnostic("session-events-request", {
      path: `/api/local/sessions/${sessionId}/events`,
    }, sessionId);
    const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/events`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(await readResponseError(response, "Unable to load session history"));
    const payload = (await response.json()) as LocalSessionEventsResponse;
    appendLiveDiagnostic("session-events-response", {
      status: payload.session.status,
      transcriptEventCount: payload.transcriptEvents.length,
    }, sessionId);
    setSession(payload.session);
    if (payload.session.status === "reconnecting") setConnectionState("reconnecting");
    setTranscriptRows(mergeTranscriptEvents(payload.transcriptEvents));
  }, [accessToken]);

  const fetchTimeline = useCallback(async (sessionId: string) => {
    appendLiveDiagnostic("session-timeline-request", {
      path: `/api/local/sessions/${sessionId}/timeline`,
    }, sessionId);
    const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/timeline`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(await readResponseError(response, "Unable to load metrics"));
    const payload = (await response.json()) as SessionTimelineResponse;
    appendLiveDiagnostic("session-timeline-response", {
      status: payload.session.status,
      turnTimingCount: payload.turnTimings.length,
      degradationEventCount: payload.degradationEvents.length,
    }, sessionId);
    setSession(payload.session);
    setTurnTimings(payload.turnTimings);
    setRollingMetrics(payload.rollingMetrics);
    setDegradationEvents(payload.degradationEvents);
    setReplayStatus(payload.replayArtifactStatus);
    if (payload.turnTimings.length > 0) {
      awaitingFirstTurnRef.current = false;
    }
    if (
      awaitingFirstTurnRef.current &&
      payload.turnTimings.length === 0 &&
      (payload.session.status === "ended" || payload.session.status === "failed")
    ) {
      awaitingFirstTurnRef.current = false;
      setConnectionState("failed");
      appendLiveDiagnostic("session-ended-without-backend-audio", {
        sawLocalAudio: sawLocalAudioRef.current,
        selectedMicLabel: selectedMicLabelRef.current,
        sessionStatus: payload.session.status,
      }, sessionId);
      setErrorMessage(
        sawLocalAudioRef.current
          ? "Microphone audio was detected in the browser but never reached the backend. This looks like a local WebRTC media transport issue."
          : `No microphone audio reached the backend${selectedMicLabelRef.current ? ` from "${selectedMicLabelRef.current}"` : ""}. Check your browser and macOS microphone selection/permissions.`
      );
    }
  }, [accessToken]);

  const connectClient = useCallback(async (sessionId: string, offerEndpoint: string) => {
    setActiveLiveDiagnosticsSession(sessionId);
    stopPeerConnectionStatsPolling();
    appendLiveDiagnostic("transport-connect-start", {
      offerEndpoint,
    }, sessionId);
    const client = new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onTransportStateChanged: (state) => {
          appendLiveDiagnostic("transport-state", { state }, sessionId);
          setConnectionState(mapTransportState(state));
        },
        onBotReady: () => {
          appendLiveDiagnostic("bot-ready", undefined, sessionId);
          setConnectionState("live");
        },
        onMicUpdated: (mic) => {
          selectedMicLabelRef.current = mic.label || null;
          appendLiveDiagnostic("mic-updated", {
            label: selectedMicLabelRef.current,
            deviceId: mic.deviceId || null,
            kind: mic.kind,
          }, sessionId);
        },
        onLocalAudioLevel: (level) => {
          if (level > 0.02 && !sawLocalAudioRef.current) {
            sawLocalAudioRef.current = true;
            appendLiveDiagnostic("local-audio-detected", { level }, sessionId);
          }
        },
        onUserTranscript: (data) => {
          awaitingFirstTurnRef.current = false;
          appendLiveDiagnostic("user-transcript", {
            final: data.final,
            textLength: data.text.length,
          }, sessionId);
          upsertRow({
            id: `live:user:${data.timestamp}`,
            turnId: `live:user:${data.timestamp}`,
            sessionId: "",
            role: "user",
            text: data.text,
            final: data.final,
            createdAt: data.timestamp,
          });
        },
        onBotLlmStarted: () => {
          appendLiveDiagnostic("bot-llm-started", undefined, sessionId);
          upsertRow({
            id: "assistant-live",
            turnId: session?.id ?? "assistant-live",
            sessionId: "",
            role: "assistant",
            text: "",
            final: false,
            createdAt: new Date().toISOString(),
          });
        },
        onBotLlmText: (data) => {
          appendLiveDiagnostic("bot-llm-text", {
            textLength: data.text.length,
          }, sessionId);
          setTranscriptRows((current) =>
            current.map((row) =>
              row.id === "assistant-live"
                ? { ...row, text: `${row.text}${data.text}`, final: false }
                : row
            )
          );
        },
        onBotLlmStopped: () => {
          appendLiveDiagnostic("bot-llm-stopped", undefined, sessionId);
          setTranscriptRows((current) =>
            current.map((row) => (row.id === "assistant-live" ? { ...row, final: true } : row))
          );
        },
        onError: (message: RTVIMessage) => {
          appendLiveDiagnostic("client-error", {
            message: (message.data as { message?: string } | undefined)?.message ?? "Session failed",
          }, sessionId);
          setErrorMessage((message.data as { message?: string } | undefined)?.message ?? "Session failed");
        },
        onDeviceError: (error) => {
          const devices = error.devices?.join(", ");
          appendLiveDiagnostic("device-error", {
            type: error.type,
            devices,
            details: error.details,
          }, sessionId);
          void snapshotPeerConnections("device-error", sessionId);
          setErrorMessage(
            `Device error${devices ? ` (${devices})` : ""}: ${error.type}. Check your browser and macOS microphone permissions.`
          );
        },
        onTrackStarted: (track) => {
          appendLiveDiagnostic("track-started", {
            kind: track.kind,
            readyState: track.readyState,
          }, sessionId);
        },
        onTrackStopped: (track) => {
          appendLiveDiagnostic("track-stopped", {
            kind: track.kind,
            readyState: track.readyState,
            connectionState: connectionStateRef.current,
          }, sessionId);
        },
      },
    });
    clientRef.current = client;
    try {
      await client.connect({
        webrtcRequestParams: {
          endpoint: offerEndpoint,
          headers: new Headers({
            Authorization: `Bearer ${accessToken}`,
          }),
          requestData: {
            diagnosticsVersion: "2026-04-21",
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
          },
        },
      });
      captureClientTrackDiagnostics(client.tracks(), sessionId);
      void snapshotPeerConnections("post-connect", sessionId);
      startPeerConnectionStatsPolling(sessionId);
      appendLiveDiagnostic("transport-connect-resolved", undefined, sessionId);
    } catch (error) {
      appendLiveDiagnostic("transport-connect-failed", {
        message: error instanceof Error ? error.message : String(error),
      }, sessionId);
      throw error;
    }
  }, [accessToken, session?.id, upsertRow]);

  // Fetch data for selected session
  useEffect(() => {
    if (!activeSessionId) {
      setSession(null);
      setTranscriptRows([]);
      setTurnTimings([]);
      setRollingMetrics(null);
      return;
    }
    void fetchEvents(activeSessionId).catch((e: unknown) =>
      setErrorMessage(e instanceof Error ? e.message : "Unable to load session history")
    );
    void fetchTimeline(activeSessionId).catch((e: unknown) =>
      setErrorMessage(e instanceof Error ? e.message : "Unable to load metrics")
    );
  }, [activeSessionId, accessToken, fetchEvents, fetchTimeline]);

  // Poll while session active
  useEffect(() => {
    if (!activeSessionId) return;
    const intervalId = window.setInterval(() => {
      void fetchEvents(activeSessionId).catch(() => undefined);
      void fetchTimeline(activeSessionId).catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(intervalId);
  }, [activeSessionId, accessToken, fetchEvents, fetchTimeline]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPeerConnectionStatsPolling();
      if (clientRef.current) void clientRef.current.disconnect();
    };
  }, []);

  // Auto-resume on reconnecting state
  useEffect(() => {
    if (
      session?.status === "reconnecting" &&
      activeSessionId &&
      connectionState !== "connecting" &&
      connectionState !== "live"
    ) {
      void handleResume(activeSessionId);
    }
  }, [session?.status, activeSessionId, connectionState]);

  const handleResume = async (sessionId: string) => {
    if (resumeInFlightRef.current) return;
    resumeInFlightRef.current = true;
    awaitingFirstTurnRef.current = true;
    sawLocalAudioRef.current = false;
    selectedMicLabelRef.current = null;
    setConnectionState("reconnecting");
    appendLiveDiagnostic("session-resume-request", undefined, sessionId);
    try {
      stopPeerConnectionStatsPolling();
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }
      const response = await fetch(`${getAgentBaseUrl()}/api/local/sessions/${sessionId}/resume`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(await readResponseError(response, "Unable to resume the live session"));
      const payload = (await response.json()) as LocalSessionCreateResponse;
      appendLiveDiagnostic("session-resume-response", {
        status: payload.session.status,
      }, payload.session.id);
      setSession(payload.session);
      await connectClient(payload.session.id, payload.offerEndpoint);
      await fetchEvents(payload.session.id);
      await fetchTimeline(payload.session.id);
    } catch (error) {
      stopPeerConnectionStatsPolling();
      appendLiveDiagnostic("session-resume-failed", {
        message: error instanceof Error ? error.message : "Unable to resume the live session",
      }, sessionId);
      setErrorMessage(error instanceof Error ? error.message : "Unable to resume the live session");
    } finally {
      resumeInFlightRef.current = false;
    }
  };

  const startSession = useCallback(async () => {
    setErrorMessage(null);
    awaitingFirstTurnRef.current = true;
    sawLocalAudioRef.current = false;
    selectedMicLabelRef.current = null;
    setConnectionState("connecting");
    appendLiveDiagnostic("session-create-request", {
      conversationId,
    }, null);
    try {
      const createResponse = await fetch(`${getAgentBaseUrl()}/api/local/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      if (!createResponse.ok) throw new Error(await readResponseError(createResponse, "Unable to create a live session"));
      const payload = (await createResponse.json()) as LocalSessionCreateResponse;
      appendLiveDiagnostic("session-create-response", {
        conversationId: payload.conversationId,
        status: payload.session.status,
      }, payload.session.id);
      setSession(payload.session);
      setTranscriptRows([]);
      setTurnTimings([]);
      setRollingMetrics(null);
      setDegradationEvents([]);
      onSessionCreated(payload.session);
      await connectClient(payload.session.id, payload.offerEndpoint);
      await fetchEvents(payload.session.id);
      await fetchTimeline(payload.session.id);
    } catch (error) {
      stopPeerConnectionStatsPolling();
      setConnectionState("failed");
      appendLiveDiagnostic("session-create-failed", {
        message: error instanceof Error ? error.message : "Unable to start live session",
      });
      setErrorMessage(error instanceof Error ? error.message : "Unable to start live session");
    }
  }, [accessToken, conversationId, connectClient, fetchEvents, fetchTimeline, onSessionCreated]);

  const endSession = useCallback(async () => {
    if (!session) return;
    try {
      awaitingFirstTurnRef.current = false;
      appendLiveDiagnostic("session-end-request", undefined, session.id);
      await fetch(`${getAgentBaseUrl()}/api/local/sessions/${session.id}/end`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      stopPeerConnectionStatsPolling();
      if (clientRef.current) await clientRef.current.disconnect();
      setConnectionState("ended");
      await fetchEvents(session.id);
      await fetchTimeline(session.id);
      appendLiveDiagnostic("session-end-response", undefined, session.id);
      onSessionEnded();
    } catch (error) {
      stopPeerConnectionStatsPolling();
      appendLiveDiagnostic("session-end-failed", {
        message: error instanceof Error ? error.message : "Unable to end live session",
      }, session.id);
      setErrorMessage(error instanceof Error ? error.message : "Unable to end live session");
    }
  }, [session, accessToken, fetchEvents, fetchTimeline, onSessionEnded]);

  return {
    connectionState,
    session,
    transcriptRows,
    turnTimings,
    rollingMetrics,
    degradationEvents,
    replayStatus,
    errorMessage,
    startSession,
    endSession,
  };
}
