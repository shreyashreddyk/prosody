import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveSession } from "./LiveSessionPanel";

const {
  connectMock,
  disconnectMock,
  loggerSetLevelMock,
  pipecatClientMock,
  smallWebRtcTransportMock,
  wavMediaManagerMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn().mockResolvedValue(undefined),
  disconnectMock: vi.fn().mockResolvedValue(undefined),
  loggerSetLevelMock: vi.fn(),
  pipecatClientMock: vi.fn(),
  smallWebRtcTransportMock: vi.fn(),
  wavMediaManagerMock: vi.fn(),
}));

pipecatClientMock.mockImplementation((options?: { callbacks?: Record<string, (...args: unknown[]) => void> }) => ({
  connect: connectMock,
  disconnect: disconnectMock,
  callbacks: options?.callbacks ?? {},
}));
smallWebRtcTransportMock.mockImplementation(() => ({}));
wavMediaManagerMock.mockImplementation(() => ({ type: "wav-media-manager" }));

vi.mock("@pipecat-ai/client-js", () => ({
  PipecatClient: pipecatClientMock,
  LogLevel: {
    DEBUG: 4,
  },
  logger: {
    setLevel: loggerSetLevelMock,
  },
}));

vi.mock("@pipecat-ai/small-webrtc-transport", () => ({
  SmallWebRTCTransport: smallWebRtcTransportMock,
  WavMediaManager: wavMediaManagerMock,
}));

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe("useLiveSession", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete window.__prosodyLiveDiagnostics;
    delete window.__prosodyLiveDiagnosticsActiveSessionId;
    delete window.__prosodyLiveDiagnosticsFetchInstalled;
    delete window.__prosodyLiveDiagnosticsPeerConnectionInstalled;
  });

  it("passes the bearer token to Pipecat WebRTC offer requests", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          conversationId: "conv_1",
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
            startedAt: "2026-04-20T22:00:00Z",
            createdAt: "2026-04-20T22:00:00Z",
            updatedAt: "2026-04-20T22:00:00Z",
          },
          offerEndpoint: "http://127.0.0.1:8000/api/local/sessions/sess_1/offer",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
          },
          transcriptEvents: [],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
          },
          turnTimings: [],
          rollingMetrics: null,
          degradationEvents: [],
          replayArtifactStatus: { available: false },
        })
      );

    const { result } = renderHook(() =>
      useLiveSession({
        accessToken: "token-123",
        conversationId: "conv_1",
        onSessionCreated: () => undefined,
        onSessionEnded: () => undefined,
      })
    );

    await act(async () => {
      await result.current.startSession();
    });

    await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1));

    const connectArgs = connectMock.mock.calls[0][0] as {
      webrtcRequestParams: { endpoint: string; headers: Headers };
    };
    expect(wavMediaManagerMock).toHaveBeenCalledWith(undefined, 16000);
    expect(smallWebRtcTransportMock).toHaveBeenCalledWith({
      mediaManager: { type: "wav-media-manager" },
    });
    expect(connectArgs.webrtcRequestParams.endpoint).toBe(
      "http://127.0.0.1:8000/api/local/sessions/sess_1/offer"
    );
    expect(connectArgs.webrtcRequestParams.headers.get("Authorization")).toBe("Bearer token-123");
    expect(loggerSetLevelMock).toHaveBeenCalledWith(4);
  });

  it("surfaces a no-audio diagnostic when the session ends without backend turns", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/local/sessions")) {
        return jsonResponse({
          conversationId: "conv_1",
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
            startedAt: "2026-04-20T22:00:00Z",
            createdAt: "2026-04-20T22:00:00Z",
            updatedAt: "2026-04-20T22:00:00Z",
          },
          offerEndpoint: "http://127.0.0.1:8000/api/local/sessions/sess_1/offer",
        });
      }
      if (url.endsWith("/events")) {
        return jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
          },
          transcriptEvents: [],
        });
      }
      if (url.endsWith("/timeline")) {
        return jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "ended",
          },
          turnTimings: [],
          rollingMetrics: null,
          degradationEvents: [],
          replayArtifactStatus: { available: false },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    connectMock.mockImplementationOnce(async () => {
      const callbacks = pipecatClientMock.mock.calls[0]?.[0]?.callbacks as
        | { onLocalAudioLevel?: (level: number) => void; onMicUpdated?: (mic: MediaDeviceInfo) => void }
        | undefined;
      callbacks?.onMicUpdated?.({ label: "MacBook Pro Microphone" } as MediaDeviceInfo);
      callbacks?.onLocalAudioLevel?.(0.4);
    });

    const { result } = renderHook(() =>
      useLiveSession({
        accessToken: "token-123",
        conversationId: "conv_1",
        onSessionCreated: () => undefined,
        onSessionEnded: () => undefined,
      })
    );

    await act(async () => {
      await result.current.startSession();
    });

    await waitFor(() =>
      expect(result.current.errorMessage).toBe(
        "Microphone audio was detected in the browser but never reached the backend. This looks like a local WebRTC media transport issue."
      )
    );
    expect(result.current.connectionState).toBe("failed");
  });

  it("does not surface a fatal startup error for generic track-stopped events", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/local/sessions")) {
        return jsonResponse({
          conversationId: "conv_1",
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
            startedAt: "2026-04-20T22:00:00Z",
            createdAt: "2026-04-20T22:00:00Z",
            updatedAt: "2026-04-20T22:00:00Z",
          },
          offerEndpoint: "http://127.0.0.1:8000/api/local/sessions/sess_1/offer",
        });
      }
      if (url.endsWith("/events")) {
        return jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
          },
          transcriptEvents: [],
        });
      }
      if (url.endsWith("/timeline")) {
        return jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
          },
          turnTimings: [],
          rollingMetrics: null,
          degradationEvents: [],
          replayArtifactStatus: { available: false },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    connectMock.mockImplementationOnce(async () => {
      const callbacks = pipecatClientMock.mock.calls[0]?.[0]?.callbacks as
        | { onTrackStopped?: (track: MediaStreamTrack) => void }
        | undefined;
      callbacks?.onTrackStopped?.({ kind: "audio", readyState: "ended" } as MediaStreamTrack);
    });

    const { result } = renderHook(() =>
      useLiveSession({
        accessToken: "token-123",
        conversationId: "conv_1",
        onSessionCreated: () => undefined,
        onSessionEnded: () => undefined,
      })
    );

    await act(async () => {
      await result.current.startSession();
    });

    expect(result.current.errorMessage).toBeNull();
    expect(result.current.connectionState).toBe("connecting");
  });

  it("stores structured diagnostics records for the active session in dev mode", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          conversationId: "conv_1",
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
            startedAt: "2026-04-20T22:00:00Z",
            createdAt: "2026-04-20T22:00:00Z",
            updatedAt: "2026-04-20T22:00:00Z",
          },
          offerEndpoint: "http://127.0.0.1:8000/api/local/sessions/sess_1/offer",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
          },
          transcriptEvents: [],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            id: "sess_1",
            conversationId: "conv_1",
            transportKind: "smallwebrtc",
            status: "connecting",
          },
          turnTimings: [],
          rollingMetrics: null,
          degradationEvents: [],
          replayArtifactStatus: { available: false },
        })
      );

    connectMock.mockImplementationOnce(async () => {
      const callbacks = pipecatClientMock.mock.calls[0]?.[0]?.callbacks as
        | {
            onTransportStateChanged?: (state: string) => void;
            onMicUpdated?: (mic: MediaDeviceInfo) => void;
          }
        | undefined;
      callbacks?.onTransportStateChanged?.("connected");
      callbacks?.onMicUpdated?.({
        deviceId: "mic_1",
        kind: "audioinput",
        label: "MacBook Pro Microphone",
      } as MediaDeviceInfo);
    });

    const { result } = renderHook(() =>
      useLiveSession({
        accessToken: "token-123",
        conversationId: "conv_1",
        onSessionCreated: () => undefined,
        onSessionEnded: () => undefined,
      })
    );

    await act(async () => {
      await result.current.startSession();
    });

    const diagnostics = window.__prosodyLiveDiagnostics ?? [];
    expect(diagnostics.some((record) => record.event === "session-create-request")).toBe(true);
    expect(diagnostics.some((record) => record.event === "session-create-response" && record.sessionId === "sess_1")).toBe(true);
    expect(diagnostics.some((record) => record.event === "transport-state" && record.sessionId === "sess_1")).toBe(true);
    expect(diagnostics.some((record) => record.event === "mic-updated" && record.sessionId === "sess_1")).toBe(true);
  });
});
