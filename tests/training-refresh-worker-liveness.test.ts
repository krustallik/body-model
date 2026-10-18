import { describe, expect, it } from "vitest";
import {
  trainingRefreshJobHasStalledProgress,
  trainingRefreshJobShouldRevokeLease,
} from "@/modules/training/training-refresh-worker";

describe("Training refresh liveness age", () => {
  it("detects missing progress after the operational threshold even with a live lease", () => {
    const now = Date.parse("2026-10-16T18:00:00.000Z");
    expect(trainingRefreshJobHasStalledProgress({
      lastProgressAt: new Date(now - 10 * 60_000),
      now,
    })).toBe(true);
  });

  it("does not report recent progress as stuck", () => {
    const now = Date.parse("2026-10-16T18:00:00.000Z");
    expect(trainingRefreshJobHasStalledProgress({
      lastProgressAt: new Date(now - 9 * 60_000),
      now,
    })).toBe(false);
  });

  it("treats a job without a progress timestamp as stuck", () => {
    expect(trainingRefreshJobHasStalledProgress({ lastProgressAt: null, now: Date.now() })).toBe(true);
  });

  it("revokes only a live lease whose durable progress is stale", () => {
    const now = Date.parse("2026-10-16T18:00:00.000Z");
    expect(trainingRefreshJobShouldRevokeLease({
      leaseUntil: new Date(now + 60_000),
      lastProgressAt: new Date(now - 10 * 60_000),
      now,
    })).toBe(true);
    expect(trainingRefreshJobShouldRevokeLease({
      leaseUntil: new Date(now + 60_000),
      lastProgressAt: new Date(now - 9 * 60_000),
      now,
    })).toBe(false);
    expect(trainingRefreshJobShouldRevokeLease({
      leaseUntil: new Date(now - 1),
      lastProgressAt: new Date(now - 10 * 60_000),
      now,
    })).toBe(false);
  });
});
