import { beforeEach, describe, expect, it, vi } from "vitest";

const modelServices = vi.hoisted(() => ({ getModelStatus: vi.fn(), getModelHistory: vi.fn(), recalculateModelEpisode: vi.fn() }));
const recoveryServices = vi.hoisted(() => ({ recoverModelEpisode: vi.fn() }));
vi.mock("@/modules/model-episodes/model-episode.service", () => modelServices);
vi.mock("@/modules/model-recovery/model-recovery.service", () => recoveryServices);

import { GET } from "@/app/api/forecast/context/route";
import { POST } from "@/app/api/forecast/action/route";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";

function actionRequest(action: string) {
  return new Request("http://localhost/api/forecast/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
}

describe("forecast context route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the recent modeled context without exposing the full persistence record", async () => {
    modelServices.getModelStatus.mockResolvedValue({ latestModeledDate: "2026-08-24" });
    modelServices.getModelHistory.mockResolvedValue({ days: [{ date: "2026-08-24", endWeightKg: 80, fatMassKg: 16, leanTissueKg: 60, glycogenKg: 0.5, dataQuality: "observed", updatedAt: "now", sourceQuality: { private: true } }], unknownIntervals: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(modelServices.getModelHistory).toHaveBeenCalledWith({ from: "2026-06-26", to: "2026-08-24", limit: 60, offset: 0 });
    expect(await response.json()).toMatchObject({ history: [{ date: "2026-08-24", modeledWeightKg: 80, dataQuality: "observed" }] });
  });

  it("maps a missing active model and unexpected failures", async () => {
    modelServices.getModelStatus.mockRejectedValueOnce(new NoActiveModelEpisodeError());
    expect((await GET()).status).toBe(404);
    modelServices.getModelStatus.mockRejectedValueOnce(new Error("private"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "context_failed" });
  });
});

describe("forecast recovery and recalculation route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unknown actions and delegates supported actions", async () => {
    expect((await POST(actionRequest("unknown"))).status).toBe(400);
    recoveryServices.recoverModelEpisode.mockResolvedValue({ quality: "healthy" });
    expect((await POST(actionRequest("recover"))).status).toBe(200);
    expect(recoveryServices.recoverModelEpisode).toHaveBeenCalledWith({ seed: 20_260_824 });
    modelServices.recalculateModelEpisode.mockResolvedValue({ status: "complete" });
    expect((await POST(actionRequest("recalculate"))).status).toBe(200);
    expect(modelServices.recalculateModelEpisode).toHaveBeenCalledWith({});
  });

  it("keeps evidence errors actionable and unexpected errors private", async () => {
    recoveryServices.recoverModelEpisode.mockRejectedValueOnce(new ModelRecoveryEvidenceError("Need more observations"));
    const evidence = await POST(actionRequest("recover"));
    expect(evidence.status).toBe(422);
    expect(await evidence.json()).toMatchObject({ error: "insufficient_recovery_evidence", message: "Need more observations" });
    modelServices.recalculateModelEpisode.mockRejectedValueOnce(new Error("database secret"));
    const unexpected = await POST(actionRequest("recalculate"));
    expect(unexpected.status).toBe(500);
    expect(await unexpected.json()).toEqual({ error: "recalculation_failed" });
  });
});
