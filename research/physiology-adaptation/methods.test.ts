import assert from "node:assert/strict";
import { test } from "vitest";
import { localDateTimeToInstant } from "@/model/time-zone";
import {
  halfForecastDrift,
  forecastRobustLogSpread,
  withinDonorWindow,
  boundedOnlineCorrection,
  adaptiveLocalLevelWeightFilterAsOf,
  assessUncertaintyAwareFallback,
  causalWeightFilterAsOf,
  encodeForecastSnapshotV1,
  estimatePersistentBias,
  estimateEnergyDriftCorrection,
  estimateResidualPersistence,
  estimateTwoTimescaleResidual,
  filterOnlyStateCorrection,
  projectActivityIntervalsAsOf,
  latestWeightSnapshotsAsOf,
  median,
  newOutcomeResidualIfEligible,
  outcomeArrivedAfterCutoff,
  prequentialIntervalWidening,
  robustTrendWeightForecast,
  residualsAvailableAt,
  selectAsOfSources,
  validateForecastSnapshotV1,
  weightOutcomeLabelsAsOf,
  waterOnlyInitializationCorrection,
  type ForecastSnapshotV1,
  type MinimalMassState,
} from "./methods";

const dailyResiduals = (values: readonly number[]) => values.map((residualKg, index) => ({
  date: new Date(Date.UTC(2033, 0, 1 + index)).toISOString().slice(0, 10), residualKg,
}));

test("forecast drift shrinkage keeps its anchor and handles missing weight", () => {
  assert.equal(halfForecastDrift(90, 88), 89);
  assert.equal(halfForecastDrift(90, 92), 91);
  assert.equal(halfForecastDrift(null, 92), null);
});

test("forecast donor window includes both boundaries", () => {
  assert.equal(withinDonorWindow("2026-09-14", "2026-09-14", "2026-11-08"), true);
  assert.equal(withinDonorWindow("2026-11-08", "2026-09-14", "2026-11-08"), true);
  assert.equal(withinDonorWindow("2026-11-09", "2026-09-14", "2026-11-08"), false);
});

test("forecast variability uses the fallback for sparse positive donors and bounds stable history", () => {
  assert.equal(forecastRobustLogSpread([0, 1, 2, 3, 4, 5, 6], 0.25), 0.25);
  assert.equal(forecastRobustLogSpread([2, 2, 2, 2, 2, 2, 2], 0.25), 0.03);
  assert.equal(forecastRobustLogSpread([1, 1, 1, 1, 1000, 1000, 1000, 1000], 0.25), 1);
});

test("as-of input projection excludes delayed and later-edited rows and isolates tenants", () => {
  const rows = [
    { profileId: 44, createdAt: "2033-02-10T18:00:00Z", updatedAt: "2033-02-10T18:00:00Z", id: "available" },
    { profileId: 44, createdAt: "2033-02-12T01:00:00Z", updatedAt: "2033-02-12T01:00:00Z", id: "delayed" },
    { profileId: 44, createdAt: "2033-02-09T18:00:00Z", updatedAt: "2033-02-12T01:00:00Z", id: "edited-later" },
    { profileId: 55, createdAt: "2033-02-10T18:00:00Z", updatedAt: "2033-02-10T18:00:00Z", id: "other-profile" },
  ];
  const before = JSON.stringify(rows);
  const selected = selectAsOfSources(rows, 44, "2033-02-11T00:00:00Z");
  assert.deepEqual(selected.map(({ id }) => id), ["available"]);
  assert.equal(JSON.stringify(rows), before, "projection must not mutate source evidence");
});

test("a reconciliation group rejected after an origin is not treated as absent then", () => {
  const groups = [{ profileId: 44, localDate: "2033-02-10", status: "rejected",
    createdAt: "2033-02-10T18:00:00Z", updatedAt: "2033-02-12T01:00:00Z" }];
  assert.deepEqual(selectAsOfSources(groups, 44, "2033-02-11T00:00:00Z"), []);
});

