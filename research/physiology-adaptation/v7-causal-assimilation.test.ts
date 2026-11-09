import assert from "node:assert/strict";
import { test } from "vitest";
import { runtimeStateFromStructuralStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { assimilateV7ScaleStateAsOf } from "./v7-causal-assimilation";

const state = runtimeStateFromStructuralStateV7({
  fatMassKg: 20,
  skeletalMuscleKg: 30,
  otherLeanTissueKg: 25,
  glycogenKg: 0.4,
  glycogenWaterKg: 1.08,
  ecfDeviationKg: 0,
  transientExerciseWaterKg: 0,
  adaptiveThermogenesisKcalPerDay: 0,
  weightFilterState: { estimatedWeightKg: 76.48, varianceKg2: 0.25 },
});

const rows = [
  { date: "2033-04-01", weightKg: 76.5, receivedAt: "2033-04-01T06:00:00Z" },
  { date: "2033-04-02", weightKg: 75.8, receivedAt: "2033-04-02T06:00:00Z" },
  // A correction received later cannot enter the earlier filter state.
  { date: "2033-04-02", weightKg: 76.1, receivedAt: "2033-04-04T08:00:00Z" },
  { date: "2033-04-03", weightKg: 74.9, receivedAt: "2033-04-03T06:00:00Z" },
];

test("V7 scale assimilation is causal and changes only observation state", () => {
  const input = { fromDate: "2033-04-01", originDate: "2033-04-03", inputAsOf: "2033-04-04T00:00:00Z" };
  const result = assimilateV7ScaleStateAsOf(state, rows, input);
  const eligibleRows = rows.filter((row) => Date.parse(row.receivedAt) < Date.parse(input.inputAsOf));
  const withoutLateCorrection = assimilateV7ScaleStateAsOf(state, eligibleRows, input);
  const withFutureRows = assimilateV7ScaleStateAsOf(state, [...rows,
    { date: "2033-04-04", weightKg: 60, receivedAt: "2033-04-05T06:00:00Z" },
  ], input);

  assert.equal(result.observationCount, 3);
  assert.equal(result.lastObservationDate, "2033-04-03");
  assert.ok(result.resultingState.weightFilterState!.estimatedWeightKg < state.weightFilterState!.estimatedWeightKg);
  assert.deepEqual(result.resultingState.compartments, state.compartments,
    "a scale observation must not create tissue or water-compartment changes");
  assert.deepEqual(result.resultingState.adaptiveThermogenesisKcalPerDay, state.adaptiveThermogenesisKcalPerDay);
  assert.deepEqual(withoutLateCorrection, result,
    "a later correction cannot affect the as-of state");
  assert.deepEqual(withFutureRows, result,
    "future observations cannot affect the as-of state");
  assert.deepEqual(state.compartments, result.resultingState.compartments,
    "the source runtime state remains unchanged");
});

test("each newly received weighing updates the current and following scale state only", () => {
  const snapshots = [
    { date: "2033-04-01", weightKg: 80, receivedAt: "2033-04-01T06:00:00Z" },
    { date: "2033-04-02", weightKg: 79.5, receivedAt: "2033-04-02T06:00:00Z" },
    { date: "2033-04-02", weightKg: 82, receivedAt: "2033-04-04T00:00:00Z" },
    { date: "2033-04-03", weightKg: 79.2, receivedAt: "2033-04-03T06:00:00Z" },
  ];
  const origins = ["2033-04-01", "2033-04-02", "2033-04-03"];
  let priorState = state;
  let priorScaleKg: number | null = null;

  for (const [index, originDate] of origins.entries()) {
    const inputAsOf = `${origins[index + 1] ?? "2033-04-04"}T00:00:00Z`;
    const result = assimilateV7ScaleStateAsOf(priorState, snapshots, {
      fromDate: origins[0]!, originDate, inputAsOf,
    });
    const receiptCutoff = Date.parse(inputAsOf);
    const independentlyPrefiltered = assimilateV7ScaleStateAsOf(
      priorState,
      snapshots.filter((row) => Date.parse(row.receivedAt) < receiptCutoff),
      { fromDate: origins[0]!, originDate, inputAsOf },
    );
    const scaleState = result.resultingState.weightFilterState;

    assert.deepEqual(result, independentlyPrefiltered,
      "a row received exactly at the exclusive cutoff must not affect the state");
    assert.equal(result.observationCount, index + 1);
    assert.equal(result.lastObservationDate, originDate);
    assert.ok(scaleState);
    if (priorScaleKg !== null) assert.notEqual(scaleState.estimatedWeightKg, priorScaleKg);
    assert.deepEqual(result.resultingState.compartments, state.compartments,
      "new scale readings must not create abrupt tissue or water-mass changes");
    assert.deepEqual(result.resultingState.adaptiveThermogenesisKcalPerDay,
      state.adaptiveThermogenesisKcalPerDay);

    priorScaleKg = scaleState.estimatedWeightKg;
    priorState = result.resultingState;
  }
});

test("a late-arriving weighing correction updates only origins at or after its receipt cutoff", () => {
  const earlyInput = {
    fromDate: "2033-04-01",
    originDate: "2033-04-03",
    inputAsOf: "2033-04-04T00:00:00Z",
  };
  const lateInput = {
    fromDate: "2033-04-01",
    originDate: "2033-04-04",
    inputAsOf: "2033-04-05T00:00:00Z",
  };
  const snapshots = [
    { date: "2033-04-01", weightKg: 76.5, receivedAt: "2033-04-01T06:00:00Z" },
    { date: "2033-04-02", weightKg: 75.8, receivedAt: "2033-04-02T06:00:00Z" },
    { date: "2033-04-03", weightKg: 74.9, receivedAt: "2033-04-03T06:00:00Z" },
    // A later authoritative snapshot for Apr 2 is available only from Apr 4.
    { date: "2033-04-02", weightKg: 76.1, receivedAt: "2033-04-04T00:00:00Z" },
    { date: "2033-04-04", weightKg: 60, receivedAt: "2033-04-05T00:00:00Z" },
  ];

  const early = assimilateV7ScaleStateAsOf(state, snapshots, earlyInput);
  const earlyWithoutNotYetReceivedCorrection = assimilateV7ScaleStateAsOf(state,
    snapshots.filter((row) => Date.parse(row.receivedAt) < Date.parse(earlyInput.inputAsOf)), earlyInput);
  const late = assimilateV7ScaleStateAsOf(state, snapshots, lateInput);
  const lateWithoutCorrection = assimilateV7ScaleStateAsOf(state,
    snapshots.filter((row) => row.date !== "2033-04-02" || row.receivedAt !== "2033-04-04T00:00:00Z"), lateInput);

  assert.deepEqual(early, earlyWithoutNotYetReceivedCorrection,
    "the Apr 4 receipt must not alter the state issued before its receipt cutoff");
  assert.notDeepEqual(late.resultingState.weightFilterState, lateWithoutCorrection.resultingState.weightFilterState,
    "the newly available correction must update the current as-of filter state");
  assert.equal(late.observationCount, 3,
    "the exclusive cutoff must also exclude the Apr 5 observation");
  assert.deepEqual(late.resultingState.compartments, state.compartments,
    "a late scale correction must never rewrite tissue or water compartments");
  assert.deepEqual(late.resultingState.adaptiveThermogenesisKcalPerDay,
    state.adaptiveThermogenesisKcalPerDay);
});

test("V7 scale assimilation rejects an invalid or reversed date range", () => {
  assert.throws(() => assimilateV7ScaleStateAsOf(state, rows, {
    fromDate: "2033-04-04", originDate: "2033-04-03", inputAsOf: "2033-04-04T00:00:00Z",
  }), /ordered calendar dates/);
});

test("daily filter uncertainty advances causally between the last weighing and the origin", () => {
  const result = assimilateV7ScaleStateAsOf(state, [
    { date: "2033-04-01", weightKg: 76.5, receivedAt: "2033-04-01T06:00:00Z" },
  ], {
    fromDate: "2033-04-01",
    originDate: "2033-04-04",
    inputAsOf: "2033-04-05T00:00:00Z",
  });

  assert.equal(result.observationCount, 1);
  assert.equal(result.lastObservationDate, "2033-04-01");
  assert.equal(result.resultingState.weightFilterState?.estimatedWeightKg, 76.5);
  assert.ok(result.resultingState.weightFilterState!.varianceKg2 > 0.25);
  assert.deepEqual(result.resultingState.compartments, state.compartments);
});
