import { LogLevel, logger as pipecatLogger } from "@pipecat-ai/client-js";

export type LiveDiagnosticRecord = {
  event: string;
  timestamp: string;
  sessionId: string | null;
  details?: Record<string, unknown>;
};

declare global {
  interface Window {
    __prosodyLiveDiagnostics?: LiveDiagnosticRecord[];
    __prosodyLiveDiagnosticsActiveSessionId?: string | null;
    __prosodyLiveDiagnosticsFetchInstalled?: boolean;
    __prosodyLiveDiagnosticsPeerConnectionInstalled?: boolean;
    __prosodyLiveDiagnosticsPeerConnections?: Record<string, RTCPeerConnection>;
    __prosodyLiveDiagnosticsStatsIntervalId?: number | null;
  }
}

const DIAGNOSTICS_PREFIX = "[prosody-live]";
const MAX_RECORDS = 400;

function diagnosticsEnabled(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined";
}

function diagnosticsBuffer(): LiveDiagnosticRecord[] | null {
  if (!diagnosticsEnabled()) return null;
  window.__prosodyLiveDiagnostics ??= [];
  return window.__prosodyLiveDiagnostics;
}

function peerConnections(): Record<string, RTCPeerConnection> | null {
  if (!diagnosticsEnabled()) return null;
  window.__prosodyLiveDiagnosticsPeerConnections ??= {};
  return window.__prosodyLiveDiagnosticsPeerConnections;
}

function currentSessionId(): string | null {
  if (!diagnosticsEnabled()) return null;
  return window.__prosodyLiveDiagnosticsActiveSessionId ?? null;
}

function endpointPath(endpoint: string): string {
  try {
    return new URL(endpoint, window.location.origin).pathname;
  } catch {
    return endpoint;
  }
}

function extractSessionId(endpoint: string): string | null {
  const match = endpoint.match(/\/api\/local\/sessions\/([^/]+)/);
  return match?.[1] ?? null;
}

function parseCandidateType(candidate: string): string | null {
  const match = candidate.match(/\styp\s([a-z]+)/i);
  return match?.[1] ?? null;
}

function readJsonBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function summarizeSdp(sdp: string | null | undefined): Record<string, unknown> | undefined {
  if (!sdp) return undefined;
  const media: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;
  for (const rawLine of sdp.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("m=")) {
      const parts = line.slice(2).split(/\s+/);
      current = {
        kind: parts[0] ?? "unknown",
        port: parts[1] ?? null,
        protocol: parts[2] ?? null,
        payloadTypes: parts.slice(3),
        direction: null,
        mid: null,
        setup: null,
        rtpmap: [] as string[],
      };
      media.push(current);
      continue;
    }
    if (!current || !line.startsWith("a=")) continue;
    if (line === "a=sendrecv" || line === "a=sendonly" || line === "a=recvonly" || line === "a=inactive") {
      current.direction = line.slice(2);
      continue;
    }
    if (line.startsWith("a=mid:")) {
      current.mid = line.slice(6);
      continue;
    }
    if (line.startsWith("a=setup:")) {
      current.setup = line.slice(8);
      continue;
    }
    if (line.startsWith("a=rtpmap:")) {
      ((current.rtpmap as string[]) ?? []).push(line.slice(9));
    }
  }
  return {
    mediaCount: media.length,
    media,
  };
}

function trackSnapshot(track: MediaStreamTrack | null | undefined): Record<string, unknown> | null {
  if (!track) return null;
  return {
    kind: track.kind,
    id: track.id,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings: typeof track.getSettings === "function" ? track.getSettings() : undefined,
  };
}

