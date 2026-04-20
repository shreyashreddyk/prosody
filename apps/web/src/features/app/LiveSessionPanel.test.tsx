import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LiveSessionPanel } from "./LiveSessionPanel";

const connectMock = vi.fn(async () => undefined);
const disconnectMock = vi.fn(async () => undefined);

vi.mock("@pipecat-ai/client-js", () => ({
  PipecatClient: class {
    connect = connectMock;
    disconnect = disconnectMock;
  }
}));

vi.mock("@pipecat-ai/small-webrtc-transport", () => ({
  SmallWebRTCTransport: class {}
}));

vi.mock("../../lib/supabase", () => ({
  getAgentBaseUrl: () => "http://agent.test"
}));

function buildTimelineResponse(overrides?: Record<string, unknown>) {
  return {
    session: {
      id: "sess_1",
      conversationId: "conv_1",
      transportKind: "smallwebrtc",
      status: "live"
    },
    timeline: [],
    turnTimings: [],
    rollingMetrics: {
      firstAsrPartial: { count: 0 },
      finalAsr: { count: 0 },
      llmFirstToken: { count: 0 },
      ttsFirstByte: { count: 0 },
      playbackStart: { count: 0 },
      turnCompleted: { count: 0 }
    },
    degradationEvents: [],
    replayArtifactStatus: { available: false },
    ...overrides
  };
}

function buildEventsResponse(status: "live" | "reconnecting" = "live") {
  return {
    session: {
      id: "sess_1",
      conversationId: "conv_1",
      transportKind: "smallwebrtc",
      status
    },
    transcriptEvents: [
      {
        id: "evt_1",
        conversationId: "conv_1",
        sessionId: "sess_1",
        turnId: "turn_1",
        role: "assistant",
        kind: "final",
        text: "Fallback text response.",
        createdAt: "2026-04-20T12:00:00Z"
      }
    ],
    latencyEvents: []
  };
}

describe("LiveSessionPanel", () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders degraded transcript badges from timeline events", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/events")) {
        return new Response(JSON.stringify(buildEventsResponse()), { status: 200 });
      }
      return new Response(
        JSON.stringify(
          buildTimelineResponse({
            degradationEvents: [
              {
                id: "deg_1",
                conversationId: "conv_1",
                sessionId: "sess_1",
                turnId: "turn_1",
                category: "provider",
                severity: "warning",
                provider: "asr",
                code: "asr_stall",
                message: "ASR stalled before a partial transcript arrived.",
                createdAt: "2026-04-20T12:00:01Z"
              }
            ]
          })
        ),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveSessionPanel
        accessToken="token"
        conversationId="conv_1"
        selectedSessionId="sess_1"
        onSessionCreated={() => undefined}
        onSessionEnded={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("ASR retry")).toBeTruthy();
    });
  });

  it("shows text-only fallback details in the metrics pane", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/events")) {
        return new Response(JSON.stringify(buildEventsResponse()), { status: 200 });
      }
      return new Response(
        JSON.stringify(
          buildTimelineResponse({
            degradationEvents: [
              {
                id: "deg_2",
                conversationId: "conv_1",
                sessionId: "sess_1",
                turnId: "turn_1",
                category: "provider",
                severity: "warning",
                provider: "tts",
                code: "tts_timeout",
                message: "TTS timed out before audio playback started.",
                details: { fallbackMode: "text_only" },
                createdAt: "2026-04-20T12:00:01Z"
              }
            ]
          })
        ),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveSessionPanel
        accessToken="token"
        conversationId="conv_1"
        selectedSessionId="sess_1"
        onSessionCreated={() => undefined}
        onSessionEnded={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Text only/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/TTS timed out before audio playback started/i)).toBeTruthy();
    });
  });

  it("attempts same-session resume when the server marks the session reconnecting", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/resume")) {
        return new Response(
          JSON.stringify({
            conversationId: "conv_1",
            session: {
              id: "sess_1",
              conversationId: "conv_1",
              transportKind: "smallwebrtc",
              status: "reconnecting"
            },
            offerEndpoint: "http://agent.test/api/local/sessions/sess_1/offer"
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/events")) {
        return new Response(JSON.stringify(buildEventsResponse("reconnecting")), { status: 200 });
      }
      return new Response(
        JSON.stringify(
          buildTimelineResponse({
            session: {
              id: "sess_1",
              conversationId: "conv_1",
              transportKind: "smallwebrtc",
              status: "reconnecting"
            },
            degradationEvents: [
              {
                id: "deg_3",
                conversationId: "conv_1",
                sessionId: "sess_1",
                category: "transport",
                severity: "warning",
                provider: "transport",
                code: "transport_disconnect",
                message: "Transport disconnected. Waiting for reconnect.",
                createdAt: "2026-04-20T12:00:01Z"
              }
            ]
          })
        ),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveSessionPanel
        accessToken="token"
        conversationId="conv_1"
        selectedSessionId="sess_1"
        onSessionCreated={() => undefined}
        onSessionEnded={() => undefined}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://agent.test/api/local/sessions/sess_1/resume",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer token" }
        })
      );
    });
    expect(connectMock).toHaveBeenCalled();
    expect(screen.getByText(/Reconnect in progress/i)).toBeTruthy();
  });
});
