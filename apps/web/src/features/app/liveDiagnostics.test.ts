import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installLiveFetchDiagnostics,
  resetLiveDiagnostics,
  setActiveLiveDiagnosticsSession,
} from "./liveDiagnostics";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe("liveDiagnostics", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    resetLiveDiagnostics();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__prosodyLiveDiagnostics;
    delete window.__prosodyLiveDiagnosticsActiveSessionId;
    delete window.__prosodyLiveDiagnosticsFetchInstalled;
    delete window.__prosodyLiveDiagnosticsPeerConnectionInstalled;
  });

  it("captures offer and ICE patch diagnostics without changing fetch behavior", async () => {
    installLiveFetchDiagnostics();
    setActiveLiveDiagnosticsSession("sess_1");

    await window.fetch("http://127.0.0.1:8000/api/local/sessions/sess_1/offer", {
      method: "PATCH",
      body: JSON.stringify({
        pc_id: "pc_1",
        candidates: [
          { candidate: "candidate:1 1 udp 2122260223 192.168.1.2 54400 typ host", sdp_mid: "0", sdp_mline_index: 0 },
          { candidate: "candidate:2 1 udp 2122260223 10.0.0.2 54401 typ srflx", sdp_mid: "0", sdp_mline_index: 0 },
        ],
      }),
    });

    const diagnostics = window.__prosodyLiveDiagnostics ?? [];
    expect(diagnostics.some((record) => record.event === "offer-patch-request" && record.sessionId === "sess_1")).toBe(true);
    expect(
      diagnostics.some(
        (record) =>
          record.event === "offer-patch-request" &&
          record.details?.candidateCount === 2,
      ),
    ).toBe(true);
    expect(diagnostics.some((record) => record.event === "offer-patch-response" && record.sessionId === "sess_1")).toBe(true);
  });
});