async function peerConnectionStatsSnapshot(peerConnectionId: string, pc: RTCPeerConnection): Promise<Record<string, unknown>> {
  const report = await pc.getStats();
  const outboundAudio: Array<Record<string, unknown>> = [];
  const inboundAudio: Array<Record<string, unknown>> = [];
  const mediaSources: Array<Record<string, unknown>> = [];
  const selectedCandidatePairs: Array<Record<string, unknown>> = [];

  report.forEach((value) => {
    if (value.type === "outbound-rtp" && "kind" in value && value.kind === "audio") {
      outboundAudio.push({
        id: value.id,
        bytesSent: "bytesSent" in value ? value.bytesSent : undefined,
        packetsSent: "packetsSent" in value ? value.packetsSent : undefined,
        mediaSourceId: "mediaSourceId" in value ? value.mediaSourceId : undefined,
        trackId: "trackId" in value ? value.trackId : undefined,
      });
    }
    if (value.type === "inbound-rtp" && "kind" in value && value.kind === "audio") {
      inboundAudio.push({
        id: value.id,
        bytesReceived: "bytesReceived" in value ? value.bytesReceived : undefined,
        packetsReceived: "packetsReceived" in value ? value.packetsReceived : undefined,
        packetsLost: "packetsLost" in value ? value.packetsLost : undefined,
        jitter: "jitter" in value ? value.jitter : undefined,
        audioLevel: "audioLevel" in value ? value.audioLevel : undefined,
        trackIdentifier: "trackIdentifier" in value ? value.trackIdentifier : undefined,
      });
    }
    if (value.type === "media-source" && "kind" in value && value.kind === "audio") {
      mediaSources.push({
        id: value.id,
        trackIdentifier: "trackIdentifier" in value ? value.trackIdentifier : undefined,
        audioLevel: "audioLevel" in value ? value.audioLevel : undefined,
      });
    }
    if (value.type === "candidate-pair" && "state" in value && "selected" in value && value.selected) {
      selectedCandidatePairs.push({
        id: value.id,
        state: value.state,
        currentRoundTripTime: "currentRoundTripTime" in value ? value.currentRoundTripTime : undefined,
        localCandidateId: "localCandidateId" in value ? value.localCandidateId : undefined,
        remoteCandidateId: "remoteCandidateId" in value ? value.remoteCandidateId : undefined,
      });
    }
  });

  return {
    peerConnectionId,
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    iceGatheringState: pc.iceGatheringState,
    signalingState: pc.signalingState,
    transceivers: pc.getTransceivers().map((transceiver, index) => ({
      index,
      mid: transceiver.mid,
      direction: transceiver.direction,
      currentDirection: transceiver.currentDirection,
      sender: trackSnapshot(transceiver.sender.track),
      receiver: trackSnapshot(transceiver.receiver.track),
    })),
    senders: pc.getSenders().map((sender, index) => ({
      index,
      track: trackSnapshot(sender.track),
    })),
    receivers: pc.getReceivers().map((receiver, index) => ({
      index,
      track: trackSnapshot(receiver.track),
    })),
    outboundAudio,
    inboundAudio,
    mediaSources,
    selectedCandidatePairs,
  };
}

export async function snapshotPeerConnections(reason: string, sessionId?: string | null): Promise<void> {
  const connections = peerConnections();
  if (!connections) return;
  const entries = Object.entries(connections);
  if (entries.length === 0) {
    appendLiveDiagnostic("peer-connection-snapshot", { reason, peerConnectionCount: 0 }, sessionId);
    return;
  }

  for (const [peerConnectionId, pc] of entries) {
    try {
      appendLiveDiagnostic(
        "peer-connection-snapshot",
        {
          reason,
          ...(await peerConnectionStatsSnapshot(peerConnectionId, pc)),
        },
        sessionId,
      );
    } catch (error) {
      appendLiveDiagnostic(
        "peer-connection-snapshot-error",
        {
          reason,
          peerConnectionId,
          message: error instanceof Error ? error.message : String(error),
        },
        sessionId,
      );
    }
  }
}

export function startPeerConnectionStatsPolling(sessionId: string, intervalMs = 1000): void {
  if (!diagnosticsEnabled()) return;
  stopPeerConnectionStatsPolling();
  void snapshotPeerConnections("poll-start", sessionId);
  window.__prosodyLiveDiagnosticsStatsIntervalId = window.setInterval(() => {
    void snapshotPeerConnections("poll", sessionId);
  }, intervalMs);
}

export function stopPeerConnectionStatsPolling(): void {
  if (!diagnosticsEnabled()) return;
  if (window.__prosodyLiveDiagnosticsStatsIntervalId != null) {
    window.clearInterval(window.__prosodyLiveDiagnosticsStatsIntervalId);
    window.__prosodyLiveDiagnosticsStatsIntervalId = null;
  }
}

