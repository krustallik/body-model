import { beforeEach, describe, expect, it, vi } from "vitest";

const { getModelStatus, recalculateModelEpisode, rebuildUnified, logEvent } = vi.hoisted(() => ({
  getModelStatus: vi.fn(),
  recalculateModelEpisode: vi.fn(),
  rebuildUnified: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/modules/model-episodes/model-episode.service", () => ({
  getModelStatus,
  recalculateModelEpisode,
}));
vi.mock("@/modules/model-episodes/unified-experimental-physiology-state.service", () => ({
  rebuildUnifiedExperimentalPhysiologyStateV1: rebuildUnified,
}));
vi.mock("@/lib/logger", () => ({ logEvent }));

import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";

describe("Active Energy publication availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recalculateModelEpisode.mockResolvedValue(undefined);
    rebuildUnified.mockResolvedValue(undefined);
  });

  it("reports a non-current production generation and does not attempt Unified publication", async () => {
    getModelStatus
      .mockResolvedValueOnce({ episodeId: 7 })
      .mockResolvedValueOnce({
        episodeId: 7,
        productionCurrent: false,
        latestModeledDate: "2026-10-11",
      });

    await expect(publishActiveEnergyChangesV1({ profileId: 1 })).resolves.toBe(false);

    expect(logEvent).toHaveBeenCalledWith("warn", "active_energy_publication_not_current", {
      reason: "production-generation-unavailable",
    });
    expect(rebuildUnified).not.toHaveBeenCalled();
  });
});
