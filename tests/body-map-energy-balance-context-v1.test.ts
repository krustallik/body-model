import { describe, expect, it } from "vitest";
import { summarizeBodyMapEnergyBalanceContextV1 } from "@/modules/training/body-map-energy-balance-context-v1";

function dateShift(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function inputs(validPerWindow = 19) {
  const dates = Array.from({ length: 58 }, (_, index) => dateShift("2026-01-01", index));
  const earlyEnd = dateShift("2026-01-01", 18);
  const lateStart = dateShift("2026-02-27", -18);
  const validDates = new Set([
    ...dates.filter((date) => date >= "2026-01-01" && date <= earlyEnd).slice(0, validPerWindow),
    ...dates.filter((date) => date >= lateStart && date <= "2026-02-27").slice(0, validPerWindow),
  ]);
  const balance = (date: string) => date < lateStart ? -250 : 150;
  const nutritionDays = [...validDates].map((date) => ({ date, caloriesKcal: 2_000 }));
  const modeledDays: unknown[] = [...validDates].map((date) => ({
    date,
    status: "complete",
    dataQuality: "observed",
    nutritionSource: "observed",
    nutritionImputationMethod: null,
    nutritionGapLength: 0,
    energyIntakeKcal: 2_000,
    energyExpenditureKcal: 2_000 - balance(date),
    modelVersion: "active-test-model",
  }));
  return { nutritionDays, modeledDays };
}

describe("Body Map calorie context", () => {
  it("compares only highly covered, observed early and late windows", () => {
    const source = inputs();
    expect(summarizeBodyMapEnergyBalanceContextV1({
      periodFrom: "2026-01-01T00:00:00.000Z",
      periodTo: "2026-02-27T23:59:59.999Z",
      activeEpisodeId: 12,
      modelHistoryCurrent: true,
      ...source,
    })).toMatchObject({
      status: "available",
      sourceEpisodeId: 12,
      modelVersion: "active-test-model",
      windowDays: 19,
      early: { medianKcalPerDay: -250, validDays: 19 },
      late: { medianKcalPerDay: 150, validDays: 19 },
    });
  });

  it("hides balance when the observation coverage is below the threshold", () => {
    const source = inputs(14);
    expect(summarizeBodyMapEnergyBalanceContextV1({
      periodFrom: "2026-01-01T00:00:00.000Z",
      periodTo: "2026-02-27T23:59:59.999Z",
      activeEpisodeId: 12,
      modelHistoryCurrent: true,
      ...source,
    })).toMatchObject({ status: "unavailable", reason: "observed-days-not-complete-enough" });
  });

  it("rejects imputed, incomplete, and unmatched nutrition days", () => {
    const source = inputs();
    source.modeledDays = source.modeledDays.map((day, index) => {
      const record = day as Record<string, unknown>;
      return index % 2 === 0
        ? { ...record, nutritionSource: "imputed-local", nutritionImputationMethod: "bridge" }
        : record;
    });
    expect(summarizeBodyMapEnergyBalanceContextV1({
      periodFrom: "2026-01-01T00:00:00.000Z",
      periodTo: "2026-02-27T23:59:59.999Z",
      activeEpisodeId: 12,
      modelHistoryCurrent: true,
      ...source,
    }).status).toBe("unavailable");
  });

  it("keeps stale or missing active model history unavailable", () => {
    const source = inputs();
    expect(summarizeBodyMapEnergyBalanceContextV1({
      periodFrom: "2026-01-01T00:00:00.000Z",
      periodTo: "2026-02-27T23:59:59.999Z",
      activeEpisodeId: 12,
      modelHistoryCurrent: false,
      ...source,
    })).toMatchObject({ status: "unavailable", reason: "model-energy-not-current" });
  });

  it("returns an explicit null model version when there are no valid modeled days", () => {
    expect(summarizeBodyMapEnergyBalanceContextV1({
      periodFrom: "2026-01-01T00:00:00.000Z",
      periodTo: "2026-02-27T23:59:59.999Z",
      activeEpisodeId: 12,
      modelHistoryCurrent: true,
      nutritionDays: [],
      modeledDays: [],
    })).toMatchObject({
      status: "unavailable", reason: "observed-days-not-complete-enough", modelVersion: null,
    });
  });

  it("does not compare calorie estimates across model versions", () => {
    const source = inputs();
    source.modeledDays = source.modeledDays.map((day, index) => ({
      ...(day as Record<string, unknown>),
      modelVersion: index < 19 ? "older-model" : "active-test-model",
    }));
    expect(summarizeBodyMapEnergyBalanceContextV1({
      periodFrom: "2026-01-01T00:00:00.000Z",
      periodTo: "2026-02-27T23:59:59.999Z",
      activeEpisodeId: 12,
      modelHistoryCurrent: true,
      ...source,
    })).toMatchObject({ status: "unavailable", reason: "model-energy-not-current", modelVersion: null });
  });
});
