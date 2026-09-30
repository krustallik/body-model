import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  initializeNewModelEpisode: vi.fn(),
  recalculateModelEpisode: vi.fn(),
  recoverModelEpisode: vi.fn(),
}));
vi.mock("@/modules/model-episodes/model-episode.service", () => ({
  initializeNewModelEpisode: services.initializeNewModelEpisode,
  recalculateModelEpisode: services.recalculateModelEpisode,
}));
vi.mock("@/modules/model-recovery/model-recovery.service", () => ({
  recoverModelEpisode: services.recoverModelEpisode,
}));

import { POST } from "@/app/api/forecast/action/route";

function request(): Request {
  return new Request("http://localhost/api/forecast/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "recalculate" }),
  });
}

describe("forecast action recalculation route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers the unchanged active episode after candidate rejection and gates overlap with 429", async () => {
    let enteredRecovery!: () => void;
    const recoveryStarted = new Promise<void>((resolve) => { enteredRecovery = resolve; });
    let finishRecovery!: () => void;
    const recoveryHold = new Promise<void>((resolve) => { finishRecovery = resolve; });
    const activeEpisodeId = 41;

    // The service represents candidate rejection by returning the existing
    // active episode. PostgreSQL integration coverage asserts its identity,
    // start date, and persisted state remain unchanged.
    services.recalculateModelEpisode.mockResolvedValue({
      status: "ok",
      episodeId: activeEpisodeId,
      recoveryRequired: true,
    });
    services.recoverModelEpisode.mockImplementation(async () => {
      enteredRecovery();
      await recoveryHold;
      return { status: "recovered", episodeId: activeEpisodeId };
    });

    const firstRequest = POST(request());
    await recoveryStarted;
    let overlappingResponse: Response;
    try {
      overlappingResponse = await POST(request());
    } finally {
      finishRecovery();
    }

    const response = await firstRequest;
    expect(services.recalculateModelEpisode).toHaveBeenCalledTimes(1);
    expect(services.recalculateModelEpisode).toHaveBeenCalledWith({});
    expect(services.recoverModelEpisode).toHaveBeenCalledWith({
      seed: 20_260_824,
      episodeId: activeEpisodeId,
    });
    expect(overlappingResponse.status).toBe(429);
    expect(overlappingResponse.headers.get("Retry-After")).toBe("1");
    await expect(overlappingResponse.json()).resolves.toEqual({ error: "operation_in_progress" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      episodeId: activeEpisodeId,
      recoveryRequired: true,
      recovery: { status: "recovered", episodeId: activeEpisodeId },
    });
  });
});
