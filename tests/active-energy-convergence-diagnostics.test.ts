import { describe, expect, it } from "vitest";
import {
  buildActiveEnergyRefreshDiagnosticV1,
  isActiveEnergyOscillationV1,
  type ActiveEnergyResolutionSnapshotV1,
} from "@/modules/activity/active-energy-materialization";

const fingerprint = (digit: string) => digit.repeat(64);

describe("recovery Active Energy convergence diagnostics", () => {
  it("reports changed event/date, fingerprints, and categorical mass provenance without measurements", () => {
    const before: ActiveEnergyResolutionSnapshotV1[] = [{
      id: 41,
      eventKind: "stepper",
      modelDate: "2026-10-10",
      isStale: true,
      currentResolutionFingerprint: fingerprint("a"),
      resolutionRevision: 2,
      currentSource: "unavailable",
      currentProvenance: null,
    }];
    const after: ActiveEnergyResolutionSnapshotV1[] = [{
      id: 41,
      eventKind: "stepper",
      modelDate: "2026-10-11",
      isStale: false,
      currentResolutionFingerprint: fingerprint("b"),
      resolutionRevision: 3,
      currentSource: "bodycast-stepper-mechanical",
      currentProvenance: {
        sourceFingerprint: fingerprint("c"),
        evidence: {
          massReference: {
            status: "model-estimated",
            sourceType: "predecessor-model",
            sourceId: "private-source-id",
            valueKg: 81.25,
          },
        },
      },
    }];

    const diagnostic = buildActiveEnergyRefreshDiagnosticV1(before, after, ["2026-10-11"]);
    expect(diagnostic).toMatchObject({
      changedEventCount: 1,
      omittedEventCount: 0,
      canonicalChangedDateCount: 1,
      canonicalChangedDates: ["2026-10-11"],
      changedEvents: [{
        eventId: 41,
        eventKind: "stepper",
        modelDateBefore: "2026-10-10",
        modelDateAfter: "2026-10-11",
        changeCategories: expect.arrayContaining([
          "candidate-fingerprint", "mass-provenance-source", "mass-provenance-status",
          "model-date", "resolution-fingerprint", "resolution-revision", "selected-source", "stale-state",
        ]),
        sourceCategoryAfter: "bodycast-stepper-mechanical",
        massStatusAfter: "model-estimated",
        massSourceCategoryAfter: "predecessor-model",
        candidateFingerprintBefore: null,
        candidateFingerprintAfter: fingerprint("c"),
        resolutionFingerprintBefore: fingerprint("a"),
        resolutionFingerprintAfter: fingerprint("b"),
      }],
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("81.25");
    expect(serialized).not.toContain("private-source-id");
  });

  it("bounds emitted event details while retaining the total and a digest", () => {
    const before: ActiveEnergyResolutionSnapshotV1[] = [];
    const after: ActiveEnergyResolutionSnapshotV1[] = Array.from({ length: 75 }, (_, index) => ({
      id: index + 1,
      eventKind: "stepper",
      modelDate: `2026-10-${String((index % 28) + 1).padStart(2, "0")}`,
      isStale: false,
      currentResolutionFingerprint: fingerprint("d"),
      resolutionRevision: 1,
      currentSource: "bodycast-stepper-mechanical",
      currentProvenance: { sourceFingerprint: fingerprint("e") },
    }));
    const diagnostic = buildActiveEnergyRefreshDiagnosticV1(before, after, []);
    expect(diagnostic.changedEventCount).toBe(75);
    expect(diagnostic.changedEvents).toHaveLength(50);
    expect(diagnostic.omittedEventCount).toBe(25);
    expect(diagnostic.changedEventsDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same state fingerprint for a repeated stable snapshot", () => {
    const stable: ActiveEnergyResolutionSnapshotV1[] = [{
      id: 7,
      eventKind: "strength",
      modelDate: "2026-10-19",
      isStale: false,
      currentResolutionFingerprint: fingerprint("f"),
      resolutionRevision: 9,
      currentSource: "bodycast-strength-estimate",
      currentProvenance: { sourceFingerprint: fingerprint("1") },
    }];
    const first = buildActiveEnergyRefreshDiagnosticV1(stable, stable, []);
    const second = buildActiveEnergyRefreshDiagnosticV1(stable, stable, []);
    expect(first.changedEventCount).toBe(0);
    expect(first.resolutionStateFingerprintAfter).toBe(second.resolutionStateFingerprintAfter);
  });

  it("detects repeated semantic state across monotonic resolution revisions", () => {
    const state: ActiveEnergyResolutionSnapshotV1 = {
      id: 8,
      eventKind: "stepper",
      modelDate: "2026-10-19",
      isStale: false,
      currentResolutionFingerprint: fingerprint("a"),
      resolutionRevision: 9,
      currentSource: "bodycast-stepper-mechanical",
      currentProvenance: { sourceFingerprint: fingerprint("b") },
    };
    const laterRevision = { ...state, resolutionRevision: 11 };
    const first = buildActiveEnergyRefreshDiagnosticV1([state], [state], []);
    const repeated = buildActiveEnergyRefreshDiagnosticV1([laterRevision], [laterRevision], []);
    const revisionChange = buildActiveEnergyRefreshDiagnosticV1([state], [laterRevision], []);

    expect(first.resolutionStateFingerprintAfter).toBe(repeated.resolutionStateFingerprintAfter);
    expect(revisionChange.changedEvents[0]).toMatchObject({
      changeCategories: ["resolution-revision"],
      revisionBefore: 9,
      revisionAfter: 11,
    });
  });

  it("distinguishes A→B→A candidate oscillation from revision-only persistence churn", () => {
    expect(isActiveEnergyOscillationV1({
      currentPass: 3,
      repeatedStateFromPass: 1,
      changedDateCount: 1,
      stateFingerprintBefore: fingerprint("b"),
      stateFingerprintAfter: fingerprint("a"),
    })).toBe(true);

    expect(isActiveEnergyOscillationV1({
      currentPass: 3,
      repeatedStateFromPass: 1,
      changedDateCount: 1,
      stateFingerprintBefore: fingerprint("a"),
      stateFingerprintAfter: fingerprint("a"),
    })).toBe(false);
    expect(isActiveEnergyOscillationV1({
      currentPass: 2,
      repeatedStateFromPass: 1,
      changedDateCount: 1,
      stateFingerprintBefore: fingerprint("a"),
      stateFingerprintAfter: fingerprint("b"),
    })).toBe(false);
  });

  it("reports candidate fingerprint churn even when the canonical resolution did not change", () => {
    const before: ActiveEnergyResolutionSnapshotV1[] = [{
      id: 12,
      eventKind: "stepper",
      modelDate: "2026-10-19",
      isStale: false,
      currentResolutionFingerprint: fingerprint("2"),
      resolutionRevision: 4,
      currentSource: "bodycast-stepper-mechanical",
      currentProvenance: { sourceFingerprint: fingerprint("3") },
    }];
    const after: ActiveEnergyResolutionSnapshotV1[] = [{
      ...before[0],
      currentProvenance: { sourceFingerprint: fingerprint("4") },
    }];

    const diagnostic = buildActiveEnergyRefreshDiagnosticV1(before, after, []);
    expect(diagnostic.changedEventCount).toBe(1);
    expect(diagnostic.changedEvents[0]).toMatchObject({
      eventId: 12,
      changeCategories: ["candidate-fingerprint"],
      candidateFingerprintBefore: fingerprint("3"),
      candidateFingerprintAfter: fingerprint("4"),
      resolutionFingerprintBefore: fingerprint("2"),
      resolutionFingerprintAfter: fingerprint("2"),
      revisionBefore: 4,
      revisionAfter: 4,
    });
    expect(diagnostic.canonicalChangedDateCount).toBe(0);
  });

  it("reads Stepper mass provenance even when another candidate remains selected", () => {
    const before: ActiveEnergyResolutionSnapshotV1[] = [{
      id: 99,
      eventKind: "stepper",
      modelDate: "2026-10-19",
      isStale: false,
      currentResolutionFingerprint: fingerprint("5"),
      resolutionRevision: 1,
      currentSource: "device-kcal",
      currentProvenance: { sourceFingerprint: fingerprint("6") },
      stepperShadows: [{ id: 2, sourceType: "workout", sourceId: "private-shadow-id", workoutId: 2, workout: { experimentalStepperActiveEnergyShadow: {
        sourceFingerprint: fingerprint("7"),
        result: { massReference: { status: "unavailable", sourceType: null, sourceId: "private-shadow-id", valueKg: 734.125 } },
      } } }],
    }];
    const after: ActiveEnergyResolutionSnapshotV1[] = [{
      ...before[0],
      stepperShadows: [{ id: 2, sourceType: "workout", sourceId: "private-shadow-id", workoutId: 2, workout: { experimentalStepperActiveEnergyShadow: {
        sourceFingerprint: fingerprint("8"),
        result: { massReference: { status: "model-estimated", modelSourceKind: "predecessor-model", valueKg: 735.25 } },
      } } }],
    }];

    const diagnostic = buildActiveEnergyRefreshDiagnosticV1(before, after, []);
    expect(diagnostic.changedEvents[0]).toMatchObject({
      sourceCategoryBefore: "device-kcal",
      massStatusBefore: "unavailable",
      massStatusAfter: "model-estimated",
      massSourceCategoryBefore: "other",
      massSourceCategoryAfter: "predecessor-model",
      stepperCandidateCountBefore: 1,
      stepperCandidateCountAfter: 1,
      stepperCandidatesBefore: [{ candidateFingerprint: fingerprint("7"), massStatus: "unavailable" }],
      stepperCandidatesAfter: [{ candidateFingerprint: fingerprint("8"), massSourceCategory: "predecessor-model" }],
    });
    expect(JSON.stringify(diagnostic)).not.toContain("734.125");
    expect(JSON.stringify(diagnostic)).not.toContain("735.25");
    expect(JSON.stringify(diagnostic)).not.toContain("private-shadow-id");
    expect(JSON.stringify(diagnostic)).not.toContain("valueKg");
  });

  it("attributes every aliased Stepper shadow deterministically regardless of relation order", () => {
    const aliases = [
      { id: 8, sourceType: "workout", sourceId: "private-a", workoutId: 8, workout: { experimentalStepperActiveEnergyShadow: {
        sourceFingerprint: fingerprint("8"), result: { massReference: { status: "model-estimated", modelSourceKind: "predecessor-model" } },
      } } },
      { id: 3, sourceType: "workout", sourceId: "private-b", workoutId: 3, workout: { experimentalStepperActiveEnergyShadow: {
        sourceFingerprint: fingerprint("3"), result: { massReference: { status: "observed", sourceType: "health-metric-sample" } },
      } } },
    ];
    const snapshot: ActiveEnergyResolutionSnapshotV1 = {
      id: 123,
      eventKind: "stepper",
      modelDate: "2026-10-19",
      isStale: false,
      currentResolutionFingerprint: fingerprint("a"),
      resolutionRevision: 1,
      currentSource: "device-kcal",
      currentProvenance: null,
      stepperShadows: aliases,
    };
    const first = buildActiveEnergyRefreshDiagnosticV1([snapshot], [snapshot], []);
    const reordered = buildActiveEnergyRefreshDiagnosticV1(
      [snapshot], [{ ...snapshot, stepperShadows: [...aliases].reverse() }], [],
    );
    expect(first.changedEventCount).toBe(0);
    expect(first.resolutionStateFingerprintAfter).toBe(reordered.resolutionStateFingerprintAfter);
    expect(reordered.changedEventCount).toBe(0);

    const changed = buildActiveEnergyRefreshDiagnosticV1(
      [snapshot], [{ ...snapshot, stepperShadows: [aliases[1]!, { ...aliases[0]!, workoutId: 9 }] }], [],
    );
    expect(changed.changedEvents[0]).toMatchObject({
      eventId: 123,
      changeCategories: expect.arrayContaining(["candidate-fingerprint"]),
      stepperCandidateCountBefore: 2,
      stepperCandidateCountAfter: 2,
    });
    expect(changed.changedEvents[0]?.stepperCandidatesAfter.map(({ candidateFingerprint }) => candidateFingerprint))
      .toEqual(expect.arrayContaining([fingerprint("3"), fingerprint("8")]));
    expect(JSON.stringify(changed)).not.toContain("private-a");
    expect(JSON.stringify(changed)).not.toContain("private-b");
  });

  it("bounds per-event Stepper candidate details while retaining their count and digest", () => {
    const snapshot: ActiveEnergyResolutionSnapshotV1 = {
      id: 124,
      eventKind: "stepper",
      modelDate: "2026-10-19",
      isStale: false,
      currentResolutionFingerprint: fingerprint("a"),
      resolutionRevision: 1,
      currentSource: "device-kcal",
      stepperShadows: Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        sourceType: "workout",
        sourceId: `private-${index + 1}`,
        workoutId: index + 1,
        workout: { experimentalStepperActiveEnergyShadow: {
          sourceFingerprint: fingerprint((index % 10).toString(16)),
          result: { massReference: { status: "unavailable" } },
        } },
      })),
    };
    const changed = buildActiveEnergyRefreshDiagnosticV1([], [snapshot], []);
    expect(changed.changedEvents[0]).toMatchObject({
      stepperCandidateCountAfter: 25,
      stepperCandidatesOmittedAfter: 5,
      stepperCandidatesAfter: expect.any(Array),
    });
    expect(changed.changedEvents[0]?.stepperCandidatesAfter).toHaveLength(20);
  });
});
