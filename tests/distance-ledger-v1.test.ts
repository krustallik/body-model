import { describe, expect, it } from "vitest";
import { allocateDistanceLedgerV1, localDayBoundV1 } from "@/model/activity/distance-ledger-v1";
import { fourCellTotalKm } from "@/model/activity/canonical-activity-policy-v1";

const day = localDayBoundV1("2026-09-23", "Europe/Bratislava");
const hour = 3_600_000;

function interval(id: string, startHour: number, endHour: number, distanceKm: number) {
  return {
    id,
    startMs: day.startMs + startHour * hour,
    endMs: day.startMs + endHour * hour,
    distanceKm,
  };
}

describe("distance ledger v1", () => {
  it("does not turn a source conflict into zero or a complete total", () => {
    const nested = allocateDistanceLedgerV1({
      intervals: [interval("long", 1, 3, 10), interval("short", 1.2, 1.4, 2)],
      stepSamples: [],
      workWindows: [],
      stepperWindows: [],
      dayBounds: [day],
    });
    expect(nested.conflictedIntervalIds.sort()).toEqual(["long", "short"]);
    expect(nested.knownAcceptedSubtotalKm).toBe(0);
    expect(nested.rawSumKm).toBe(12);
    expect(nested.complete).toBe(false);
    expect(nested.slices).toEqual([]);
  });

  it("counts an exact duplicate once while keeping the raw sum", () => {
    const first = interval("a", 1, 2, 5);
    const ledger = allocateDistanceLedgerV1({
      intervals: [first, { ...first, id: "b" }],
      stepSamples: [{
        id: "steps",
        startMs: first.startMs,
        endMs: first.endMs,
        steps: 1000,
        source: "apple",
      }],
      workWindows: [],
      stepperWindows: [],
      dayBounds: [day],
    });
    expect(ledger.rawSumKm).toBe(10);
    expect(ledger.knownAcceptedSubtotalKm).toBeCloseTo(5, 9);
    expect(fourCellTotalKm(ledger.days.find((item) => item.date === day.date)!.cells)).toBeCloseTo(5, 9);
  });

  it("keeps the uncovered budget out of the step-weighted portion", () => {
    const ledger = allocateDistanceLedgerV1({
      intervals: [interval("walk", 0, 5, 5)],
      stepSamples: [{
        id: "covered",
        startMs: day.startMs,
        endMs: day.startMs + hour,
        steps: 400,
        source: "apple",
      }],
      workWindows: [],
      stepperWindows: [],
      dayBounds: [day],
    });
    const slice = ledger.slices[0]!;
    expect(slice.coveredBudgetKm).toBeCloseTo(1, 9);
    expect(slice.uncoveredBudgetKm).toBeCloseTo(4, 9);
    expect(slice.distanceKm).toBeCloseTo(5, 9);
    expect(ledger.complete).toBe(false);
    expect(fourCellTotalKm(slice.cells)).toBeCloseTo(5, 9);
  });

  it("ignores manual MS100 steps in the Apple denominator", () => {
    const ledger = allocateDistanceLedgerV1({
      intervals: [interval("walk", 0, 2, 4)],
      stepSamples: [
        { id: "apple", startMs: day.startMs, endMs: day.startMs + hour, steps: 10, source: "apple" },
        { id: "manual", startMs: day.startMs + hour, endMs: day.startMs + 2 * hour, steps: 10_000, source: "manual-ms100" },
      ],
      workWindows: [],
      stepperWindows: [],
      dayBounds: [day],
    });
    const slice = ledger.slices[0]!;
    expect(slice.coveredBudgetKm).toBeCloseTo(2, 9);
    expect(slice.uncoveredBudgetKm).toBeCloseTo(2, 9);
  });

  it("partitions accepted distance into work and outside without creating stepper kilometres", () => {
    const ledger = allocateDistanceLedgerV1({
      intervals: [interval("walk", 0, 2, 4)],
      stepSamples: [{
        id: "apple",
        startMs: day.startMs,
        endMs: day.startMs + 2 * hour,
        steps: 1000,
        source: "apple",
      }],
      workWindows: [{ id: "work", startMs: day.startMs, endMs: day.startMs + hour }],
      stepperWindows: [{ id: "stepper", startMs: day.startMs, endMs: day.startMs + hour }],
      dayBounds: [day],
    });
    const cells = ledger.days.find((item) => item.date === day.date)!.cells;
    const accepted = fourCellTotalKm(cells);
    expect(accepted).toBeCloseTo(4, 9);
    expect(cells.workWithStepperKm + cells.outsideWithStepperKm).toBeLessThanOrEqual(accepted + 1e-9);
    expect(cells.workWithoutStepperKm + cells.workWithStepperKm
      + cells.outsideWithoutStepperKm + cells.outsideWithStepperKm).toBeCloseTo(4, 9);
    expect(cells.workWithStepperKm).toBeCloseTo(2, 9);
    expect(cells.outsideWithoutStepperKm).toBeCloseTo(2, 9);
    expect(ledger.workWindowStepperOverlapHours.work).toBeCloseTo(1, 9);
  });

  it("splits a cross-midnight interval and invalidates both local dates", () => {
    const next = localDayBoundV1("2026-09-24", "Europe/Bratislava");
    const startMs = day.endMs - hour;
    const endMs = day.endMs + hour;
    const ledger = allocateDistanceLedgerV1({
      intervals: [{ id: "overnight", startMs, endMs, distanceKm: 4 }],
      stepSamples: [{ id: "steps", startMs, endMs, steps: 800, source: "apple" }],
      workWindows: [],
      stepperWindows: [],
      dayBounds: [day, next],
    });
    expect(ledger.invalidatedDates).toEqual(["2026-09-23", "2026-09-24"]);
    expect(ledger.knownAcceptedSubtotalKm).toBeCloseTo(4, 9);
    const first = ledger.days.find((item) => item.date === "2026-09-23")!;
    const second = ledger.days.find((item) => item.date === "2026-09-24")!;
    expect(first.invalidated).toBe(true);
    expect(second.invalidated).toBe(true);
    expect(first.knownAcceptedSubtotalKm + second.knownAcceptedSubtotalKm).toBeCloseTo(4, 9);
  });

  it("uses the real local day length across a DST transition", () => {
    const spring = localDayBoundV1("2026-03-29", "Europe/Bratislava");
    const autumn = localDayBoundV1("2026-10-25", "Europe/Bratislava");
    expect((spring.endMs - spring.startMs) / hour).toBe(23);
    expect((autumn.endMs - autumn.startMs) / hour).toBe(25);
  });
});
