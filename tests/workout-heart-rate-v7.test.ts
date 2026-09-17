import { describe, expect, it } from "vitest";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";

const interval = { startAt: "2026-09-17T16:00:00.000Z", endAt: "2026-09-17T17:00:00.000Z" };
const sample = (timestamp: string, bpm: number, provider = "shortcut", device: string | null = null) => ({
  timestamp, bpm, provenance: { provider, device },
});

function loaded(samples: ReturnType<typeof sample>[]) {
  return canonicalizeWorkoutHeartRateEvidenceV7({ workoutInterval: interval, heartRate: { availability: "loaded", samples } });
}

describe("WorkoutHeartRateEvidenceV7", () => {
  it("keeps HR source unavailable distinct from a loaded source with zero samples", () => {
    const unavailable = canonicalizeWorkoutHeartRateEvidenceV7({ workoutInterval: interval, heartRate: { availability: "unavailable" } });
    const zero = loaded([]);

    expect(unavailable).toMatchObject({ availability: "unavailable", availabilityReason: "no-hr-source", samples: null, sampleCount: null, samplingTopology: null, summary: null });
    expect(zero).toMatchObject({ availability: "loaded", samples: [], sampleCount: 0, samplingTopology: { sampledSpan: null, leadingGap: null, interSampleGaps: [], trailingGap: null }, summary: null });
  });

  it("sorts interval-contained samples without deduplicating equal timestamps", () => {
    const result = loaded([
      sample("2026-09-17T16:30:00.000Z", 130, "z", "watch"),
      sample("2026-09-17T16:10:00.000Z", 100, "a", "strap"),
      sample("2026-09-17T16:10:00.000Z", 120, "b", "ring"),
    ]);

    expect(result.samples?.map(({ timestamp, bpm }) => ({ timestamp, bpm }))).toEqual([
      { timestamp: "2026-09-17T16:10:00.000Z", bpm: 100 },
      { timestamp: "2026-09-17T16:10:00.000Z", bpm: 120 },
      { timestamp: "2026-09-17T16:30:00.000Z", bpm: 130 },
    ]);
    expect(result.sampleCount).toBe(3);
    expect(result.samplingTopology?.interSampleGaps).toEqual([
      { startAt: "2026-09-17T16:10:00.000Z", endAt: "2026-09-17T16:10:00.000Z" },
      { startAt: "2026-09-17T16:10:00.000Z", endAt: "2026-09-17T16:30:00.000Z" },
    ]);
  });

  it("includes interval boundaries and ignores outside records without mutating raw samples", () => {
    const raw = [
      sample("2026-09-17T15:59:59.999Z", 90),
      sample("2026-09-17T16:00:00.000Z", 100),
      sample("2026-09-17T17:00:00.000Z", 140),
      sample("2026-09-17T17:00:00.001Z", 150),
    ];
    const result = loaded(raw);

    expect(result.samples?.map(({ bpm }) => bpm)).toEqual([100, 140]);
    expect(result.samplingTopology).toEqual({
      sampledSpan: { startAt: interval.startAt, endAt: interval.endAt },
      leadingGap: { startAt: interval.startAt, endAt: interval.startAt },
      interSampleGaps: [{ startAt: interval.startAt, endAt: interval.endAt }],
      trailingGap: { startAt: interval.endAt, endAt: interval.endAt },
    });
    expect(raw).toHaveLength(4);
    expect(raw[0].bpm).toBe(90);
  });

  it("describes one sample, irregular gaps, and sample-only statistics", () => {
    const one = loaded([sample("2026-09-17T16:20:00.000Z", 150)]);
    expect(one.samplingTopology).toEqual({
      sampledSpan: { startAt: "2026-09-17T16:20:00.000Z", endAt: "2026-09-17T16:20:00.000Z" },
      leadingGap: { startAt: interval.startAt, endAt: "2026-09-17T16:20:00.000Z" },
      interSampleGaps: [],
      trailingGap: { startAt: "2026-09-17T16:20:00.000Z", endAt: interval.endAt },
    });

    const irregular = loaded([
      sample("2026-09-17T16:05:00.000Z", 90),
      sample("2026-09-17T16:07:00.000Z", 110),
      sample("2026-09-17T16:45:00.000Z", 160),
    ]);
    expect(irregular.samplingTopology?.interSampleGaps).toEqual([
      { startAt: "2026-09-17T16:05:00.000Z", endAt: "2026-09-17T16:07:00.000Z" },
      { startAt: "2026-09-17T16:07:00.000Z", endAt: "2026-09-17T16:45:00.000Z" },
    ]);
    expect(irregular.summary).toEqual({ sampleMeanBpm: 120, maxObservedBpm: 160, basis: "observed-samples-only" });
  });

  it("preserves mixed per-sample provenance and exposes a deterministic distinct-source summary", () => {
    const result = loaded([
      sample("2026-09-17T16:05:00.000Z", 100, "garmin", "watch"),
      sample("2026-09-17T16:25:00.000Z", 120, "polar", "strap"),
      sample("2026-09-17T16:35:00.000Z", 110, "garmin", "watch"),
    ]);

    expect(result.samples?.map(({ provenance }) => provenance)).toEqual([
      { provider: "garmin", device: "watch" },
      { provider: "polar", device: "strap" },
      { provider: "garmin", device: "watch" },
    ]);
    expect(result.distinctSources).toEqual([
      { provider: "garmin", device: "watch" },
      { provider: "polar", device: "strap" },
    ]);
  });

  it("retains different sampling topology for equal sample mean and observed maximum", () => {
    const early = loaded([
      sample("2026-09-17T16:05:00.000Z", 100),
      sample("2026-09-17T16:10:00.000Z", 140),
    ]);
    const late = loaded([
      sample("2026-09-17T16:45:00.000Z", 100),
      sample("2026-09-17T16:55:00.000Z", 140),
    ]);

    expect(early.summary).toEqual(late.summary);
    expect(early.samplingTopology).not.toEqual(late.samplingTopology);
  });
});