function installTrackLifecycleDiagnostics(track: MediaStreamTrack | undefined, label: string, sessionId: string): void {
  if (!track) return;
  appendLiveDiagnostic(`${label}-snapshot`, trackSnapshot(track) ?? undefined, sessionId);
  if (typeof track.addEventListener !== "function") return;
  track.addEventListener("mute", () => {
    appendLiveDiagnostic(`${label}-mute`, trackSnapshot(track) ?? undefined, sessionId);
  });
  track.addEventListener("unmute", () => {
    appendLiveDiagnostic(`${label}-unmute`, trackSnapshot(track) ?? undefined, sessionId);
  });
  track.addEventListener("ended", () => {
    appendLiveDiagnostic(`${label}-ended`, trackSnapshot(track) ?? undefined, sessionId);
  });
}

export function captureClientTrackDiagnostics(
  tracks: {
    local?: {
      audio?: MediaStreamTrack;
      video?: MediaStreamTrack;
      screenAudio?: MediaStreamTrack;
      screenVideo?: MediaStreamTrack;
    };
  } | null | undefined,
  sessionId: string,
): void {
  if (!tracks?.local) {
    appendLiveDiagnostic("local-track-missing", undefined, sessionId);
    return;
  }
  installTrackLifecycleDiagnostics(tracks.local.audio, "local-audio-track", sessionId);
  installTrackLifecycleDiagnostics(tracks.local.video, "local-video-track", sessionId);
  installTrackLifecycleDiagnostics(tracks.local.screenAudio, "local-screen-audio-track", sessionId);
  installTrackLifecycleDiagnostics(tracks.local.screenVideo, "local-screen-video-track", sessionId);
}

export function resetLiveDiagnostics(): void {
  if (!diagnosticsEnabled()) return;
  window.__prosodyLiveDiagnostics = [];
  window.__prosodyLiveDiagnosticsActiveSessionId = null;
  window.__prosodyLiveDiagnosticsPeerConnections = {};
  stopPeerConnectionStatsPolling();
}

export function setActiveLiveDiagnosticsSession(sessionId: string | null): void {
  if (!diagnosticsEnabled()) return;
  window.__prosodyLiveDiagnosticsActiveSessionId = sessionId;
}

export function appendLiveDiagnostic(
  event: string,
  details?: Record<string, unknown>,
  sessionId?: string | null,
): void {
  if (!diagnosticsEnabled()) return;
  const record: LiveDiagnosticRecord = {
    event,
    timestamp: new Date().toISOString(),
    sessionId: sessionId ?? currentSessionId(),
    details,
  };
  const buffer = diagnosticsBuffer();
  if (buffer) {
    buffer.push(record);
    if (buffer.length > MAX_RECORDS) buffer.splice(0, buffer.length - MAX_RECORDS);
  }
  if (details) {
    console.debug(`${DIAGNOSTICS_PREFIX} ${event}`, {
      sessionId: record.sessionId,
      timestamp: record.timestamp,
      ...details,
    });
    return;
  }
  console.debug(`${DIAGNOSTICS_PREFIX} ${event}`, {
    sessionId: record.sessionId,
    timestamp: record.timestamp,
  });
}

export function enablePipecatDebugLogging(): void {
  if (!diagnosticsEnabled()) return;
  pipecatLogger.setLevel(LogLevel.DEBUG);
  appendLiveDiagnostic("pipecat-log-level", { level: "DEBUG" });
}

