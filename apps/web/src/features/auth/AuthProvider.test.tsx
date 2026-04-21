import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";

const getSessionMock = vi.fn();
const getUserMock = vi.fn();
const signOutMock = vi.fn();
const onAuthStateChangeMock = vi.fn();

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
      getUser: () => getUserMock(),
      signOut: () => signOutMock(),
      onAuthStateChange: () => onAuthStateChangeMock(),
    },
  },
}));

function Probe() {
  const { loading, session, user } = useAuth();
  return (
    <div>
      <span>{loading ? "loading" : "ready"}</span>
      <span>{session ? "session" : "no-session"}</span>
      <span>{user ? "user" : "no-user"}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    signOutMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears an invalid persisted session during bootstrap", async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "stale-token",
          user: { id: "user-1", email: "user@example.com" },
        },
      },
    });
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid jwt"),
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("ready")).toBeTruthy();
      expect(screen.getByText("no-session")).toBeTruthy();
      expect(screen.getByText("no-user")).toBeTruthy();
    });

    expect(signOutMock).toHaveBeenCalled();
  });
});
