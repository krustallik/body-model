import { describe, expect, it } from "vitest";
import {
  calculateLoadAccountingWithBreakdownV1,
  LEGACY_LOAD_CONFIGS_V1,
} from "@/modules/training/load-accounting-v1";
import {
  buildMassResolutionIdentity,
  PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1,
  PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2,
  persistedPayloadFromUnknown,
} from "@/modules/training/persisted-load-accounting-v1";
import { BODYWEIGHT_RESOLUTION_METHOD_V2 } from "@/modules/training/bodyweight-reference-v2";

function makeExternalPayload() {
  const localDate = "2026-09-24";
  const massReference = {
    status: "unavailable" as const,
    valueKg: null,
    localDate,
    source: null,
    sourceId: null,
  };
  const calculated = calculateLoadAccountingWithBreakdownV1({
    sessionId: 91,
    localDate,
    bodyweightReference: massReference,
    exercises: [{
      sessionExerciseId: 101,
      exerciseOrder: 0,
      exerciseName: "Hyperextension",
      identity: { status: "known-legacy", stableKey: "hyperextension" },
      resistanceHint: "external",
      configSnapshot: LEGACY_LOAD_CONFIGS_V1.hyperextension,
      sets: [{ strengthSetId: 201, setNumber: 1, reps: 2, weightKg: 5, bandNominalResistanceKg: null }],
    }],
  });
  return {
    schemaVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2,
    sessionId: 91,
    snapshotRevision: 1,
    accountingInputRevision: 1,
    effectiveAccountingAt: "2026-09-24T10:00:00.000Z",
    effectiveLocalDate: localDate,
    timeZone: "Europe/Bratislava",
    timeZoneProvenance: "user-selected",
    inputFingerprint: "a".repeat(64),
    accountingMethodVersion: calculated.result.methodVersion,
    massResolutionMethodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
    massResolutionIdentity: buildMassResolutionIdentity({
      localDate,
      timeZone: "Europe/Bratislava",
      methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
      reference: massReference,
    }),
    massReference,
    result: calculated.result,
    breakdown: calculated.breakdown,
  };
}