export function installLiveFetchDiagnostics(): void {
  if (!diagnosticsEnabled() || window.__prosodyLiveDiagnosticsFetchInstalled) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const endpoint =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const parsedBody = readJsonBody(init?.body);
    const sessionId = extractSessionId(endpoint);
    const shouldTrace = endpoint.includes("/api/local/sessions/") && endpoint.includes("/offer");
    if (!shouldTrace) {
      return originalFetch(input, init);
    }

    const startedAt = performance.now();
    appendLiveDiagnostic(
      method === "PATCH" ? "offer-patch-request" : "offer-request",
      {
        method,
        path: endpointPath(endpoint),
        candidateCount: Array.isArray(parsedBody?.candidates) ? parsedBody.candidates.length : undefined,
        restartPc: parsedBody?.restart_pc ?? undefined,
        sdpSummary: typeof parsedBody?.sdp === "string" ? summarizeSdp(parsedBody.sdp) : undefined,
      },
      sessionId,
    );

    try {
      const response = await originalFetch(input, init);
      let responseSdpSummary: Record<string, unknown> | undefined;
      try {
        const cloned = response.clone();
        const payload = (await cloned.json()) as { sdp?: string };
        responseSdpSummary = summarizeSdp(payload.sdp);
      } catch {
        responseSdpSummary = undefined;
      }
      appendLiveDiagnostic(
        method === "PATCH" ? "offer-patch-response" : "offer-response",
        {
          method,
          path: endpointPath(endpoint),
          status: response.status,
          ok: response.ok,
          durationMs: Math.round(performance.now() - startedAt),
          sdpSummary: responseSdpSummary,
        },
        sessionId,
      );
      return response;
    } catch (error) {
      appendLiveDiagnostic(
        method === "PATCH" ? "offer-patch-error" : "offer-error",
        {
          method,
          path: endpointPath(endpoint),
          durationMs: Math.round(performance.now() - startedAt),
          message: error instanceof Error ? error.message : String(error),
        },
        sessionId,
      );
      throw error;
    }
  }) as typeof window.fetch;
  window.__prosodyLiveDiagnosticsFetchInstalled = true;
  appendLiveDiagnostic("fetch-diagnostics-installed");
}

export function installPeerConnectionDiagnostics(): void {
  if (
    !diagnosticsEnabled() ||
    window.__prosodyLiveDiagnosticsPeerConnectionInstalled ||
    typeof window.RTCPeerConnection === "undefined"
  ) {
    return;
  }

  const OriginalRTCPeerConnection = window.RTCPeerConnection;
  class InstrumentedRTCPeerConnection extends OriginalRTCPeerConnection {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      const peerConnectionId = `pc_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
      const connections = peerConnections();
      if (connections) connections[peerConnectionId] = this;
      appendLiveDiagnostic("peer-connection-created", {
        peerConnectionId,
        iceServerCount: configuration?.iceServers?.length ?? 0,
      });

      const emitState = (trigger: string) => {
        appendLiveDiagnostic("peer-connection-state", {
          peerConnectionId,
          trigger,
          connectionState: this.connectionState,
          iceConnectionState: this.iceConnectionState,
          iceGatheringState: this.iceGatheringState,
          signalingState: this.signalingState,
        });
        if (this.connectionState === "closed") {
          const connections = peerConnections();
          if (connections) delete connections[peerConnectionId];
        }
        void snapshotPeerConnections(`state:${trigger}`);
      };

      this.addEventListener("connectionstatechange", () => emitState("connectionstatechange"));
      this.addEventListener("iceconnectionstatechange", () => emitState("iceconnectionstatechange"));
      this.addEventListener("icegatheringstatechange", () => emitState("icegatheringstatechange"));
      this.addEventListener("signalingstatechange", () => emitState("signalingstatechange"));
      this.addEventListener("icecandidate", (event) => {
        appendLiveDiagnostic("peer-connection-ice-candidate", {
          peerConnectionId,
          hasCandidate: Boolean(event.candidate),
          candidateType: event.candidate ? parseCandidateType(event.candidate.candidate) : null,
        });
      });
      this.addEventListener("track", (event) => {
        appendLiveDiagnostic("peer-connection-track", {
          peerConnectionId,
          kind: event.track.kind,
          id: event.track.id,
          label: event.track.label,
          readyState: event.track.readyState,
        });
        void snapshotPeerConnections("track");
      });
      this.addEventListener("negotiationneeded", () => {
        appendLiveDiagnostic("peer-connection-negotiation-needed", { peerConnectionId });
      });
    }
  }

  window.RTCPeerConnection = InstrumentedRTCPeerConnection as typeof window.RTCPeerConnection;
  window.__prosodyLiveDiagnosticsPeerConnectionInstalled = true;
  appendLiveDiagnostic("peer-connection-diagnostics-installed");
}

export function ensureLiveDiagnosticsInstalled(): void {
  if (!diagnosticsEnabled()) return;
  enablePipecatDebugLogging();
  installLiveFetchDiagnostics();
  installPeerConnectionDiagnostics();
}