test("future observations and delayed imports cannot alter an earlier residual state", () => {
  const base = [
    { date: "2033-02-10", observedKg: 72.2, predictedKg: 72.0, availableAt: "2033-02-10T20:00:00Z" },
    { date: "2033-02-11", observedKg: 72.3, predictedKg: 72.0, availableAt: "2033-02-11T21:00:00Z" },
  ];
  const extended = [...base,
    { date: "2033-02-11", observedKg: 73.8, predictedKg: 72.0, availableAt: "2033-02-13T09:00:00Z" },
    { date: "2033-02-12", observedKg: 72.0, predictedKg: 71.7, availableAt: "2033-02-12T21:00:00Z" },
  ];
  const a = residualsAvailableAt(base, "2033-02-11", "2033-02-12T00:00:00Z");
  const b = residualsAvailableAt(extended, "2033-02-11", "2033-02-12T00:00:00Z");
  assert.deepEqual(b, a);
});

test("an observation at the exclusive next-day cutoff is not available at the prior origin", () => {
  const cutoff = new Date("2033-02-12T00:00:00.000Z");
  const rows = [
    { date: "2033-02-11", observedKg: 72.2, predictedKg: 72.0, availableAt: new Date(cutoff.getTime() - 1) },
    { date: "2033-02-11", observedKg: 73.2, predictedKg: 72.0, availableAt: cutoff },
  ];
  const available = residualsAvailableAt(rows, "2033-02-11", new Date(cutoff.getTime() - 1));
  assert.equal(available.length, 1);
  assert.equal(new Date(available[0]!.availableAt).getTime(), cutoff.getTime() - 1);
});

test("forecast evaluation excludes outcomes already known at issue cutoff", () => {
  const cutoff = "2033-02-12T00:00:00.000Z";
  assert.equal(outcomeArrivedAfterCutoff("2033-02-11T23:59:59.999Z", cutoff), false);
  assert.equal(outcomeArrivedAfterCutoff(cutoff, cutoff), true);
  assert.equal(outcomeArrivedAfterCutoff("2033-02-12T00:00:00.001Z", cutoff), true);
});

test("a later correction cannot make an already-known outcome appear newly available", () => {
  const labels = weightOutcomeLabelsAsOf([
    { id: 1, date: "2033-02-12", weightKg: 72.1, receivedAt: "2033-02-12T08:00:00Z" },
    { id: 2, date: "2033-02-12", weightKg: 71.8, receivedAt: "2033-02-13T09:00:00Z" },
    { id: 3, date: "2033-02-12", weightKg: 69.0, receivedAt: "2033-02-16T00:00:00Z" },
  ], "2033-02-15T00:00:00Z");
  assert.deepEqual(labels, [{ date: "2033-02-12", weightKg: 71.8,
    firstReceivedAt: "2033-02-12T08:00:00Z", receivedAt: "2033-02-13T09:00:00Z" }]);
  const issueCutoff = "2033-02-13T00:00:00Z";
  assert.equal(outcomeArrivedAfterCutoff(labels[0]!.firstReceivedAt, issueCutoff), false);
  assert.equal(outcomeArrivedAfterCutoff(labels[0]!.receivedAt, issueCutoff), true,
    "the later corrected value is available later, but cannot qualify a known outcome");
  assert.equal(newOutcomeResidualIfEligible(labels[0], 72.0, issueCutoff), null,
    "known outcomes must not enter the later residual-training queue");
});

test("a new outcome may train later residuals only after its selected value is received", () => {
  const labels = weightOutcomeLabelsAsOf([
    { id: 1, date: "2033-02-12", weightKg: 72.1, receivedAt: "2033-02-13T09:00:00Z" },
    { id: 2, date: "2033-02-12", weightKg: 71.8, receivedAt: "2033-02-14T09:00:00Z" },
  ], "2033-02-15T00:00:00Z");
  assert.deepEqual(newOutcomeResidualIfEligible(labels[0], 72.0, "2033-02-13T00:00:00Z"), {
    date: "2033-02-12", observedKg: 71.8, predictedKg: 72.0, availableAt: "2033-02-14T09:00:00Z",
  });
});

test("calendar cutoffs are timezone-aware across daylight-saving transitions", () => {
  const before = localDateTimeToInstant("2030-10-27", "00:00", "Europe/Bratislava").getTime();
  const after = localDateTimeToInstant("2030-10-28", "00:00", "Europe/Bratislava").getTime();
  assert.equal(after - before, 25 * 60 * 60 * 1000);
});

