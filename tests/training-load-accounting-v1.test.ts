import { describe, expect, it } from "vitest";
import {
  CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
  CANONICAL_PUSH_UP_CONFIG_VERSION_V1,
  calculateLoadAccountingV1,
  LEGACY_LOAD_CONFIGS_V1,
  loadConfigV1Schema,
  setExecutionOverrideV1Schema,
  summarizePersistedExerciseIdentityV1,
  type IdentityEvidenceV1,
  type LoadAccountingExerciseInputV1,
  type LoadAccountingSessionInputV1,
} from "@/modules/training/load-accounting-v1";
import {
  STAGE01_GOLDEN_TOTALS_V1,
  STAGE01_PULL_ROWS_V1,
  STAGE01_PUSH_ROWS_V1,
  type Stage01GoldenRowV1,
} from "./fixtures/training-load-accounting-stage01-golden-v1";

function identity(stableKey: string, status: IdentityEvidenceV1["status"] = "known-legacy"): IdentityEvidenceV1 {
  return { status, stableKey };
}

function exerciseFromRows(rows: readonly Stage01GoldenRowV1[]): LoadAccountingExerciseInputV1[] {
  const groups = new Map<string, Stage01GoldenRowV1[]>();
  for (const row of rows) groups.set(row[0], [...(groups.get(row[0]) ?? []), row]);
  return [...groups.entries()].map(([stableKey, exerciseRows]) => {
    const isBand = exerciseRows[0][6] === "band-nominal-per-logged-side";
    const isBodyweight = exerciseRows[0][6] === "bodyweight-reference-separate";
    return {
      identity: identity(stableKey),
      resistanceHint: isBand ? "band-nominal" : isBodyweight ? "bodyweight" : "external",
      sets: exerciseRows.map((row) => ({
        reps: row[3],
        weightKg: row[4],
        bandNominalResistanceKg: row[5],
      })),
    };
  });
}

function session(rows: readonly Stage01GoldenRowV1[], localDate: string): LoadAccountingSessionInputV1 {
  return { localDate, exercises: exerciseFromRows(rows) };
}

function valueForExercise(rows: readonly Stage01GoldenRowV1[], stableKey: string) {
  const result = calculateLoadAccountingV1(session(rows.filter((row) => row[0] === stableKey), "2026-09-24"));
  return result.externalLoadVolume.value;
}

