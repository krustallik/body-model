import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => {
  class TrainingRefreshPendingDiagnosticsError extends Error {}
  return { getModelDiagnostics: vi.fn(), TrainingRefreshPendingDiagnosticsError };
});
const authAccess = vi.hoisted(() => ({
  getSessionPrincipal: vi.fn().mockResolvedValue({ profileId: 42, userId: "user-42", method: "session" }),
}));
vi.mock("@/modules/model-diagnostics/model-diagnostics.service", () => services);
vi.mock("@/modules/auth/access", () => authAccess);

import { GET } from "@/app/api/diagnostics/route";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { TrainingRefreshPendingDiagnosticsError } from "@/modules/model-diagnostics/model-diagnostics.service";

describe("diagnostics application route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 42, userId: "user-42", method: "session" });
  });

  it("returns the compact diagnostic projection", async () => {
    services.getModelDiagnostics.mockResolvedValue({ currentState: { status: "available" } });
    const response = await GET(new Request("http://localhost/api/diagnostics"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ currentState: { status: "available" } });
  });

  it("maps missing model and hides unexpected errors", async () => {
    services.getModelDiagnostics.mockRejectedValueOnce(new NoActiveModelEpisodeError());
    expect((await GET(new Request("http://localhost/api/diagnostics"))).status).toBe(404);
    services.getModelDiagnostics.mockRejectedValueOnce(new Error("database secret"));
    const response = await GET(new Request("http://localhost/api/diagnostics"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "diagnostics_failed" });
  });

  it("fails closed when Training publication is pending", async () => {
    services.getModelDiagnostics.mockRejectedValueOnce(new TrainingRefreshPendingDiagnosticsError());
    const response = await GET(new Request("http://localhost/api/diagnostics"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "training_refresh_pending" });
  });
});