test("initialization evidence uses the latest available weight per day, not stale first snapshots", () => {
  const snapshots = [
    ["2033-03-01", 68.0, "2033-03-01T06:12:00Z"], ["2033-03-01", 70.0, "2033-03-08T18:10:00Z"],
    ["2033-03-01", 73.0, "2033-03-13T12:40:00Z"],
    ["2033-03-02", 70.5, "2033-03-02T03:00:00Z"], ["2033-03-02", 69.8, "2033-03-09T19:18:00Z"],
    ["2033-03-03", 69.8, "2033-03-03T04:39:00Z"], ["2033-03-03", 69.5, "2033-03-10T18:50:00Z"],
    ["2033-03-04", 69.6, "2033-03-04T05:13:00Z"], ["2033-03-04", 69.3, "2033-03-11T18:51:00Z"],
    ["2033-03-05", 69.2, "2033-03-05T06:05:00Z"],
    ["2033-03-06", 69.2, "2033-03-06T02:53:00Z"], ["2033-03-06", 69.1, "2033-03-12T12:39:00Z"],
    ["2033-03-07", 69.1, "2033-03-07T02:46:00Z"], ["2033-03-07", 69.0, "2033-03-13T12:39:00Z"],
  ].map(([date, weightKg, receivedAt], index) => ({ id: index + 1, date: String(date), weightKg: Number(weightKg), receivedAt: String(receivedAt) }));
  const latest = latestWeightSnapshotsAsOf(snapshots, "2033-03-13T12:40:00Z");
  assert.deepEqual(latest.map(({ weightKg }) => weightKg), [70.0, 69.8, 69.5, 69.3, 69.2, 69.1, 69.0]);
  assert.equal(median(latest.map(({ weightKg }) => weightKg)), 69.3);
  assert.ok(latest.every(({ receivedAt }) => Date.parse(String(receivedAt)) < Date.parse("2033-03-13T12:40:00Z")));
});

test("causal scale assimilation respects receipt cutoffs without changing tissue", () => {
  const rows = [
    ["2033-03-01", 70.0, "2033-03-01T06:12:00Z"],
    ["2033-03-02", 69.8, "2033-03-02T03:04:00Z"],
    ["2033-03-03", 69.5, "2033-03-03T04:39:00Z"],
    ["2033-03-04", 69.3, "2033-03-04T05:13:00Z"],
    ["2033-03-05", 69.2, "2033-03-05T06:05:00Z"],
    ["2033-03-06", 69.1, "2033-03-06T02:53:00Z"],
    ["2033-03-07", 69.0, "2033-03-07T02:46:00Z"],
    // This row is after the model episode was created and cannot rewrite its initial estimate.
    ["2033-03-08", 70.1, "2033-03-15T08:26:00Z"],
  ].map(([date, weightKg, receivedAt], index) => ({
    id: index + 1, date: String(date), weightKg: Number(weightKg), receivedAt: String(receivedAt),
  }));
  const structuralState = Object.freeze({ fatMassKg: 20, leanTissueKg: 50, glycogenKg: 0.4, ecfDeviationKg: 0 });
  const firstWeek = causalWeightFilterAsOf(rows, {
    originDate: "2033-03-07", inputAsOf: "2033-03-13T12:40:00Z",
  });
  const withLaterRows = causalWeightFilterAsOf([...rows,
    { id: 9, date: "2033-03-08", weightKg: 70.1, receivedAt: "2033-03-15T08:26:00Z" },
    { id: 10, date: "2033-03-09", weightKg: 60, receivedAt: "2033-03-12T08:26:00Z" },
  ], { originDate: "2033-03-07", inputAsOf: "2033-03-13T12:40:00Z" });

  assert.equal(firstWeek.observationCount, 7);
  assert.ok(firstWeek.state!.estimatedWeightKg < 70.0);
  assert.ok(firstWeek.state!.estimatedWeightKg > 69.0);
  assert.equal(firstWeek.stateAtOriginDate!.estimatedWeightKg, firstWeek.state!.estimatedWeightKg,
    "when an observation is available on the origin, its posterior is the origin state");
  assert.notEqual(firstWeek.updates[1]!.posteriorEstimateKg, firstWeek.updates[0]!.posteriorEstimateKg,
    "a later available weighing must causally update the observation state");
  assert.notEqual(firstWeek.state!.estimatedWeightKg, firstWeek.updates[0]!.posteriorEstimateKg,
    "the updated observation state must carry forward to the origin");
  assert.ok(firstWeek.updates.every((update) => update.posteriorVarianceKg2 >= 0));
  assert.deepEqual(withLaterRows, firstWeek);
  assert.deepEqual(structuralState, { fatMassKg: 20, leanTissueKg: 50, glycogenKg: 0.4, ecfDeviationKg: 0 });
});

