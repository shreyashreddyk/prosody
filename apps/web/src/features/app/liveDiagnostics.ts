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

export function resetLiveDiagnostics(): void {
  if (!diagnosticsEnabled()) return;
  window.__prosodyLiveDiagnostics = [];
  window.__prosodyLiveDiagnosticsActiveSessionId = null;
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
      },
      sessionId,
    );

    try {
      const response = await originalFetch(input, init);
      appendLiveDiagnostic(
        method === "PATCH" ? "offer-patch-response" : "offer-response",
        {
          method,
          path: endpointPath(endpoint),
          status: response.status,
          ok: response.ok,
          durationMs: Math.round(performance.now() - startedAt),
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
