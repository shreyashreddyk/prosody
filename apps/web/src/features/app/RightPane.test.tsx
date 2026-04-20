import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightPane } from "./RightPane";

vi.mock("@prosody/ui", () => ({
  Panel: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div>
      {title && <p>{title}</p>}
      {children}
    </div>
  ),
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  EmptyState: ({ heading, description }: { heading: string; description?: string }) => (
    <div>
      <p>{heading}</p>
      {description && <p>{description}</p>}
    </div>
  ),
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  LoadingSpinner: () => <span>spinner</span>,
  LatencyBar: ({ label, valueMs }: { label: string; valueMs?: number }) => (
    <div>
      <span>{label}</span>
      <span>{valueMs != null ? `${Math.round(valueMs)} ms` : "—"}</span>
    </div>
  ),
}));

describe("RightPane", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows summary placeholder when no summary", () => {
    render(
      <RightPane
        turnTimings={[]}
        rollingMetrics={null}
        degradationEvents={[]}
        replayStatus={{ available: false }}
        sessions={[]}
        summaryLoading={false}
        flashcardsLoading={false}
        onGenerateSummary={() => undefined}
        onGenerateFlashcards={() => undefined}
      />
    );
    expect(screen.getByText("No summary yet")).toBeTruthy();
  });

  it("shows metrics empty state when no session selected", () => {
    render(
      <RightPane
        turnTimings={[]}
        rollingMetrics={null}
        degradationEvents={[]}
        replayStatus={{ available: false }}
        sessions={[]}
        summaryLoading={false}
        flashcardsLoading={false}
        onGenerateSummary={() => undefined}
        onGenerateFlashcards={() => undefined}
      />
    );
    expect(screen.getByText("No session selected")).toBeTruthy();
  });

  it("renders latency bars when turn timings exist", () => {
    render(
      <RightPane
        selectedSessionId="sess-1"
        turnTimings={[
          {
            turnId: "t1",
            startedAt: "2026-04-20T12:00:00Z",
            completedAt: "2026-04-20T12:00:01Z",
            status: "complete",
            missingStages: [],
            durations: {
              firstAsrPartialMs: 120,
              finalAsrMs: 250,
              llmFirstTokenMs: 180,
              ttsFirstByteMs: 220,
              playbackStartMs: 310,
              turnCompletedMs: 420,
            },
          },
        ]}
        rollingMetrics={null}
        degradationEvents={[]}
        replayStatus={{ available: false }}
        sessions={[]}
        summaryLoading={false}
        flashcardsLoading={false}
        onGenerateSummary={() => undefined}
        onGenerateFlashcards={() => undefined}
      />
    );
    expect(screen.getByText("First ASR")).toBeTruthy();
    expect(screen.getByText("120 ms")).toBeTruthy();
    expect(screen.getByText("Turn completed")).toBeTruthy();
    expect(screen.getByText("420 ms")).toBeTruthy();
  });

  it("shows flashcard empty state", () => {
    render(
      <RightPane
        turnTimings={[]}
        rollingMetrics={null}
        degradationEvents={[]}
        replayStatus={{ available: false }}
        sessions={[]}
        summaryLoading={false}
        flashcardsLoading={false}
        onGenerateSummary={() => undefined}
        onGenerateFlashcards={() => undefined}
      />
    );
    expect(screen.getByText("No flashcards yet")).toBeTruthy();
  });

  it("renders existing flashcard cards", () => {
    render(
      <RightPane
        flashcardSet={{
          id: "fs-1",
          conversationId: "conv-1",
          generatedAt: "2026-04-20T12:00:00Z",
          cards: [
            { id: "c1", prompt: "What is active listening?", answer: "Fully concentrating on the speaker.", tags: [] },
          ],
        }}
        turnTimings={[]}
        rollingMetrics={null}
        degradationEvents={[]}
        replayStatus={{ available: false }}
        sessions={[]}
        summaryLoading={false}
        flashcardsLoading={false}
        onGenerateSummary={() => undefined}
        onGenerateFlashcards={() => undefined}
      />
    );
    expect(screen.getByText("What is active listening?")).toBeTruthy();
  });
});