test("as-of activity intervals restore the prior snapshot version after a later replacement", () => {
  const snapshots = [
    { id: 1, profileId: 44, date: "2033-03-01", receivedAt: "2033-03-01T06:00:00Z",
      timezone: "Europe/Bratislava", rawPayload: { date: "2033-03-01", walkingDistanceIntervals: {
        starts: ["2033-03-01T07:00:00+01:00"], ends: ["2033-03-01T08:00:00+01:00"], values: [1.2],
      } } },
    // Sync persistence replaces the interval table rows, but the previous raw snapshot remains immutable.
    { id: 2, profileId: 44, date: "2033-03-01", receivedAt: "2033-03-03T06:00:00Z",
      timezone: "Europe/Bratislava", rawPayload: { date: "2033-03-01", walkingDistanceIntervals: {
        starts: ["2033-03-01T07:00:00+01:00"], ends: ["2033-03-01T08:00:00+01:00"], values: [0.8],
      } } },
    // Empty subsets do not clear the writer's existing interval rows.
    { id: 3, profileId: 44, date: "2033-03-01", receivedAt: "2033-03-04T06:00:00Z",
      timezone: "Europe/Bratislava", rawPayload: { date: "2033-03-01", walkingDistanceIntervals: {
        starts: [], ends: [], values: [],
      } } },
  ];
  const beforeReplacement = projectActivityIntervalsAsOf(snapshots, {
    profileId: 44, originDate: "2033-03-01", inputAsOf: "2033-03-02T00:00:00Z",
  });
  const afterReplacement = projectActivityIntervalsAsOf(snapshots, {
    profileId: 44, originDate: "2033-03-03", inputAsOf: "2033-03-04T00:00:00Z",
  });
  const afterEmptySubset = projectActivityIntervalsAsOf(snapshots, {
    profileId: 44, originDate: "2033-03-05", inputAsOf: "2033-03-06T00:00:00Z",
  });

  assert.equal(beforeReplacement.complete, true);
  assert.equal(beforeReplacement.rows[0]!.value, 1.2);
  assert.equal(afterReplacement.rows[0]!.value, 0.8);
  assert.equal(afterEmptySubset.rows[0]!.value, 0.8);
  assert.notEqual(beforeReplacement.rows[0]!.value, afterReplacement.rows[0]!.value);
});

test("invalid activity payloads fail closed instead of appearing as absent intervals", () => {
  const result = projectActivityIntervalsAsOf([{
    id: 1, profileId: 44, date: "2033-03-01", receivedAt: "2033-03-01T06:00:00Z",
    timezone: "Europe/Bratislava", rawPayload: { date: "2033-03-01", walkingDistanceIntervals: { starts: ["bad"] } },
  }], { profileId: 44, originDate: "2033-03-01", inputAsOf: "2033-03-02T00:00:00Z" });
  assert.equal(result.complete, false);
  assert.deepEqual(result.unavailableDates, ["2033-03-01"]);
  assert.deepEqual(result.rows, []);
});

test("robust trend baseline is causal, calendar-day based, and ignores delayed/future weights", () => {
  const observations = Array.from({ length: 7 }, (_, index) => ({
    date: `2033-02-${String(index + 1).padStart(2, "0")}`,
    weightKg: 80 - index * 0.1,
    availableAt: `2033-02-${String(index + 1).padStart(2, "0")}T20:00:00.000Z`,
  }));
  const baseline = robustTrendWeightForecast(observations, {
    originDate: "2033-02-07", inputAsOf: "2033-02-08T00:00:00.000Z", targetDate: "2033-02-10",
  });
  const withUnavailable = robustTrendWeightForecast([...observations,
    { date: "2033-01-31", weightKg: 65, availableAt: "2033-02-08T00:00:00.000Z" },
    { date: "2033-02-08", weightKg: 64, availableAt: "2033-02-07T21:00:00.000Z" },
  ], { originDate: "2033-02-07", inputAsOf: "2033-02-08T00:00:00.000Z", targetDate: "2033-02-10" });
  assert.equal(baseline?.observationCount, 7);
  assert.ok(Math.abs(baseline!.slopeKgPerDay + 0.1) < 1e-10);
  assert.ok(Math.abs(baseline!.estimateKg - 79.1) < 1e-10);
  assert.deepEqual(withUnavailable, baseline);
  assert.throws(() => robustTrendWeightForecast(observations, {
    originDate: "2033-02-07", inputAsOf: "2033-02-08T00:00:00.000Z", targetDate: "2033-02-07",
  }), /follow its origin/);
});

