import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  health: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    strengthDiarySession: { findMany: mocks.sessions },
    dailyHealthData: { findMany: mocks.health },
  },
}));

vi.mock("@/modules/health/sleep.repository", () => ({
  SleepRepository: class {
    summariesByDates(...args: unknown[]) {
      return mocks.sleep(...args);
    }
  },
}));

import { readBodyMapTrainingAnalyticsV1 } from "@/modules/training/body-map-training-analytics.repository";

const sessionDate = "2026-09-03";
const updatedAt = new Date("2026-09-03T18:00:00.000Z");

describe("Body Map analytics repository", () => {
  beforeEach(() => {
    mocks.sessions.mockReset();
    mocks.health.mockReset();
    mocks.sleep.mockReset();
    mocks.sessions.mockResolvedValue([{
      id: 41,
      effectiveAccountingAt: new Date(`${sessionDate}T12:00:00.000Z`),
      matchedWorkout: null,
      webStartedAt: new Date(`${sessionDate}T12:00:00.000Z`),
      createdAt: new Date(`${sessionDate}T12:00:00.000Z`),
      accountingTimeZone: "UTC",
      sessionIntent: null,
      sessionLoadAssessment: null,
      trainingBlockLabel: null,
      trainingWeekNumber: null,
      exercises: [],
    }]);
    mocks.health.mockResolvedValue([]);
    mocks.sleep.mockResolvedValue(new Map());
  });

  it("does not claim a nutrition source when a daily row has no recorded nutrition values", async () => {
    mocks.health.mockResolvedValue([{ date: sessionDate, caloriesKcal: null, proteinG: null, updatedAt }]);

    const result = await readBodyMapTrainingAnalyticsV1(41, 4, new Date("2026-09-10T00:00:00.000Z"));

    expect(result.sessionContexts[0]?.nutrition).toEqual({
      status: "unavailable",
      date: sessionDate,
      caloriesKcal: null,
      proteinG: null,
      source: null,
      updatedAt: null,
    });
  });

  it("reads a post-session assessment independently from the legacy training intent", async () => {
    mocks.sessions.mockResolvedValue([{
      id: 42,
      effectiveAccountingAt: new Date(`${sessionDate}T12:00:00.000Z`),
      matchedWorkout: null,
      webStartedAt: new Date(`${sessionDate}T12:00:00.000Z`),
      createdAt: new Date(`${sessionDate}T12:00:00.000Z`),
      accountingTimeZone: "UTC",
      sessionIntent: "easy-deload",
      sessionLoadAssessment: "LIGHTER",
      trainingBlockLabel: null,
      trainingWeekNumber: null,
      exercises: [],
    }]);

    const result = await readBodyMapTrainingAnalyticsV1(41, 4, new Date("2026-09-10T00:00:00.000Z"));

    expect(result.sessions[0]?.loadAssessment).toMatchObject({ status: "lighter", source: "manual", reason: "manual-response" });
  });

  it("preserves source and update time when at least one nutrition value is recorded", async () => {
    mocks.health.mockResolvedValue([{ date: sessionDate, caloriesKcal: null, proteinG: 120, updatedAt }]);

    const result = await readBodyMapTrainingAnalyticsV1(41, 4, new Date("2026-09-10T00:00:00.000Z"));

    expect(result.sessionContexts[0]?.nutrition).toEqual({
      status: "recorded",
      date: sessionDate,
      caloriesKcal: null,
      proteinG: 120,
      source: "daily-health-record",
      updatedAt: updatedAt.toISOString(),
    });
  });
});
