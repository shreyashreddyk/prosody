import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CenterPane } from "./CenterPane";
import type { TranscriptRow } from "./LiveSessionPanel";

vi.mock("@prosody/ui", () => ({
  EmptyState: ({ heading, description }: { heading: string; description?: string }) => (
    <div>
      <p>{heading}</p>
      {description && <p>{description}</p>}
    </div>
  ),
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Panel: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div>
      {title && <p>{title}</p>}
      {children}
    </div>
  ),
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  LoadingSpinner: () => <span>loading</span>,
  LatencyBar: () => <div />,
}));

function buildTranscriptRow(overrides: Partial<TranscriptRow> = {}): TranscriptRow {
  return {
    id: "row_1:user",
    turnId: "turn_1",
    sessionId: "sess_1",
    role: "user",
    text: "Hello coach",
    final: true,
    createdAt: "2026-04-20T12:00:00Z",
    ...overrides,
  };
}

describe("CenterPane", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders empty state when no conversation", () => {
    render(
      <CenterPane
        connectionState="idle"
        transcriptRows={[]}
        allSessions={[]}
        allTurns={[]}
        degradationEvents={[]}
        errorMessage={null}
        hasConversation={false}
        onStart={() => undefined}
        onEnd={() => undefined}
      />
    );
    expect(screen.getByText("Welcome to Prosody")).toBeTruthy();
  });

  it("renders transcript rows with role labels", () => {
    render(
      <CenterPane
        connectionState="live"
        transcriptRows={[
          buildTranscriptRow({ id: "t1:user", role: "user", text: "What should I focus on?" }),
          buildTranscriptRow({ id: "t1:assistant", role: "assistant", text: "Focus on clarity." }),
        ]}
        allSessions={[]}
        allTurns={[]}
        degradationEvents={[]}
        errorMessage={null}
        hasConversation={true}
        onStart={() => undefined}
        onEnd={() => undefined}
      />
    );
    expect(screen.getByText("What should I focus on?")).toBeTruthy();
    expect(screen.getByText("Focus on clarity.")).toBeTruthy();
  });

  it("renders degradation badges on transcript rows", () => {
    render(
      <CenterPane
        connectionState="live"
        transcriptRows={[
          buildTranscriptRow({ id: "t1:assistant", turnId: "turn_1", role: "assistant", text: "Fallback text." }),
        ]}
        allSessions={[]}
        allTurns={[]}
        degradationEvents={[
          {
            id: "deg_1",
            conversationId: "conv_1",
            sessionId: "sess_1",
            turnId: "turn_1",
            category: "provider",
            severity: "warning",
            provider: "asr",
            code: "asr_stall",
            message: "ASR stalled.",
            createdAt: "2026-04-20T12:00:01Z",
          },
        ]}
        errorMessage={null}
        hasConversation={true}
        onStart={() => undefined}
        onEnd={() => undefined}
      />
    );
    expect(screen.getByText("ASR retry")).toBeTruthy();
  });

  it("shows reconnect notice when reconnecting", () => {
    render(
      <CenterPane
        connectionState="reconnecting"
        transcriptRows={[]}
        allSessions={[]}
        allTurns={[]}
        degradationEvents={[]}
        errorMessage={null}
        hasConversation={true}
        onStart={() => undefined}
        onEnd={() => undefined}
      />
    );
    expect(screen.getByText(/Reconnect in progress/i)).toBeTruthy();
  });

  it("shows error message in live dock", () => {
    render(
      <CenterPane
        connectionState="failed"
        transcriptRows={[]}
        allSessions={[]}
        allTurns={[]}
        degradationEvents={[]}
        errorMessage="Connection failed"
        hasConversation={true}
        onStart={() => undefined}
        onEnd={() => undefined}
      />
    );
    expect(screen.getByText("Connection failed")).toBeTruthy();
  });
});