test("Theil-Sen trend baseline limits one scale outlier's influence", () => {
  const points = Array.from({ length: 7 }, (_, index) => ({
    date: `2033-02-${String(index + 1).padStart(2, "0")}`,
    weightKg: 80 - index * 0.1 + (index === 3 ? 8 : 0),
    availableAt: `2033-02-${String(index + 1).padStart(2, "0")}T20:00:00.000Z`,
  }));
  const fit = robustTrendWeightForecast(points, {
    originDate: "2033-02-07", inputAsOf: "2033-02-08T00:00:00.000Z", targetDate: "2033-02-10",
  });
  assert.notEqual(fit, null);
  assert.ok(Math.abs(fit!.estimateKg - 79.1) < 0.15);
  assert.ok(Math.abs(fit!.slopeKgPerDay) < 0.2);
});

test("bounded online correction resists an isolated outlier and respects step and state caps", () => {
  const ordinary = boundedOnlineCorrection(dailyResiduals([0.2, 0.3, 0.1, 0.25]));
  const withOutlier = boundedOnlineCorrection(dailyResiduals([0.2, 0.3, 0.1, 8, 0.25]));
  assert.ok(Math.abs(withOutlier) <= 0.75);
  assert.ok(Math.abs(withOutlier - ordinary) <= 0.1);
  const persistent = boundedOnlineCorrection(dailyResiduals(Array(100).fill(5)));
  assert.equal(persistent, 0.75);
  const adjacent = boundedOnlineCorrection([{ date: "2033-01-01", residualKg: 1 }, { date: "2033-01-02", residualKg: 1 }]);
  const gapped = boundedOnlineCorrection([{ date: "2033-01-01", residualKg: 1 }, { date: "2033-01-11", residualKg: 1 }]);
  assert.ok(gapped > adjacent, "elapsed calendar days must affect the time-based update");
});

test("initialization and online state candidates never move tissue from one scale reading", () => {
  const initial = { fatMassKg: 20, leanTissueKg: 50, glycogenKg: 0.4,
    baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    adaptiveThermogenesisKcalPerDay: 42, weightFilterState: { estimatedWeightKg: 70, varianceKg2: 0.25 } };
  const water = waterOnlyInitializationCorrection(initial, 2.4);
  assert.equal(water.appliedKg, 0.75);
  assert.equal(water.state.fatMassKg, initial.fatMassKg);
  assert.equal(water.state.leanTissueKg, initial.leanTissueKg);
  const online = filterOnlyStateCorrection(initial, -0.5);
  assert.equal(online.weightFilterState.estimatedWeightKg, 69.5);
  const tissueAndEnergyState = (state: MinimalMassState) => ({
    fatMassKg: state.fatMassKg,
    leanTissueKg: state.leanTissueKg,
    glycogenKg: state.glycogenKg,
    baselineExtracellularFluidLiters: state.baselineExtracellularFluidLiters,
    adaptiveThermogenesisKcalPerDay: state.adaptiveThermogenesisKcalPerDay,
  });
  assert.deepEqual(tissueAndEnergyState(water.state), tissueAndEnergyState(initial));
  assert.deepEqual(tissueAndEnergyState(online), tissueAndEnergyState(initial));
  assert.equal(online.extracellularFluidDeviationLiters, initial.extracellularFluidDeviationLiters,
    "the online scale-filter candidate must not rewrite any water compartment");
});

test("two-timescale projection is causal, fast residual decays, and the slow state is bounded", () => {
  const short = estimateTwoTimescaleResidual(dailyResiduals([0.1, 0.15, 1.4]));
  const long = estimateTwoTimescaleResidual(dailyResiduals([0.1, 0.15, 1.4, -0.7, 0.05]));
  assert.ok(short.predictResidualKg(7) < short.predictResidualKg(0));
  assert.ok(short.predictResidualKg(14) > short.state.slowKg - 0.01);
  assert.ok(Math.abs(long.state.slowKg) <= 2);
  assert.notDeepEqual(short.state, long.state, "later observations should matter only at later origins");
  const adjacent = estimateTwoTimescaleResidual([
    { date: "2033-01-01", residualKg: 1 }, { date: "2033-01-02", residualKg: 0 },
  ]);
  const gapped = estimateTwoTimescaleResidual([
    { date: "2033-01-01", residualKg: 1 }, { date: "2033-01-11", residualKg: 0 },
  ]);
  assert.ok(gapped.state.slowKg < adjacent.state.slowKg,
    "slow-state decay must account for elapsed days between residual observations");
});