describe("versioned persisted load-accounting breakdown", () => {
  it("captures per-set category facts and keeps legacy aggregate payloads readable", () => {
    const localDate = "2026-09-24";
    const massReference = {
      status: "observed" as const,
      valueKg: 87,
      localDate,
      source: "apple-health-shortcut" as const,
      sourceId: "sample-87kg",
    };
    const calculated = calculateLoadAccountingWithBreakdownV1({
      sessionId: 91,
      localDate,
      bodyweightReference: massReference,
      exercises: [
        {
          sessionExerciseId: 101,
          exerciseOrder: 0,
          exerciseName: "Hyperextension",
          identity: { status: "known-legacy", stableKey: "hyperextension" },
          resistanceHint: "external",
          configSnapshot: LEGACY_LOAD_CONFIGS_V1.hyperextension,
          sets: [{ strengthSetId: 201, setNumber: 1, reps: 14, weightKg: 110, bandNominalResistanceKg: null }],
        },
        {
          sessionExerciseId: 102,
          exerciseOrder: 1,
          exerciseName: "Flat Dumbbell Fly",
          identity: { status: "known-legacy", stableKey: "flat_dumbbell_fly" },
          resistanceHint: "external",
          configSnapshot: LEGACY_LOAD_CONFIGS_V1.flat_dumbbell_fly,
          sets: [{
            strengthSetId: 202,
            setNumber: 1,
            reps: 12,
            weightKg: 10,
            bandNominalResistanceKg: null,
            override: { reps: { kind: "asymmetric-per-side", left: 12, right: 10 } },
          }],
        },
        {
          sessionExerciseId: 103,
          exerciseOrder: 2,
          exerciseName: "One Arm Seated Cable Row",
          identity: { status: "known-legacy", stableKey: "one_arm_seated_cable_row" },
          resistanceHint: "band-nominal",
          configSnapshot: LEGACY_LOAD_CONFIGS_V1.one_arm_seated_cable_row,
          sets: [{ strengthSetId: 203, setNumber: 1, reps: 30, weightKg: null, bandNominalResistanceKg: 92.34 }],
        },
        {
          sessionExerciseId: 104,
          exerciseOrder: 3,
          exerciseName: "Pull Up",
          identity: { status: "known-legacy", stableKey: "pull_up" },
          resistanceHint: "bodyweight",
          configSnapshot: LEGACY_LOAD_CONFIGS_V1.pull_up,
          sets: [{ strengthSetId: 204, setNumber: 1, reps: 18, weightKg: null, bandNominalResistanceKg: null }],
        },
      ],
    });

    expect(calculated.result.externalLoadVolume.value).toBe(1760);
    expect(calculated.result.bandNominalIndex.perLoggedSide.value).toBeCloseTo(2770.2, 10);
    expect(calculated.result.bodyweight.referenceVolume.value).toBe(1566);

    const rows = calculated.breakdown.rows;
    const hyperextension = rows.find(({ stableKey }) => stableKey === "hyperextension")!;
    expect(hyperextension).toMatchObject({
      sessionId: 91,
      sessionExerciseId: 101,
      exerciseOrder: 0,
      strengthSetId: 201,
      setNumber: 1,
      scalarReps: 14,
      enteredLoad: { externalKg: 110, bandNominalKg: null },
      config: { resolved: { implementsPerMovement: 1 }, provenance: { version: "bodycast-historical-load-entry-v1" } },
      mechanics: { inventoryCount: 1, loadedSides: 2, effectiveMultiplier: 1 },
      contributions: [{
        category: "externalLoadVolume",
        basis: "per-implement-kg",
        value: 1540,
        effectiveMultiplier: 1,
        availability: "available",
      }],
    });

    const asymmetric = rows.find(({ stableKey }) => stableKey === "flat_dumbbell_fly")!;
    expect(asymmetric.scalarReps).toBe(12);
    expect(asymmetric.effectiveReps).toBe(22);
    expect(asymmetric.asymmetricReps).toEqual({ left: 12, right: 10 });
    expect(asymmetric.contributions).toContainEqual(expect.objectContaining({
      category: "externalLoadVolume",
      basis: "per-implement-kg",
      value: 220,
      availability: "available",
    }));

    const band = rows.find(({ stableKey }) => stableKey === "one_arm_seated_cable_row")!;
    expect(band).toMatchObject({
      enteredLoad: { externalKg: null, bandNominalKg: 92.34 },
      mechanics: { loadedSides: 2, effectiveMultiplier: 1 },
      config: { resolved: { loadInput: "nominal-kg-per-logged-side" } },
    });
    expect(band.contributions.find(({ category }) => category === "bandNominalPerLoggedSide"))
      .toMatchObject({ basis: "nominal-kg-per-logged-side", availability: "available" });
    expect(band.contributions.find(({ category }) => category === "bandNominalPerLoggedSide")?.value)
      .toBeCloseTo(2770.2, 10);

    const pullUp = rows.find(({ stableKey }) => stableKey === "pull_up")!;
    expect(pullUp.contributions).toContainEqual(expect.objectContaining({
      category: "bodyweightReferenceVolume",
      basis: "bodyweight-reference",
      value: 1566,
      effectiveMultiplier: 1,
      availability: "available",
      provenance: expect.arrayContaining([expect.objectContaining({
        kind: "bodyweight-observation",
        version: "apple-health-shortcut",
        sourceId: "sample-87kg",
        localDate,
      })]),
    }));
    expect(pullUp.contributions).toContainEqual(expect.objectContaining({
      category: "bodyweightSets",
      basis: "sets",
      value: 1,
      unit: "sets",
    }));
    expect(pullUp.contributions).toContainEqual(expect.objectContaining({
      category: "additionalLoad",
      basis: "additional-load-kg",
      value: 0,
    }));

    const massResolutionIdentity = buildMassResolutionIdentity({
      localDate,
      timeZone: "Europe/Bratislava",
      methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
      reference: massReference,
    });
    const payload = {
      schemaVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2,
      sessionId: 91,
      snapshotRevision: 1,
      accountingInputRevision: 1,
      effectiveAccountingAt: "2026-09-24T10:00:00.000Z",
      effectiveLocalDate: localDate,
      timeZone: "Europe/Bratislava",
      timeZoneProvenance: "user-selected",
      inputFingerprint: "a".repeat(64),
      accountingMethodVersion: calculated.result.methodVersion,
      massResolutionMethodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
      massResolutionIdentity,
      massReference,
      result: calculated.result,
      breakdown: calculated.breakdown,
    };
    expect(persistedPayloadFromUnknown(payload)).toEqual(payload);

    const legacyPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "breakdown"));
    expect(persistedPayloadFromUnknown({
      ...legacyPayload,
      schemaVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1,
    })).toEqual({
      ...legacyPayload,
      schemaVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1,
    });
    expect(persistedPayloadFromUnknown(payload)).not.toBeNull();
  });

  it("persists symmetric band reps as separate left and right contributions", () => {
    const localDate = "2026-09-24";
    const config = {
      ...LEGACY_LOAD_CONFIGS_V1.one_arm_seated_cable_row,
      configVersion: "band-per-side-symmetric-reps-v1",
      accountingKind: "band-nominal-per-side" as const,
      repsMeaning: "per-side" as const,
    };
    const calculated = calculateLoadAccountingWithBreakdownV1({
      sessionId: 92,
      localDate,
      exercises: [{
        sessionExerciseId: 102,
        exerciseOrder: 0,
        exerciseName: "One Arm Seated Cable Row",
        identity: { status: "known-legacy", stableKey: "one_arm_seated_cable_row" },
        resistanceHint: "band-nominal",
        configSnapshot: config,
        sets: [{ strengthSetId: 202, setNumber: 1, reps: 12, weightKg: null, bandNominalResistanceKg: 20 }],
      }],
    });
    const row = calculated.breakdown.rows[0]!;
    expect(row.scalarReps).toBe(12);
    expect(row.effectiveReps).toBe(24);
    expect(row.asymmetricReps).toBeNull();
    expect(row.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "bandNominalLeftSide", value: 240, availability: "available" }),
      expect.objectContaining({ category: "bandNominalRightSide", value: 240, availability: "available" }),
    ]));
    expect(row.contributions.some(({ category }) => category === "bandNominalPerLoggedSide")).toBe(false);
    expect(calculated.result.bandNominalIndex.leftSide.value! + calculated.result.bandNominalIndex.rightSide.value!)
      .toBe(480);
  });

  it.each([
    { name: "category and basis mismatch", patch: { basis: "sets", unit: "sets" } },
    { name: "category and unit mismatch", patch: { unit: "sets" } },
    { name: "basis and unit mismatch", patch: { basis: "bodyweight-reference" } },
    { name: "unknown category", patch: { category: "mixedTotal" } },
    { name: "unknown basis", patch: { basis: "ordinaryTonnageKg" } },
    { name: "unknown unit", patch: { unit: "kilograms" } },
  ])("rejects V2 $name", ({ patch }) => {
    const candidate = structuredClone(makeExternalPayload()) as unknown as {
      breakdown: { rows: Array<{ contributions: Array<{ category: string; basis: string; unit: string }> }> };
    };
    const external = candidate.breakdown.rows[0]!.contributions.find(({ category }) =>
      category === "externalLoadVolume");
    if (!external) throw new Error("parser fixture is missing its external contribution");
    Object.assign(external, patch);

    expect(persistedPayloadFromUnknown(candidate)).toBeNull();
  });
});
