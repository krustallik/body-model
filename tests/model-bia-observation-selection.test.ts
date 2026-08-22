import { describe, expect, it } from "vitest";
import {
  BIA_INITIALIZATION_RECENCY_DEFAULTS,
  selectRecentBiaObservations,
} from "@/model/body-composition/bia-observation-selection";

describe("selectRecentBiaObservations", () => {
  it("documents the recommended default policy", () => {
    expect(BIA_INITIALIZATION_RECENCY_DEFAULTS).toEqual({
      maxAgeDays: 14,
      maxObservations: 7,
    });
  });

  it("selects complete observations within the inclusive default window", () => {
    const selected = selectRecentBiaObservations({
      referenceDate: "2026-08-22",
      observations: [
        { date: "2026-08-08", weightKg: 80.5, bodyFatPercent: 18.9 },
        { date: "2026-08-07", weightKg: 80.6, bodyFatPercent: 19 },
        { date: "2026-08-22", weightKg: 80, bodyFatPercent: 18.7 },
        { date: "2026-08-23", weightKg: 79.9, bodyFatPercent: 18.6 },
        { date: "2026-08-20", weightKg: null, bodyFatPercent: 18.8 },
        { date: "2026-08-19", weightKg: 80.2, bodyFatPercent: null },
      ],
    });

    expect(selected).toEqual([
      { date: "2026-08-22", weightKg: 80, bodyFatPercent: 18.7 },
      { date: "2026-08-08", weightKg: 80.5, bodyFatPercent: 18.9 },
    ]);
  });

  it("returns at most the configured number, newest first", () => {
    const observations = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-08-${String(22 - index).padStart(2, "0")}`,
      weightKg: 80 + index / 10,
      bodyFatPercent: 18 + index / 10,
    }));
    const selected = selectRecentBiaObservations({
      observations,
      referenceDate: "2026-08-22",
      maxObservations: 3,
    });

    expect(selected.map(({ date }) => date)).toEqual([
      "2026-08-22",
      "2026-08-21",
      "2026-08-20",
    ]);
  });

  it("supports an explicit custom recency window", () => {
    const selected = selectRecentBiaObservations({
      referenceDate: "2026-08-22",
      maxAgeDays: 2,
      observations: [
        { date: "2026-08-20", weightKg: 80.2, bodyFatPercent: 18.8 },
        { date: "2026-08-19", weightKg: 80.3, bodyFatPercent: 18.9 },
      ],
    });
    expect(selected).toHaveLength(1);
  });

  it("does not mutate the supplied observations", () => {
    const observations = [
      { date: "2026-08-20", weightKg: 80.2, bodyFatPercent: 18.8 },
      { date: "2026-08-22", weightKg: 80, bodyFatPercent: 18.7 },
    ];
    const snapshot = structuredClone(observations);
    selectRecentBiaObservations({ observations, referenceDate: "2026-08-22" });
    expect(observations).toEqual(snapshot);
  });

  it.each(["2026/08/22", "2026-02-30"])("rejects invalid reference date %s", (referenceDate) => {
    expect(() => selectRecentBiaObservations({ observations: [], referenceDate }))
      .toThrowError();
  });

  it("rejects an invalid observation date even when its values are missing", () => {
    expect(() => selectRecentBiaObservations({
      referenceDate: "2026-08-22",
      observations: [{ date: "not-a-date", weightKg: null, bodyFatPercent: null }],
    })).toThrow(TypeError);
  });

  it.each([
    { maxAgeDays: -1 },
    { maxAgeDays: 1.5 },
    { maxAgeDays: Number.NaN },
    { maxObservations: 0 },
    { maxObservations: 1.5 },
    { maxObservations: Number.POSITIVE_INFINITY },
  ])("rejects an invalid selection policy", (policy) => {
    expect(() => selectRecentBiaObservations({
      observations: [],
      referenceDate: "2026-08-22",
      ...policy,
    })).toThrowError();
  });

  it.each([
    { date: "2026-08-22", weightKg: 0, bodyFatPercent: 18.7 },
    { date: "2026-08-22", weightKg: Number.NaN, bodyFatPercent: 18.7 },
    { date: "2026-08-22", weightKg: 80, bodyFatPercent: -1 },
    { date: "2026-08-22", weightKg: 80, bodyFatPercent: Number.POSITIVE_INFINITY },
  ])("rejects a non-missing invalid observation", (observation) => {
    expect(() => selectRecentBiaObservations({
      observations: [observation],
      referenceDate: "2026-08-22",
    })).toThrowError();
  });
});
