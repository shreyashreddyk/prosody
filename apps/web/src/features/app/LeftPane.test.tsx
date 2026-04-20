import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeftPane } from "./LeftPane";

vi.mock("@prosody/ui", () => ({
  Panel: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div>
      {title && <p>{title}</p>}
      {children}
    </div>
  ),
  EmptyState: ({ heading, description }: { heading: string; description?: string }) => (
    <div>
      <p>{heading}</p>
      {description && <p>{description}</p>}
    </div>
  ),
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("LeftPane", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders conversation list with active highlight", () => {
    render(
      <LeftPane
        conversations={[
          {
            conversation: {
              id: "conv-1",
              title: "Active convo",
              status: "active",
              createdAt: "2026-04-20T10:00:00Z",
              updatedAt: "2026-04-20T10:05:00Z",
            },
            sessionCount: 3,
            sourceCount: 1,
          },
          {
            conversation: {
              id: "conv-2",
              title: "Other convo",
              status: "active",
              createdAt: "2026-04-20T09:00:00Z",
              updatedAt: "2026-04-20T09:05:00Z",
            },
            sessionCount: 1,
            sourceCount: 0,
          },
        ]}
        activeConversationId="conv-1"
        sessions={[]}
        sources={[]}
        uploading={false}
        onSelectConversation={() => undefined}
        onSelectSession={() => undefined}
        onUpload={() => undefined}
      />
    );
    expect(screen.getByText("Active convo")).toBeTruthy();
    expect(screen.getByText("Other convo")).toBeTruthy();
    expect(screen.getByText("3 sessions · 1 sources")).toBeTruthy();
  });

  it("shows empty state when no sessions", () => {
    render(
      <LeftPane
        conversations={[]}
        sessions={[]}
        sources={[]}
        uploading={false}
        onSelectConversation={() => undefined}
        onSelectSession={() => undefined}
        onUpload={() => undefined}
      />
    );
    expect(screen.getByText("No sessions yet")).toBeTruthy();
  });

  it("renders source status badges correctly", () => {
    render(
      <LeftPane
        conversations={[]}
        sessions={[]}
        sources={[
          {
            id: "s1",
            conversationId: "conv-1",
            kind: "document",
            filename: "resume.pdf",
            mimeType: "application/pdf",
            processingStatus: "ready",
            sizeBytes: 1024,
          },
          {
            id: "s2",
            conversationId: "conv-1",
            kind: "document",
            filename: "notes.txt",
            mimeType: "text/plain",
            processingStatus: "pending",
            sizeBytes: 512,
          },
          {
            id: "s3",
            conversationId: "conv-1",
            kind: "document",
            filename: "broken.pdf",
            mimeType: "application/pdf",
            processingStatus: "failed",
          },
        ]}
        uploading={false}
        onSelectConversation={() => undefined}
        onSelectSession={() => undefined}
        onUpload={() => undefined}
      />
    );
    expect(screen.getByText("resume.pdf")).toBeTruthy();
    expect(screen.getByText("ready")).toBeTruthy();
    expect(screen.getByText("pending")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
  });
});
