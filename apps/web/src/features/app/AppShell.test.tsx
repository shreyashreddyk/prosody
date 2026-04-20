import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const useAuthMock = vi.fn();
const loadBootstrapMock = vi.fn();
const loadConversationWorkspaceMock = vi.fn();
const createConversationMock = vi.fn();
const uploadSourceMock = vi.fn();

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("./LiveSessionPanel", () => ({
  useLiveSession: () => ({
    connectionState: "idle",
    session: null,
    transcriptRows: [],
    turnTimings: [],
    rollingMetrics: null,
    degradationEvents: [],
    replayStatus: { available: false },
    errorMessage: null,
    startSession: vi.fn(),
    endSession: vi.fn(),
  }),
}));

vi.mock("@prosody/ui", () => ({
  Panel: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div>
      {title && <p>{title}</p>}
      {children}
    </div>
  ),
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  EmptyState: ({ heading }: { heading: string }) => <p>{heading}</p>,
  LoadingSpinner: () => <span>spinner</span>,
  LatencyBar: () => <div />,
  IconButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

vi.mock("./data", () => ({
  loadBootstrap: (...args: unknown[]) => loadBootstrapMock(...args),
  loadConversationWorkspace: (...args: unknown[]) => loadConversationWorkspaceMock(...args),
  createConversation: (...args: unknown[]) => createConversationMock(...args),
  uploadSource: (...args: unknown[]) => uploadSourceMock(...args),
}));

describe("AppShell", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
      user: { id: "user-1", email: "user@example.com" },
      session: { access_token: "token" },
      signOut: vi.fn(),
    });
    loadBootstrapMock.mockResolvedValue({
      profile: { id: "user-1", displayName: "Prosody User" },
      conversations: [
        {
          conversation: {
            id: "conv-2",
            title: "Returning conversation",
            status: "active",
            createdAt: "2026-04-20T10:00:00Z",
            updatedAt: "2026-04-20T10:05:00Z",
          },
          sessionCount: 2,
          sourceCount: 1,
        },
      ],
      selectedConversationId: "conv-2",
    });
    loadConversationWorkspaceMock.mockResolvedValue({
      conversation: {
        id: "conv-2",
        title: "Returning conversation",
        status: "active",
        createdAt: "2026-04-20T10:00:00Z",
        updatedAt: "2026-04-20T10:05:00Z",
      },
      sessions: [],
      sources: [
        {
          id: "src-1",
          conversationId: "conv-2",
          kind: "document",
          filename: "resume.pdf",
          mimeType: "application/pdf",
          processingStatus: "ready",
        },
      ],
      turns: [],
      summary: {
        id: "sum-1",
        conversationId: "conv-2",
        summaryText: "Welcome back summary",
        generatedAt: "2026-04-20T10:05:00Z",
      },
    });
  });

  it("loads the returning conversation workspace and shows scoped sources", async () => {
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <Routes>
          <Route path="/app" element={<AppShell />} />
          <Route path="/app/conversations/:conversationId" element={<AppShell />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(loadBootstrapMock).toHaveBeenCalled();
      expect(loadConversationWorkspaceMock).toHaveBeenCalledWith("conv-2");
    });

    expect(screen.getAllByText("Returning conversation").length).toBeGreaterThan(0);
    expect(screen.getByText("resume.pdf")).toBeTruthy();
  });

  it("shows the first-time user onboarding when there are no conversations", async () => {
    loadBootstrapMock.mockResolvedValueOnce({
      profile: { id: "user-1", displayName: "New User" },
      conversations: [],
      selectedConversationId: undefined,
    });

    render(
      <MemoryRouter initialEntries={["/app"]}>
        <Routes>
          <Route path="/app" element={<AppShell />} />
          <Route path="/app/conversations/:conversationId" element={<AppShell />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(loadBootstrapMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Create your first workspace")).toBeTruthy();
  });
});
