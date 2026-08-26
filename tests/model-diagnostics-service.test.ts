import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getActive: vi.fn(), status: vi.fn(), evidence: vi.fn(), recovery: vi.fn(), build: vi.fn() }));
vi.mock("@/modules/model-episodes/model-episode.repository", () => ({ ModelEpisodeRepository: class { getActive = dependencies.getActive; status = dependencies.status; } }));
vi.mock("@/modules/model-diagnostics/model-diagnostics.repository", () => ({ ModelDiagnosticsRepository: class { loadEvidence = dependencies.evidence; } }));
vi.mock("@/modules/model-recovery/model-recovery.repository", () => ({ ModelRecoveryRepository: class { latestStatus = dependencies.recovery; } }));
vi.mock("@/modules/model-diagnostics/model-diagnostics", () => ({ buildDiagnosticsDto: dependencies.build }));

import { getModelDiagnostics } from "@/modules/model-diagnostics/model-diagnostics.service";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";

describe("getModelDiagnostics", () => {
  beforeEach(() => { vi.clearAllMocks(); dependencies.build.mockReturnValue({ ok: true }); dependencies.recovery.mockResolvedValue(null); });

  it("throws when no active episode exists", async () => {
    dependencies.getActive.mockResolvedValue(null);
    await expect(getModelDiagnostics({} as never)).rejects.toBeInstanceOf(NoActiveModelEpisodeError);
  });

  it("throws when the selected episode disappears before status projection", async () => {
    dependencies.getActive.mockResolvedValue({ id: 2 });
    dependencies.status.mockResolvedValue(null);
    await expect(getModelDiagnostics({} as never)).rejects.toBeInstanceOf(NoActiveModelEpisodeError);
  });

  it("uses an inclusive 28-day calendar window and composes read-only sources", async () => {
    const episode = { id: 2, startDate: "2026-01-01", latestModeledDate: "2026-08-25" };
    const status = { episodeId: 2 };
    const evidence = { modeledDayCount: 28 };
    dependencies.getActive.mockResolvedValue(episode);
    dependencies.status.mockResolvedValue(status);
    dependencies.evidence.mockResolvedValue(evidence);
    dependencies.recovery.mockResolvedValue({ status: "recovered" });
    expect(await getModelDiagnostics({} as never)).toEqual({ ok: true });
    expect(dependencies.evidence).toHaveBeenCalledWith(2, "2026-07-29", "2026-08-25");
    expect(dependencies.build).toHaveBeenCalledWith({ episode, status, evidence, windowStartDate: "2026-07-29", recovery: { status: "recovered" } });
  });

  it("does not count source evidence from before a short episode", async () => {
    const episode = { id: 2, startDate: "2026-08-20", latestModeledDate: "2026-08-25" };
    dependencies.getActive.mockResolvedValue(episode);
    dependencies.status.mockResolvedValue({ episodeId: 2 });
    dependencies.evidence.mockResolvedValue({ modeledDayCount: 6 });
    await getModelDiagnostics({} as never);
    expect(dependencies.evidence).toHaveBeenCalledWith(2, "2026-08-20", "2026-08-25");
  });

  it("returns zero recent evidence before any modeled date", async () => {
    const episode = { id: 2, startDate: "2026-08-20", latestModeledDate: null };
    const status = { episodeId: 2 };
    dependencies.getActive.mockResolvedValue(episode);
    dependencies.status.mockResolvedValue(status);
    await getModelDiagnostics({} as never);
    expect(dependencies.evidence).not.toHaveBeenCalled();
    expect(dependencies.build).toHaveBeenCalledWith(expect.objectContaining({
      windowStartDate: null,
      evidence: { modeledDayCount: 0, completeDayCount: 0, incompleteDayCount: 0, observedNutritionDayCount: 0, imputedNutritionDayCount: 0, unresolvedNutritionDayCount: 0, weightObservationCount: 0 },
    }));
  });
});