test("two-timescale projection caps scale-only outlier corrections", () => {
  const residuals = dailyResiduals([0.2, 0.3, 0.1, 0.25, 0.2, 0.3, 0.1, 12]);
  const estimate = estimateTwoTimescaleResidual(residuals);
  assert.equal(estimate.predictResidualKg(1), 2);
  assert.ok(Math.abs(estimate.predictResidualKg(30)) <= 2);
  assert.ok(estimate.predictResidualKg(30) < estimate.predictResidualKg(1));
  assert.throws(() => estimateTwoTimescaleResidual(residuals, { maxAbsPredictionKg: 0 }), /prediction cap/);
});

test("persistent bias is robust to one extreme residual and bounded independently of energy", () => {
  const ordinary = estimatePersistentBias(dailyResiduals(Array(20).fill(0.4)));
  const outlier = estimatePersistentBias(dailyResiduals([...Array(19).fill(0.4), 9]));
  assert.equal(ordinary, 0.4);
  assert.equal(outlier, 0.4);
  assert.equal(estimatePersistentBias(dailyResiduals(Array(40).fill(-4))), -1);
  assert.equal(estimatePersistentBias([
    { date: "2033-01-01", residualKg: 9 }, { date: "2033-02-01", residualKg: 0.4 },
  ], { windowDays: 7 }), 0.4, "observations older than the calendar-day window must be excluded");
});

test("causal AR residual persistence learns decay while bounding an outlier", () => {
  const rows = dailyResiduals([0.1, 0.3, 0.45, 0.62, 0.74, 0.83, 0.9, 0.95, 1.0, 1.04]);
  const estimate = estimateResidualPersistence(rows);
  assert.ok(estimate);
  assert.ok(estimate.persistencePerDay > 0.2 && estimate.persistencePerDay < 0.9);
  assert.ok(estimate.predictResidualKg(14) < estimate.predictResidualKg(1));
  const earlierEstimate = estimateResidualPersistence(rows.slice(0, 8));
  assert.ok(earlierEstimate);
  assert.notEqual(earlierEstimate.persistencePerDay, estimate.persistencePerDay,
    "newly matured history can update the residual-persistence estimate");
  const receivedRows = rows.map((row) => ({ ...row, observedKg: row.residualKg, predictedKg: 0,
    availableAt: `${row.date}T20:00:00Z` }));
  const earlierAsOf = residualsAvailableAt(receivedRows, rows[7]!.date, `${rows[7]!.date}T23:00:00Z`);
  const laterDataAtEarlierOrigin = residualsAvailableAt([...receivedRows,
    { date: "2033-02-01", observedKg: 0, predictedKg: 0, availableAt: "2033-02-01T20:00:00Z" }],
  rows[7]!.date, `${rows[7]!.date}T23:00:00Z`);
  const earlierFromBase = estimateResidualPersistence(earlierAsOf.map(({ date, residualKg }) => ({ date, residualKg })));
  const earlierFromExtended = estimateResidualPersistence(laterDataAtEarlierOrigin.map(({ date, residualKg }) => ({ date, residualKg })));
  assert.equal(earlierFromExtended?.persistencePerDay, earlierFromBase?.persistencePerDay,
    "later receipts cannot change an earlier origin");
  const positiveScaleResidual = estimateResidualPersistence(dailyResiduals(Array(10).fill(0.6)));
  const negativeScaleResidual = estimateResidualPersistence(dailyResiduals(Array(10).fill(-0.6)));
  assert.ok(positiveScaleResidual!.predictResidualKg(7) > 0,
    "observed scale above model must shift the candidate forecast upward");
  assert.ok(negativeScaleResidual!.predictResidualKg(7) < 0,
    "observed scale below model must shift the candidate forecast downward");
  const withOutlier = estimateResidualPersistence([...rows.slice(0, -1), { ...rows.at(-1)!, residualKg: 12 }]);
  assert.ok(withOutlier);
  assert.ok(withOutlier.predictResidualKg(1) < 2);
  assert.equal(estimateResidualPersistence(rows.slice(0, 7)), null);
});

