import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  evaluateMigrationFreeEnergyAcceptanceV1,
  type MigrationFreeEnergyEventV1,
  type MigrationFreeStrengthSessionV1,
  type MigrationFreeWorkoutAliasV1,
} from "../scripts/production-migration-free-acceptance";

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function currentEvent(id: number, eventKind = "other"): MigrationFreeEnergyEventV1 {
  return {
    id,
    logicalEventKey: `workout:${id}`,
    eventKind,
    isStale: false,
    supersededByEventId: null,
    currentResolutionFingerprint: id.toString(16).padStart(64, "0"),
    currentSource: "device-kcal",
    currentKcal: id * 10,
    currentProvenance: { source: "device-kcal" },
    candidates: [],
  };
}

function strengthAlias(): { alias: MigrationFreeWorkoutAliasV1; session: MigrationFreeStrengthSessionV1 } {
  const sessionId = 900;
  const sourceFingerprint = "a".repeat(64);
  const massResolutionIdentity = "b".repeat(64);
  const candidateProvenance = {
    estimator: "experimental-strength-active-energy-v1",
    stage02MassReference: null,
    stage02SnapshotRevision: 2,
    energyMassReference: {
      status: "observed",
      valueKg: 80,
      localDate: "2026-10-22",
      source: "apple-health-shortcut",
      sourceId: "weight-observation-1",
    },
    energyMassResolutionIdentity: massResolutionIdentity,
    energyMassResolutionMethodVersion: "bodycast-strength-energy-mass-resolution-v1",
  };
  const selectedProvenance = {
    policyVersion: "bodycast-active-energy-selection-v1",
    source: "bodycast-strength-estimate",
    sourceIdentity: `strength-session:${sessionId}`,
    sourceFingerprint,
    evidence: candidateProvenance,
  };
  const valueKcal = 245.5;
  const event: MigrationFreeEnergyEventV1 = {
    id: 9000,
    logicalEventKey: `strength-session:${sessionId}`,
    eventKind: "strength",
    isStale: false,
    supersededByEventId: null,
    currentResolutionFingerprint: fingerprint({
      logicalEventKey: `strength-session:${sessionId}`,
      source: "bodycast-strength-estimate",
      valueKcal,
      provenance: selectedProvenance,
    }),
    currentSource: "bodycast-strength-estimate",
    currentKcal: valueKcal,
    currentProvenance: selectedProvenance,
    candidates: [{
      source: "bodycast-strength-estimate",
      sourceIdentity: `strength-session:${sessionId}`,
      sourceFingerprint,
      availability: "available",
      valueKcal,
      provenance: candidateProvenance,
    }],
  };
  const session: MigrationFreeStrengthSessionV1 = {
    id: sessionId,
    status: "COMPLETED",
    entryMode: "LIVE",
    matchStatus: "UNMATCHED",
    matchedWorkoutId: null,
    effectiveAccountingAt: new Date("2026-10-22T12:40:00.000Z"),
    webStartedAt: new Date("2026-10-22T12:40:00.000Z"),
    webEndedAt: new Date("2026-10-22T13:25:00.000Z"),
    accountingTimeZone: "Europe/Bratislava",
    accountingInputRevision: 3,
    currentSnapshotRevision: 2,
    exercises: [{ sets: [{ completedAt: new Date("2026-10-22T12:50:00.000Z") }] }],
  };
  return {
    alias: { sourceType: "strength-session", sourceId: String(sessionId), workoutId: null, workout: null, event },
    session,
  };
}

function validAcceptanceInput() {
  const workoutAliases: MigrationFreeWorkoutAliasV1[] = Array.from({ length: 33 }, (_, index) => {
    const id = index + 1;
    const stepper = id <= 12;
    return {
      sourceType: "workout",
      sourceId: String(id),
      workoutId: id,
      workout: { type: stepper ? "Stair Climbing" : "Running", hiddenFromHistory: false },
      event: currentEvent(id, stepper ? "stepper" : "other"),
    };
  });
  const strength = strengthAlias();
  workoutAliases.push(strength.alias);
  return { workoutAliases, strengthSessions: [strength.session] };
}

describe("migration-free production energy acceptance", () => {
  it("requires the complete current 33 Workout and 12 Stepper sets plus the selected Strength estimate", () => {
    expect(evaluateMigrationFreeEnergyAcceptanceV1(validAcceptanceInput())).toEqual({
      currentWorkoutResolutions: 33,
      currentStepperResolutions: 12,
      strengthSessionCurrent: true,
      diagnosticWorkoutId: 1,
    });
  });

  it("identifies the Strength session by its stored timezone and exact local minute", () => {
    const input = validAcceptanceInput();
    input.strengthSessions[0]!.effectiveAccountingAt = new Date("2026-10-22T12:41:00.000Z");
    input.strengthSessions[0]!.webStartedAt = new Date("2026-10-22T12:41:00.000Z");
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/expected one unmatched LIVE Strength session/);
  });

  it("does not allow a nearby session to replace the exact target session", () => {
    const input = validAcceptanceInput();
    input.strengthSessions.push({
      ...input.strengthSessions[0]!,
      id: 901,
      effectiveAccountingAt: new Date("2026-10-22T12:42:00.000Z"),
      webStartedAt: new Date("2026-10-22T12:42:00.000Z"),
    });
    expect(evaluateMigrationFreeEnergyAcceptanceV1(input).strengthSessionCurrent).toBe(true);
  });

  it("rejects a same-kcal candidate whose source fingerprint is not the canonical selected evidence", () => {
    const input = validAcceptanceInput();
    const strength = input.workoutAliases.find((alias) => alias.sourceType === "strength-session")!;
    strength.event.candidates[0]!.sourceFingerprint = "d".repeat(64);
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("rejects a Strength candidate whose Stage02 mass snapshot revision is stale", () => {
    const input = validAcceptanceInput();
    const strength = input.workoutAliases.find((alias) => alias.sourceType === "strength-session")!;
    const candidate = strength.event.candidates[0]!;
    const provenance = candidate.provenance as Record<string, unknown>;
    const staleProvenance = {
      ...provenance,
      stage02SnapshotRevision: 1,
    };
    candidate.provenance = staleProvenance;
    (strength.event.currentProvenance as Record<string, unknown>).evidence = staleProvenance;
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/current BodyCast candidate/);
  });

  it("rejects a stale Stepper event even when eleven other Stepper events remain current", () => {
    const input = validAcceptanceInput();
    input.workoutAliases[0]!.event.isStale = true;
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/32\/33 historical Workout/);
  });

  it("requires exactly the accepted historical Workout inventory", () => {
    const input = validAcceptanceInput();
    const extra = { ...input.workoutAliases[12]!, workoutId: 100, sourceId: "100", event: currentEvent(100) };
    input.workoutAliases.push(extra);
    expect(() => evaluateMigrationFreeEnergyAcceptanceV1(input)).toThrow(/34\/33 historical Workout/);
  });
});