describe("Stage 01 literal load accounting golden", () => {
  it("uses a stable approximate 70% bodyweight assumption for canonical handle push-ups", () => {
    expect(LEGACY_LOAD_CONFIGS_V1.pushup_handles).toMatchObject({
      configVersion: CANONICAL_PUSH_UP_CONFIG_VERSION_V1,
      bodyweightFraction: CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
    });
    expect(LEGACY_LOAD_CONFIGS_V1.pull_up).toMatchObject({ bodyweightFraction: 1 });
    const result = calculateLoadAccountingV1({
      localDate: "2026-09-24",
      bodyweightReference: {
        status: "observed", valueKg: 80, localDate: "2026-09-24",
        source: "apple-health-shortcut", sourceId: "push-up-reference",
      },
      exercises: [{
        identity: identity("pushup_handles"),
        resistanceHint: "bodyweight",
        sets: [{ reps: 10, weightKg: null, bandNominalResistanceKg: null }],
      }],
    });
    expect(result.bodyweight.referenceVolume.value).toBe(560);
    expect(result.bodyweight.referenceVolume.availability).toBe("available");
    expect(result.bodyweight.referenceVolume.unit).toBe("bodyweight-reference-kg-repetitions");
  });

  it("preserves exact fixture rows and per-exercise external values", () => {
    expect(STAGE01_PULL_ROWS_V1).toHaveLength(21);
    expect(STAGE01_PUSH_ROWS_V1).toHaveLength(20);
    expect(valueForExercise(STAGE01_PULL_ROWS_V1, "one_arm_concentration_curl"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.one_arm_concentration_curl);
    expect(valueForExercise(STAGE01_PULL_ROWS_V1, "incline_seated_rotating_dumbbell_curl"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.incline_seated_rotating_dumbbell_curl);
    expect(valueForExercise(STAGE01_PULL_ROWS_V1, "supported_dumbbell_wrist_curl"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.supported_dumbbell_wrist_curl);
    expect(valueForExercise(STAGE01_PUSH_ROWS_V1, "incline_dumbbell_press_30deg"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.incline_dumbbell_press_30deg);
    expect(valueForExercise(STAGE01_PUSH_ROWS_V1, "flat_dumbbell_fly"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.flat_dumbbell_fly);
    expect(valueForExercise(STAGE01_PUSH_ROWS_V1, "seated_dumbbell_press"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.seated_dumbbell_press);
    expect(valueForExercise(STAGE01_PUSH_ROWS_V1, "one_arm_lateral_raise"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.one_arm_lateral_raise);
    expect(valueForExercise(STAGE01_PUSH_ROWS_V1, "bent_over_one_arm_dumbbell_triceps_extension"))
      .toBe(STAGE01_GOLDEN_TOTALS_V1.perExerciseKgReps.bent_over_one_arm_dumbbell_triceps_extension);
  });

  it("matches external, band-index, bodyweight, and one-dumbbell goldens", () => {
    const pull = calculateLoadAccountingV1({
      ...session(STAGE01_PULL_ROWS_V1, "2026-09-24"),
      bodyweightReference: {
        status: "observed", valueKg: 87, localDate: "2026-09-24",
        source: "apple-health-shortcut", sourceId: "sample-1",
      },
    });
    const push = calculateLoadAccountingV1(session(STAGE01_PUSH_ROWS_V1, "2026-09-25"));
    const hyper = calculateLoadAccountingV1(session(
      STAGE01_PULL_ROWS_V1.filter((row) => row[0] === "hyperextension"), "2026-09-24",
    ));

    expect(pull.externalLoadVolume.value).toBe(STAGE01_GOLDEN_TOTALS_V1.pullExternalKgReps);
    expect(pull.bandNominalIndex.perLoggedSide.value)
      .toBeCloseTo(STAGE01_GOLDEN_TOTALS_V1.pullBandNominalPerLoggedSideKgReps, 10);
    expect(pull.bodyweight.referenceVolume.value).toBe(STAGE01_GOLDEN_TOTALS_V1.pullUpReferenceKgReps);
    expect(pull.bodyweight.repetitions.value).toBe(STAGE01_GOLDEN_TOTALS_V1.pullUpReps);
    expect(pull.bodyweight.referenceVolume.unit).toBe("bodyweight-reference-kg-repetitions");
    expect(pull.bodyweight.referenceVolume.provenance.find(({ kind }) => kind === "bodyweight-observation")).toMatchObject({
      kind: "bodyweight-observation", sourceId: "sample-1",
    });
    expect(push.externalLoadVolume.value).toBe(STAGE01_GOLDEN_TOTALS_V1.pushExternalKgReps);
    expect(push.bandNominalIndex.perLoggedSide.value)
      .toBe(STAGE01_GOLDEN_TOTALS_V1.pushBandNominalPerLoggedSideKgReps);
    expect(push.bodyweight.repetitions.value).toBe(STAGE01_GOLDEN_TOTALS_V1.pushupReps);
    expect(hyper.externalLoadVolume.value).toBe(STAGE01_GOLDEN_TOTALS_V1.hyperextensionKgReps);
    expect(pull.externalLoadVolume.value).not.toBe(pull.bodyweight.referenceVolume.value);
  });
});

describe("versioned config and execution semantics", () => {
  it("accepts per-hand pairs, one implement across both hands, bars, and unilateral work", () => {
    expect(Object.keys(LEGACY_LOAD_CONFIGS_V1)).toHaveLength(13);
    expect(loadConfigV1Schema.safeParse(LEGACY_LOAD_CONFIGS_V1.incline_dumbbell_press_30deg).success).toBe(true);
    expect(LEGACY_LOAD_CONFIGS_V1.incline_dumbbell_press_30deg).toMatchObject({
      inventoryCount: 2, loadedSides: 2, loadInput: "per-implement-kg", repsMeaning: "per-side",
    });
    expect(LEGACY_LOAD_CONFIGS_V1.hyperextension).toMatchObject({
      inventoryCount: 1, loadedSides: 2, implementsPerMovement: 1, repsMeaning: "per-movement",
    });
    const bar = {
      schemaVersion: 1, configVersion: "bar-v1", inventoryCount: 1, loadedSides: 2,
      execution: "simultaneous", equipment: { equipmentId: "barbell", setupId: "full-bar" },
      accountingKind: "external-complete-setup-per-movement", resistanceType: "external",
      loadInput: "complete-setup-kg", repsMeaning: "per-movement",
    };
    expect(loadConfigV1Schema.safeParse(bar).success).toBe(true);
    const unilateral = {
      ...LEGACY_LOAD_CONFIGS_V1.one_arm_lateral_raise,
      inventoryCount: 1, loadedSides: 1, execution: "unilateral",
    };
    expect(loadConfigV1Schema.safeParse(unilateral).success).toBe(true);
    expect(loadConfigV1Schema.safeParse({ ...bar, inventoryCount: 3 }).success).toBe(false);
    expect(loadConfigV1Schema.safeParse({ ...bar, unexpected: true }).success).toBe(false);
    expect(loadConfigV1Schema.safeParse({ ...bar, schemaVersion: 2 }).success).toBe(false);
  });

  it.each(["simultaneous", "alternating"] as const)("counts both dumbbells for %s execution", (execution) => {
    const config = { ...LEGACY_LOAD_CONFIGS_V1.incline_dumbbell_press_30deg, execution };
    const result = calculateLoadAccountingV1({
      localDate: "2026-09-25",
      exercises: [{ identity: identity("incline_dumbbell_press_30deg"), configSnapshot: config,
        sets: [{ reps: 12, weightKg: 10, bandNominalResistanceKg: null }] }],
    });
    expect(result.externalLoadVolume.value).toBe(240);
  });

  it("uses ×1 for hyperextension and accounts asymmetric repetitions without changing scalar reps", () => {
    const config = LEGACY_LOAD_CONFIGS_V1.hyperextension;
    const run = (reps: number) => calculateLoadAccountingV1({
      localDate: "2026-09-24",
      exercises: [{ identity: identity("hyperextension"), configSnapshot: config,
        sets: [{ reps, weightKg: 10, bandNominalResistanceKg: null }] }],
    });
    expect(run(12).externalLoadVolume.value).toBe(120);
    const asymmetricSet = { reps: 12, weightKg: 10, bandNominalResistanceKg: null,
      override: { reps: { kind: "asymmetric-per-side", left: 12, right: 10 } } };
    const asymmetric = calculateLoadAccountingV1({
      localDate: "2026-09-24",
      exercises: [{ identity: identity("incline_dumbbell_press_30deg"),
        configSnapshot: LEGACY_LOAD_CONFIGS_V1.incline_dumbbell_press_30deg,
        sets: [asymmetricSet] }],
    });
    expect(asymmetric.externalLoadVolume.value).toBe(220);
    expect(asymmetricSet.reps).toBe(12);
    expect(asymmetricSet.override.reps.left + asymmetricSet.override.reps.right).toBe(22);
    expect(setExecutionOverrideV1Schema.safeParse({
      reps: { kind: "asymmetric-per-side", left: -1, right: 12 },
    }).success).toBe(false);
    expect(setExecutionOverrideV1Schema.safeParse({
      reps: { kind: "asymmetric-per-side", left: 12.5, right: 10 },
    }).success).toBe(false);
    const incompatible = calculateLoadAccountingV1({
      localDate: "2026-09-24",
      exercises: [{ identity: identity("incline_dumbbell_press_30deg"),
        configSnapshot: LEGACY_LOAD_CONFIGS_V1.incline_dumbbell_press_30deg,
        sets: [{ reps: 12, weightKg: 10, bandNominalResistanceKg: null,
          override: { repsMeaning: "per-movement",
            reps: { kind: "asymmetric-per-side", left: 12, right: 10 } } }] }],
    });
    expect(incompatible.externalLoadVolume).toMatchObject({
      value: null, availability: "unavailable", coverage: { omittedRows: 1 },
    });
    expect(setExecutionOverrideV1Schema.safeParse({
      reps: { kind: "asymmetric-per-side", left: 0, right: 0 },
    }).success).toBe(false);
  });

  it("keeps band nominal per logged side and reports asymmetry separately", () => {
    const result = calculateLoadAccountingV1({
      localDate: "2026-09-24",
      exercises: [{ identity: identity("one_arm_seated_cable_row"),
        configSnapshot: LEGACY_LOAD_CONFIGS_V1.one_arm_seated_cable_row,
        sets: [{ reps: 10, weightKg: null, bandNominalResistanceKg: 92.7 }] }],
    });
    expect(result.bandNominalIndex.perLoggedSide.value).toBe(927);
    expect(result.bandNominalIndex.leftSide).toMatchObject({
      value: null, availability: "unavailable", coverage: { omittedRows: 1 },
    });
    expect(result.bandNominalIndex.rightSide).toMatchObject({
      value: null, availability: "unavailable", coverage: { omittedRows: 1 },
    });
    const asymmetric = calculateLoadAccountingV1({
      localDate: "2026-09-24",
      exercises: [{ identity: identity("one_arm_seated_cable_row"),
        configSnapshot: LEGACY_LOAD_CONFIGS_V1.one_arm_seated_cable_row,
        sets: [{ reps: 22, weightKg: null, bandNominalResistanceKg: 10,
          override: { repsMeaning: "per-side", reps: { kind: "asymmetric-per-side", left: 12, right: 10 } } }] }],
    });
    expect(asymmetric.bandNominalIndex.perLoggedSide.value).toBeNull();
    expect(asymmetric.bandNominalIndex.leftSide.value).toBe(120);
    expect(asymmetric.bandNominalIndex.rightSide.value).toBe(100);
  });

  it("classifies by persisted IDs, keeps unknown identities unavailable, and reports coverage", () => {
    expect(summarizePersistedExerciseIdentityV1([
      { sourceExerciseCatalogId: 1, snapshotStableKey: "pull_up", catalogStableKey: "pull_up" },
      { sourceExerciseCatalogId: 1, snapshotStableKey: null, catalogStableKey: "pull_up" },
      { sourceExerciseCatalogId: 99, snapshotStableKey: "custom.row", catalogStableKey: null },
      { sourceExerciseCatalogId: 1, snapshotStableKey: "pull_up", catalogStableKey: "pushup_handles" },
    ])).toEqual({ canonical: 1, legacy: 1, custom: 1, ambiguous: 1 });
    const result = calculateLoadAccountingV1({
      localDate: "2026-01-01",
      exercises: [{ identity: identity("custom.row", "custom"), resistanceHint: "external",
        sets: [{ reps: 10, weightKg: 5, bandNominalResistanceKg: null }] }],
    });
    expect(result.externalLoadVolume).toMatchObject({
      value: null, availability: "unavailable", coverage: {
        eligibleRows: 1, omittedRows: 1, omittedReasons: { "unknown-identity": 1 },
      },
    });
  });

  it("keeps missing values distinct from known zero sets and separates additional and assistance loads", () => {
    const absent = calculateLoadAccountingV1({
      localDate: "2026-09-24",
      exercises: [{ identity: identity("pull_up"), sets: [
        { reps: null, weightKg: null, bandNominalResistanceKg: null },
      ] }],
    });
    expect(absent.bodyweight.referenceVolume).toMatchObject({
      value: null, availability: "unavailable", coverage: { omittedReasons: { "missing-repetitions": 1 } },
    });
    const knownEmpty = calculateLoadAccountingV1({ localDate: "2026-09-24", exercises: [] });
    expect(knownEmpty.bodyweight.referenceVolume).toMatchObject({ value: 0, availability: "available" });
    const weighted = calculateLoadAccountingV1({
      localDate: "2026-09-24",
      exercises: [{ identity: identity("pull_up"), sets: [
        { reps: 5, weightKg: null, bandNominalResistanceKg: null,
          override: { additionalLoadKg: 10 } },
        { reps: 5, weightKg: null, bandNominalResistanceKg: null,
          override: { assistanceLoadKg: 20 } },
      ] }],
    });
    expect(weighted.additionalLoad.value).toBe(50);
    expect(weighted.assistanceLoad.value).toBe(100);
    expect(weighted.externalLoadVolume.value).toBe(0);
    expect(weighted.bodyweight.referenceVolume.coverage.omittedReasons)
      .toEqual({ "missing-bodyweight-reference": 2 });
  });
});
