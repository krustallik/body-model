import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sanitizeCheckoutDiagnosticOutput, STEPPER_SHADOW_REVISION } from "../scripts/production-stepper-shadow-diagnostic.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function stableSha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function diagnosticLine(row) {
  return `energy_diagnostic_workout_56_shadow_payload_b64=${Buffer.from(JSON.stringify(row)).toString("base64")}`;
}

function validRow(resultExtension = {}) {
  const result = {
    contractVersion: STEPPER_SHADOW_REVISION,
    provenance: "experimental-heuristic",
    supportedDomain: "ms100-stair-stepper-experimental-v1",
    availability: "available",
    estimatedActiveKcal: 301.75,
    lowerBoundKcal: 275,
    upperBoundKcal: 340,
    unavailableReason: null,
    features: { bracketedStepCount: 5000 },
    reasons: ["mechanical-estimate"],
    recoveryEnergy: { disposition: "separate" },
    garminReferenceKcal: 527,
    ...resultExtension,
    massReference: {
      status: "observed", sourceType: "health-metric-sample", sourceId: "private-source-id",
      valueKg: 89.9, sourceTimestamp: "2026-10-22T12:00:00.000Z", sourceDate: "2026-10-22",
      normalizedLocalDate: "2026-10-22", dayDistance: 0,
      policyVersion: "stepper-observed-nearest-seven-calendar-days-v1",
    },
    inputFingerprint: "a".repeat(64),
  };
  const estimatorResult = Object.fromEntries(Object.entries(result)
    .filter(([key]) => key !== "massReference" && key !== "inputFingerprint"));
  return {
    modelRevision: STEPPER_SHADOW_REVISION,
    sourceFingerprint: stableSha256(`${stableSha256(estimatorResult)}|${result.inputFingerprint}`),
    canonicalEventInputFingerprint: result.inputFingerprint,
    reconciliationStatus: "none",
    reconciliationRepresentativeIsWorkout56: true,
    reconciliationRepresentativeVisible: true,
    reconciliationRepresentativeShadowExists: true,
    result,
  };
}

