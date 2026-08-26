import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ getModelDiagnostics: vi.fn() }));
vi.mock("@/modules/model-diagnostics/model-diagnostics.service", () => services);

import { GET } from "@/app/api/diagnostics/route";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";

describe("diagnostics application route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the compact diagnostic projection", async () => {
    services.getModelDiagnostics.mockResolvedValue({ currentState: { status: "available" } });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ currentState: { status: "available" } });
  });

  it("maps missing model and hides unexpected errors", async () => {
    services.getModelDiagnostics.mockRejectedValueOnce(new NoActiveModelEpisodeError());
    expect((await GET()).status).toBe(404);
    services.getModelDiagnostics.mockRejectedValueOnce(new Error("database secret"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "diagnostics_failed" });
  });
});