test("energy drift challenger needs stable residual slope and finite-difference sensitivity", () => {
  const observations = Array.from({ length: 20 }, (_, index) => ({
    date: new Date(Date.UTC(2033, 0, 1 + index)).toISOString().slice(0, 10),
    residualKg: index * 0.02,
    massSensitivityKgPerKcalPerDay: -index * 0.00004,
  }));
  const estimate = estimateEnergyDriftCorrection(observations);
  assert.equal(estimate.status, "estimated");
  assert.ok(estimate.residualSlopeKgPerDay! > 0);
  assert.ok(estimate.sensitivitySlopeKgPerDayPerKcalPerDay! < 0);
  assert.ok(estimate.offsetCorrectionKcalPerDay < 0, "positive observed-minus-model drift calls for lower modeled expenditure");
  assert.ok(Math.abs(estimate.offsetCorrectionKcalPerDay) < 500, "zero-centered prior shrinks the raw bound estimate");
  assert.equal(estimateEnergyDriftCorrection(observations.slice(0, 4)).status, "insufficient-history");
  const unstable = observations.map((row, index) => ({ ...row, residualKg: index < 10 ? index * 0.02 : (20 - index) * 0.02 }));
  assert.equal(estimateEnergyDriftCorrection(unstable).status, "unstable-split");
  assert.equal(estimateEnergyDriftCorrection(observations.map((row) => ({ ...row,
    massSensitivityKgPerKcalPerDay: 0 }))).status, "unidentifiable");
});

test("prequential interval widening uses only matured same-horizon outcomes", () => {
  const history = Array.from({ length: 10 }, (_, index) => {
    const origin = new Date(Date.UTC(2033, 0, 1 + index)).toISOString().slice(0, 10);
    const target = new Date(Date.UTC(2033, 0, 8 + index)).toISOString().slice(0, 10);
    const issue = `${origin}T23:59:59Z`;
    return { originDate: origin, targetDate: target, horizonDays: 7, issueCutoff: issue,
      firstReceivedAt: `${target}T08:00:00Z`, receivedAt: `${target}T08:00:00Z`, observedKg: 70.5,
      p05Kg: 69.8, p95Kg: 70.2 };
  });
  const input = { originDate: "2033-01-25", inputAsOf: "2033-01-25T00:00:00Z", horizonDays: 7 };
  const estimate = prequentialIntervalWidening(history, input);
  assert.equal(estimate.sampleCount, 10);
  assert.equal(estimate.empiricalPriorCoverage, 0);
  assert.ok(estimate.widenByKg! >= 0.29);
  const unavailable = prequentialIntervalWidening([...history,
    { ...history[9]!, originDate: "2033-01-24", targetDate: "2033-01-31", issueCutoff: "2033-01-24T23:59:59Z",
      firstReceivedAt: "2033-01-25T01:00:00Z", receivedAt: "2033-01-25T01:00:00Z" },
  ], input);
  assert.equal(unavailable.sampleCount, 10, "future, not-yet-matured outcomes cannot widen an earlier interval");
  assert.equal(prequentialIntervalWidening(history.slice(0, 4), input).widenByKg, null,
    "too few matured cases must leave the interval unchanged");
});

test("adaptive local-level filter is causal, deterministic, bounded, and changes only observation state", () => {
  const rows = [
    ["2033-03-01", 70.0, "2033-03-01T06:00:00Z"],
    ["2033-03-02", 70.1, "2033-03-02T06:00:00Z"],
    ["2033-03-03", 70.8, "2033-03-03T06:00:00Z"],
    ["2033-03-04", 71.4, "2033-03-04T06:00:00Z"],
    ["2033-03-05", 80.0, "2033-03-05T06:00:00Z"],
  ].map(([date, weightKg, receivedAt], id) => ({
    id, date: String(date), weightKg: Number(weightKg), receivedAt: String(receivedAt),
  }));
  const input = { originDate: "2033-03-05", inputAsOf: "2033-03-06T00:00:00Z" };
  const first = adaptiveLocalLevelWeightFilterAsOf(rows, input);
  const repeated = adaptiveLocalLevelWeightFilterAsOf(rows, input);
  const withFutureEvidence = adaptiveLocalLevelWeightFilterAsOf([...rows,
    { date: "2033-03-06", weightKg: 60, receivedAt: "2033-03-06T00:00:00Z" },
    { date: "2033-03-04", weightKg: 55, receivedAt: "2033-03-06T00:00:00Z" },
  ], input);

  assert.deepEqual(repeated, first);
  assert.deepEqual(withFutureEvidence, first, "future or not-yet-received weights cannot alter an earlier origin");
  assert.equal(first.observationCount, 5);
  assert.equal(first.updates.length, 4);
  assert.ok(first.updates.every((update) => Number.isFinite(update.posteriorEstimateKg)
    && update.posteriorVarianceKg2 >= 0), "posterior remains finite under a single outlier");
  assert.ok(first.updates.at(-1)!.posteriorEstimateKg < 73,
    "clipped innovation prevents a single extreme measurement from taking over the state");
  assert.ok(first.processNoiseVarianceKg2PerDay! > 0.01,
    "sustained innovations should raise process noise so later observations adapt faster");
  assert.deepEqual(Object.keys(first.state!), ["estimatedWeightKg", "varianceKg2"],
    "the estimator returns a scale observation state, not tissue or fluid compartments");
});

