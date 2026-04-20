import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";

const useAuthMock = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => useAuthMock()
}));

describe("ProtectedRoute", () => {
  it("redirects signed-out users away from /app", () => {
    useAuthMock.mockReturnValue({ loading: false, session: null });

    render(
      <MemoryRouter initialEntries={["/app"]}>
        <Routes>
          <Route path="/" element={<div>landing</div>} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <div>private</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("landing")).toBeTruthy();
  });
});