describe("production Workout 56 shadow diagnostic sanitizer", () => {
  it("checks persisted payload binding without printing kcal, mass, source ids, or hashes", () => {
    const row = validRow();
    const privateValues = ["301.75", "89.9", "private-source-id", row.sourceFingerprint, row.result.inputFingerprint];
    const output = sanitizeCheckoutDiagnosticOutput(`diagnostic_status=complete\n${diagnosticLine(row)}\n`);

    expect(output).toContain("energy_diagnostic_workout_56_shadow_source_fingerprint_matches_persisted_payload=yes");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_input_fingerprint_matches_canonical_event=yes");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=valid");
    expect(output).not.toContain("shadow_payload_b64");
    for (const value of privateValues) expect(output).not.toContain(value);
  });

  it("reports sanitized Workout 72 acceptance evidence in the same diagnostic payload", () => {
    const row = validRow();
    row.targetWorkout72 = {
        visible: true,
        expectedKind: "strength",
        createdOnOrAfterAcceptanceCutoff: false,
        rawEnergyNonNull: true,
        workoutAliasCount: 1,
        canonicalEventCount: 1,
        eventKindMatchCount: 1,
        logicalIdentityMatchCount: 1,
        currentValidCount: 1,
        resolutionRevisionMatchCount: 1,
        selectedCandidateMatchCount: 0,
        selectedCandidateEvidenceMatchCount: 0,
        availableCandidateCount: 1,
        selectedSourceCodeFirstEvent: 4,
        selectedIdentityCodeFirstEvent: 4,
        stepperShadowPresent: false,
        privateValue: "must-not-be-printed",
      };
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_72_expected_kind=strength");
    expect(output).toContain("energy_diagnostic_workout_72_selected_candidate_match_count=0");
    expect(output).toContain("energy_diagnostic_workout_72_selected_candidate_evidence_match_count=0");
    expect(output).toContain("energy_diagnostic_workout_72_selected_source_code_first_event=4");
    expect(output).not.toContain("must-not-be-printed");
  });

  it("reports the full Strength source-binding chain without exposing its persisted payload", () => {
    const row = validRow();
    const strengthResult = {
      contractVersion: "experimental-strength-active-energy-v1",
      provenance: "experimental-heuristic",
      supportedDomain: "resistance-diary-session-shadow-only",
      availability: "available",
      estimatedActiveKcal: 318.25,
      lowerBoundKcal: 270,
      upperBoundKcal: 370,
      unavailableReason: null,
      features: { privateMassValue: 88.4 },
      reasons: ["session-estimate"],
      recoveryEnergy: { disposition: "separate" },
      garminReferenceKcal: 401,
      inputFingerprint: "b".repeat(64),
      stage02MassReference: { sourceId: "private-health-id" },
    };
    const estimatorFields = ["contractVersion", "provenance", "supportedDomain", "availability", "estimatedActiveKcal",
      "lowerBoundKcal", "upperBoundKcal", "unavailableReason", "features", "reasons", "recoveryEnergy", "garminReferenceKcal"];
    const estimatorPayload = Object.fromEntries(estimatorFields
      .map((key) => [key, strengthResult[key]]));
    const strengthFingerprint = stableSha256(`${stableSha256(estimatorPayload)}|${strengthResult.inputFingerprint}`);
    row.targetWorkout72 = {
      visible: true,
      expectedKind: "strength",
      selectedSourceCodeFirstEvent: 4,
      selectedIdentityCodeFirstEvent: 4,
      strengthBinding: {
        selectedSourceIsStrengthEstimate: true,
        selectedIdentityIsStrengthSession: true,
        sessionExists: true,
        sessionCompleted: true,
        sessionMatchedToWorkout72: true,
        strengthSessionAliasCount: 1,
        strengthSessionAliasSameEventCount: 1,
        snapshotExists: true,
        snapshotRevisionMatchesSession: true,
        snapshotAccountingRevisionMatchesSession: true,
        snapshotPayloadIdentityMatches: true,
        snapshotFingerprintMatchesPayload: true,
        shadowExists: true,
        shadowModelRevisionMatches: true,
        shadowInputFingerprintMatchesSelected: true,
        shadowAvailable: true,
        selectedCandidateKcal: 318.25,
        shadowSourceFingerprint: strengthFingerprint,
        shadowResult: strengthResult,
        selectedCandidateProvenanceMatchesShadow: true,
        shadowStage02MassMatchesSnapshot: true,
        shadowStage02RevisionMatchesSnapshot: true,
        shadowStage02IdentityMatchesSnapshot: true,
        shadowStage02RevisionIsCurrent: true,
        energyMassMatchesAvailableStage02: true,
        stage02MassStatus: "observed",
      },
    };
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_72_strength_shadow_fingerprint_matches_payload=yes");
    expect(output).toContain("energy_diagnostic_workout_72_strength_session_matched_workout=yes");
    expect(output).toContain("energy_diagnostic_workout_72_strength_energy_mass_matches_available_stage02=yes");
    expect(output).not.toContain("318.25");
    expect(output).not.toContain("88.4");
    expect(output).not.toContain("private-health-id");
    expect(output).not.toContain(strengthFingerprint);
  });

  it("identifies when a Strength shadow payload was not refreshed with its fingerprint", () => {
    const row = validRow();
    row.targetWorkout72 = {
      expectedKind: "strength",
      strengthBinding: {
        shadowSourceFingerprint: "c".repeat(64),
        shadowResult: {
          contractVersion: "experimental-strength-active-energy-v1",
          provenance: "experimental-heuristic",
          supportedDomain: "resistance-diary-session-shadow-only",
          availability: "available",
          estimatedActiveKcal: 318,
          lowerBoundKcal: 270,
          upperBoundKcal: 370,
          unavailableReason: null,
          features: {},
          reasons: [],
          recoveryEnergy: { disposition: "separate" },
          garminReferenceKcal: null,
          inputFingerprint: "d".repeat(64),
        },
      },
    };
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_72_strength_shadow_fingerprint_matches_payload=no");
  });

  it("keeps Workout 72 evidence when the Workout 56 shadow is absent", () => {
    const row = validRow();
    row.shadowPresent = false;
    row.result = null;
    row.sourceFingerprint = null;
    row.targetWorkout72 = { visible: true, expectedKind: "stepper", canonicalEventCount: 1 };
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_present=no");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=missing");
    expect(output).toContain("energy_diagnostic_workout_72_expected_kind=stepper");
    expect(output).toContain("energy_diagnostic_workout_72_canonical_event_count=1");
  });

  it("identifies a payload changed after its source fingerprint was written", () => {
    const row = validRow();
    row.result.estimatedActiveKcal += 1;
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_source_fingerprint_matches_persisted_payload=no");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=source-fingerprint-payload-mismatch");
  });

  it("distinguishes a shadow input fingerprint that no longer matches the canonical event", () => {
    const row = validRow();
    row.canonicalEventInputFingerprint = "b".repeat(64);
    row.sourceFingerprint = stableSha256(`${stableSha256(Object.fromEntries(Object.entries(row.result)
      .filter(([key]) => key !== "massReference" && key !== "inputFingerprint")))}|${row.canonicalEventInputFingerprint}`);
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_input_fingerprint_matches_canonical_event=no");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_source_fingerprint_matches_payload_with_canonical_input=yes");
  });

  it("classifies malformed mass provenance instead of reporting a valid shadow", () => {
    const row = validRow();
    row.result.massReference.valueKg = "89.9";
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_mass_value_valid=no");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=mass-reference-shape");
  });

  it("rejects unknown mass source types and malformed timestamps", () => {
    const row = validRow();
    row.result.massReference.sourceType = "unrecognized-source";
    row.result.massReference.sourceTimestamp = "yesterday";
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_mass_source_shape_valid=no");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=mass-reference-shape");
  });

  it("accepts the producer's model-estimated mass provenance shape", () => {
    const row = validRow();
    Object.assign(row.result.massReference, {
      status: "model-estimated",
      sourceType: "predecessor-model",
      sourceId: "daily-model-state:42",
      sourceTimestamp: "2026-10-21T23:00:00.000Z",
      sourceDate: "2026-10-21",
      normalizedLocalDate: "2026-10-21",
      dayDistance: 1,
      modelSourceKind: "predecessor-model",
      modelEpisodeId: 2,
      modelVersion: "model-v1",
      modelStateUpdatedAt: "2026-10-21T23:00:00.000Z",
      modelGeneration: 7,
    });
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_mass_model_shape_valid=yes");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=valid");
  });

  it("requires unavailable mass provenance to keep all source fields null", () => {
    const row = validRow();
    Object.assign(row.result.massReference, {
      status: "unavailable", sourceType: null, sourceId: null, valueKg: null,
      sourceTimestamp: null, sourceDate: "2026-10-22", normalizedLocalDate: "2026-10-22",
      dayDistance: 0,
    });
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_mass_source_shape_valid=no");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=mass-reference-shape");
  });

  it("fingerprints complete persisted estimator payloads including future fields", () => {
    const row = validRow({ futureEstimatorField: "private-value" });
    const output = sanitizeCheckoutDiagnosticOutput(diagnosticLine(row));

    expect(output).toContain("energy_diagnostic_workout_56_shadow_source_fingerprint_matches_persisted_payload=yes");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_source_fingerprint_matches_verifier_reconstruction=no");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_failure_reason=source-fingerprint-verifier-reconstruction-mismatch");
    expect(output).toContain("energy_diagnostic_workout_56_shadow_unknown_estimator_field_count=1");
    expect(output).not.toContain("private-value");
  });

  it("classifies revision and missing-row failures without exposing payload values", () => {
    const row = validRow();
    row.modelRevision = "stale-revision";
    expect(sanitizeCheckoutDiagnosticOutput(diagnosticLine(row)))
      .toContain("energy_diagnostic_workout_56_shadow_failure_reason=revision");
    expect(sanitizeCheckoutDiagnosticOutput("energy_diagnostic_workout_56_shadow_payload_b64=none"))
      .toContain("energy_diagnostic_workout_56_shadow_failure_reason=missing");
    expect(sanitizeCheckoutDiagnosticOutput("energy_diagnostic_workout_56_shadow_payload_b64=unavailable"))
      .toContain("energy_diagnostic_workout_56_shadow_diagnostic_status=unavailable");
  });
});