test("uncertainty fallback uses only prior matured same-horizon intervals and waits for enough evidence", () => {
  const history = Array.from({ length: 8 }, (_, index) => {
    const day = index + 1;
    const originDate = `2033-03-${String(day).padStart(2, "0")}`;
    const targetDate = `2033-03-${String(day + 1).padStart(2, "0")}`;
    return { originDate, targetDate, horizonDays: 1,
      issueCutoff: `${targetDate}T00:00:00Z`, firstReceivedAt: `${targetDate}T01:00:00Z`,
      receivedAt: `${targetDate}T02:00:00Z`, observedKg: 75, p05Kg: 69, p95Kg: 71 };
  });
  const input = { originDate: "2033-03-12", inputAsOf: "2033-03-13T00:00:00Z", horizonDays: 1 };
  const assessment = assessUncertaintyAwareFallback([...history,
    { ...history[0]!, targetDate: "2033-03-08", horizonDays: 7 },
    { ...history[0]!, originDate: "2033-03-12", targetDate: "2033-03-13" },
    { ...history[0]!, originDate: "2033-03-10", targetDate: "2033-03-11", receivedAt: "2033-03-13T00:00:00Z" },
  ], input);
  assert.equal(assessment.sampleCount, 8);
  assert.equal(assessment.intervalCoverage, 0);
  assert.equal(assessment.fallbackToLastKnown, true);
  assert.equal(assessUncertaintyAwareFallback(history.slice(0, 7), input).fallbackToLastKnown, false,
    "small samples keep the baseline forecast instead of triggering a volatile fallback");
  assert.throws(() => assessUncertaintyAwareFallback([{ ...history[0]!, targetDate: "2033-03-03" }], input), /invalid forecast interval outcome/);
  assert.throws(() => assessUncertaintyAwareFallback(history, { ...input, horizonDays: 0 }), /positive horizon/);
});

test("forecast snapshot contract round-trips and rejects a future input cutoff", () => {
  const valid: ForecastSnapshotV1 = {
    schemaVersion: 1,
    profileId: 44,
    episodeId: 7,
    issuedAt: "2033-06-01T22:30:00.000Z",
    inputAsOf: "2033-06-01T22:29:59.999Z",
    originDate: "2033-06-01",
    timezone: "Europe/Bratislava",
    forecastVersion: "bodycast-forecast-v1",
    modelVersion: "bodycast-physiology-v7",
    sourceFingerprint: "a".repeat(64),
    scenarioFingerprint: "b".repeat(64),
    horizons: [{ leadDays: 7, targetDate: "2033-06-08", p05Kg: 68, p25Kg: 69, p50Kg: 70, p75Kg: 71, p95Kg: 72 }],
  };
  const encoded = encodeForecastSnapshotV1(valid);
  assert.deepEqual(validateForecastSnapshotV1(JSON.parse(encoded)), valid);
  assert.throws(() => validateForecastSnapshotV1({ ...valid, inputAsOf: "2033-06-01T22:30:01Z" }), /after issue time/);
  assert.throws(() => validateForecastSnapshotV1({ ...valid, horizons: [{ ...valid.horizons[0], p50Kg: 93 }] }), /ordered/);
  assert.throws(() => validateForecastSnapshotV1({ ...valid, horizons: [{ ...valid.horizons[0], targetDate: "2033-06-07" }] }), /calendar lead/);
  assert.throws(() => validateForecastSnapshotV1({ ...valid, timezone: "Not/AZone" }), /IANA timezone/);
});
