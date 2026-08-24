import { describe, expect, it } from "vitest";
import {
  recoveryConfigFingerprint,
  recoverySourceFingerprint,
  resolvedRecoveryConfig,
  stableSha256,
} from "@/modules/model-recovery/recovery-fingerprint";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { persistedEpisodeFixture, sourceDay } from "./model-episode-fixtures";

describe("recovery invalidation fingerprints", () => {
  it("canonicalizes object keys and dates before hashing", () => {
    expect(stableSha256({ b: 2, a: 1, ignored: undefined }))
      .toBe(stableSha256({ a: 1, b: 2 }));
    expect(stableSha256({ at: new Date("2026-08-24T10:00:00.000Z") }))
      .toBe(stableSha256({ at: "2026-08-24T10:00:00.000Z" }));
  });

  it("fingerprints the fully resolved configuration", () => {
    const defaults = resolvedRecoveryConfig();
    expect(recoveryConfigFingerprint(defaults)).toHaveLength(64);
    expect(recoveryConfigFingerprint(resolvedRecoveryConfig({ particleCount: 256 })))
      .not.toBe(recoveryConfigFingerprint(defaults));
  });

  it("changes after a relevant source or personalization edit", () => {
    const episode = persistedEpisodeFixture("2026-08-20");
    const built = (caloriesKcal: number) => buildSimulationDays({
      from: "2026-08-20",
      to: "2026-08-20",
      sources: {
        days: [sourceDay("2026-08-20", { caloriesKcal })],
        snapshots: [],
        workIntervals: [],
      },
    });
    const baseline = recoverySourceFingerprint({ episode, days: built(2_500), donorDays: [] });
    expect(recoverySourceFingerprint({ episode, days: built(2_600), donorDays: [] }))
      .not.toBe(baseline);
    expect(recoverySourceFingerprint({
      episode: { ...episode, activityCalibration: 1.05 },
      days: built(2_500),
      donorDays: [],
    })).not.toBe(baseline);
  });
});
