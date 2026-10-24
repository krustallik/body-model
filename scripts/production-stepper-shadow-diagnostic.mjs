import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STEPPER_SHADOW_REVISION = "experimental-stepper-active-energy-v1";
const PERSISTENCE_ONLY_FIELDS = new Set(["inputFingerprint", "massReference"]);
const ESTIMATOR_RESULT_FIELDS = new Set([
  "contractVersion", "provenance", "supportedDomain", "availability", "estimatedActiveKcal",
  "lowerBoundKcal", "upperBoundKcal", "unavailableReason", "features", "reasons",
  "recoveryEnergy", "garminReferenceKcal",
]);
const STRENGTH_ESTIMATOR_RESULT_FIELDS = new Set([
  "contractVersion", "provenance", "supportedDomain", "availability", "estimatedActiveKcal",
  "lowerBoundKcal", "upperBoundKcal", "unavailableReason", "features", "reasons",
  "recoveryEnergy", "garminReferenceKcal",
]);
const STEPPER_MASS_POLICY = "stepper-observed-nearest-seven-calendar-days-v1";

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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function safeKeyList(keys) {
  return keys.filter((key) => /^[A-Za-z][A-Za-z0-9_]*$/.test(key)).sort().join(",") || "none";
}

/** Summarize only schema and fingerprint invariants; never return payload values or hashes. */
export function summarizeStepperShadowDiagnostic(row) {
  if (!isRecord(row)) {
    return [
      "energy_diagnostic_workout_56_shadow_present=no",
      "energy_diagnostic_workout_56_shadow_failure_reason=missing",
    ];
  }

  const shadowPresent = row.shadowPresent !== false;
  const result = row.result;
  const resultIsRecord = isRecord(result);
  const resultKeys = resultIsRecord ? Object.keys(result) : [];
  const inputFingerprint = resultIsRecord ? result.inputFingerprint : null;
  const canonicalEventInputFingerprint = row.canonicalEventInputFingerprint;
  const massReference = resultIsRecord ? result.massReference : null;
  const inputFingerprintValid = typeof inputFingerprint === "string" && /^[a-f0-9]{64}$/.test(inputFingerprint);
  const canonicalEventInputFingerprintValid = typeof canonicalEventInputFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(canonicalEventInputFingerprint);
  const sourceFingerprintValid = typeof row.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(row.sourceFingerprint);
  const estimatorPayload = resultIsRecord
    ? Object.fromEntries(Object.entries(result).filter(([key]) => !PERSISTENCE_ONLY_FIELDS.has(key)))
    : null;
  const sourceFingerprintMatchesPayload = inputFingerprintValid && sourceFingerprintValid
    ? row.sourceFingerprint === stableSha256(`${stableSha256(estimatorPayload)}|${inputFingerprint}`)
    : false;
  const verifierEstimatorPayload = resultIsRecord
    ? Object.fromEntries([...ESTIMATOR_RESULT_FIELDS].map((key) => [key, result[key]]))
    : null;
  const sourceFingerprintMatchesVerifierPayload = inputFingerprintValid && sourceFingerprintValid
    ? row.sourceFingerprint === stableSha256(`${stableSha256(verifierEstimatorPayload)}|${inputFingerprint}`)
    : false;
  const sourceFingerprintMatchesPayloadWithCanonicalInput = canonicalEventInputFingerprintValid && sourceFingerprintValid
    ? row.sourceFingerprint === stableSha256(`${stableSha256(estimatorPayload)}|${canonicalEventInputFingerprint}`)
    : false;
  const modelRevisionMatches = row.modelRevision === STEPPER_SHADOW_REVISION;
  const contractVersionMatches = resultIsRecord && result.contractVersion === STEPPER_SHADOW_REVISION;
  const resultKeysSet = new Set(resultKeys);
  const missingEstimatorFields = [...ESTIMATOR_RESULT_FIELDS].filter((key) => !resultKeysSet.has(key));
  const estimatorKeys = resultKeys.filter((key) => !PERSISTENCE_ONLY_FIELDS.has(key));
  const unknownEstimatorFieldCount = estimatorKeys.filter((key) => !ESTIMATOR_RESULT_FIELDS.has(key)).length;
  const shadowMassReferenceIsRecord = isRecord(massReference);
  const massStatus = shadowMassReferenceIsRecord ? massReference.status : null;
  const massValueValid = shadowMassReferenceIsRecord
    && (massStatus === "unavailable"
      ? massReference.valueKg === null
      : (massStatus === "observed" || massStatus === "model-estimated")
        && typeof massReference.valueKg === "number" && Number.isFinite(massReference.valueKg)
        && massReference.valueKg > 0);
  const massPolicyMatches = shadowMassReferenceIsRecord && massReference.policyVersion === STEPPER_MASS_POLICY;
  const modelFields = ["modelSourceKind", "modelEpisodeId", "modelVersion", "modelStateUpdatedAt", "modelGeneration"];
  const hasModelFields = shadowMassReferenceIsRecord && modelFields.some((key) => Object.hasOwn(massReference, key));
  const massSourceShapeValid = shadowMassReferenceIsRecord && (
    massStatus === "unavailable"
      ? massReference.sourceType === null && massReference.sourceId === null
        && massReference.sourceTimestamp === null && massReference.sourceDate === null
        && isIsoDate(massReference.normalizedLocalDate) && massReference.dayDistance === null && !hasModelFields
      : massStatus === "observed"
        ? ["health-metric-sample", "daily-health-data"].includes(massReference.sourceType)
          && typeof massReference.sourceId === "string" && massReference.sourceId.length > 0
          && (massReference.sourceTimestamp === null || isIsoTimestamp(massReference.sourceTimestamp))
          && isIsoDate(massReference.sourceDate) && isIsoDate(massReference.normalizedLocalDate)
          && Number.isSafeInteger(massReference.dayDistance) && massReference.dayDistance >= 0
          && massReference.dayDistance <= 7 && !hasModelFields
        : massStatus === "model-estimated"
          && (massReference.modelSourceKind === "predecessor-model" || massReference.modelSourceKind === "episode-initial")
          && massReference.sourceType === massReference.modelSourceKind
          && typeof massReference.sourceId === "string" && massReference.sourceId.length > 0
          && isIsoTimestamp(massReference.sourceTimestamp)
          && isIsoDate(massReference.sourceDate) && massReference.normalizedLocalDate === massReference.sourceDate
          && Number.isSafeInteger(massReference.dayDistance) && massReference.dayDistance >= 0
          && Number.isSafeInteger(massReference.modelEpisodeId) && massReference.modelEpisodeId > 0
          && typeof massReference.modelVersion === "string" && massReference.modelVersion.length > 0
          && isIsoTimestamp(massReference.modelStateUpdatedAt)
          && massReference.modelStateUpdatedAt === massReference.sourceTimestamp
          && (!Object.hasOwn(massReference, "modelGeneration")
            || (Number.isSafeInteger(massReference.modelGeneration) && massReference.modelGeneration >= 0)));
  const massModelShapeValid = shadowMassReferenceIsRecord && (massStatus !== "model-estimated"
    || (hasModelFields && massSourceShapeValid));
  const massReferenceShapeValid = massValueValid && massPolicyMatches && massSourceShapeValid && massModelShapeValid;

  let failureReason = "valid";
  if (!shadowPresent) failureReason = "missing";
  else if (!modelRevisionMatches) failureReason = "revision";
  else if (!resultIsRecord) failureReason = "result-shape";
  else if (!inputFingerprintValid) failureReason = "input-fingerprint";
  else if (!shadowMassReferenceIsRecord) failureReason = "mass-reference";
  else if (!contractVersionMatches) failureReason = "contract";
  else if (!massReferenceShapeValid) failureReason = "mass-reference-shape";
  else if (!sourceFingerprintMatchesPayload) failureReason = "source-fingerprint-payload-mismatch";
  else if (!sourceFingerprintMatchesVerifierPayload) failureReason = "source-fingerprint-verifier-reconstruction-mismatch";

  const workout72 = isRecord(row.targetWorkout72) ? row.targetWorkout72 : null;
  const strengthBinding = workout72 && isRecord(workout72.strengthBinding) ? workout72.strengthBinding : null;
  const strengthResult = strengthBinding && isRecord(strengthBinding.shadowResult) ? strengthBinding.shadowResult : null;
  const strengthEstimatorPayload = strengthResult
    ? Object.fromEntries([...STRENGTH_ESTIMATOR_RESULT_FIELDS]
      .filter((key) => Object.hasOwn(strengthResult, key))
      .map((key) => [key, strengthResult[key]]))
    : null;
  const strengthInputFingerprint = typeof strengthResult?.inputFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(strengthResult.inputFingerprint)
    ? strengthResult.inputFingerprint : null;
  const strengthPersistedFingerprint = strengthBinding?.shadowSourceFingerprint;
  const strengthPayloadFingerprintMatches = strengthInputFingerprint !== null
    && typeof strengthPersistedFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(strengthPersistedFingerprint)
    && strengthPersistedFingerprint === stableSha256(`${stableSha256(strengthEstimatorPayload)}|${strengthInputFingerprint}`);
  const strengthCandidateKcal = strengthBinding?.selectedCandidateKcal;
  const strengthShadowKcalMatches = Number.isFinite(strengthResult?.estimatedActiveKcal)
    && Number.isFinite(strengthCandidateKcal)
    && strengthResult.estimatedActiveKcal === strengthCandidateKcal;
  const workout72Lines = workout72 ? [
    `energy_diagnostic_workout_72_visible=${yesNo(workout72.visible === true)}`,
    `energy_diagnostic_workout_72_expected_kind=${["strength", "stepper", "other"].includes(workout72.expectedKind) ? workout72.expectedKind : "unknown"}`,
    `energy_diagnostic_workout_72_created_on_or_after_cutoff=${yesNo(workout72.createdOnOrAfterAcceptanceCutoff === true)}`,
    `energy_diagnostic_workout_72_raw_energy_non_null=${yesNo(workout72.rawEnergyNonNull === true)}`,
    `energy_diagnostic_workout_72_workout_alias_count=${Number.isSafeInteger(workout72.workoutAliasCount) ? workout72.workoutAliasCount : "unknown"}`,
    `energy_diagnostic_workout_72_canonical_event_count=${Number.isSafeInteger(workout72.canonicalEventCount) ? workout72.canonicalEventCount : "unknown"}`,
    `energy_diagnostic_workout_72_event_kind_match_count=${Number.isSafeInteger(workout72.eventKindMatchCount) ? workout72.eventKindMatchCount : "unknown"}`,
    `energy_diagnostic_workout_72_logical_identity_match_count=${Number.isSafeInteger(workout72.logicalIdentityMatchCount) ? workout72.logicalIdentityMatchCount : "unknown"}`,
    `energy_diagnostic_workout_72_current_valid_count=${Number.isSafeInteger(workout72.currentValidCount) ? workout72.currentValidCount : "unknown"}`,
    `energy_diagnostic_workout_72_resolution_revision_match_count=${Number.isSafeInteger(workout72.resolutionRevisionMatchCount) ? workout72.resolutionRevisionMatchCount : "unknown"}`,
    `energy_diagnostic_workout_72_selected_candidate_match_count=${Number.isSafeInteger(workout72.selectedCandidateMatchCount) ? workout72.selectedCandidateMatchCount : "unknown"}`,
    `energy_diagnostic_workout_72_selected_candidate_evidence_match_count=${Number.isSafeInteger(workout72.selectedCandidateEvidenceMatchCount) ? workout72.selectedCandidateEvidenceMatchCount : "unknown"}`,
    `energy_diagnostic_workout_72_available_candidate_count=${Number.isSafeInteger(workout72.availableCandidateCount) ? workout72.availableCandidateCount : "unknown"}`,
    `energy_diagnostic_workout_72_selected_source_code_first_event=${Number.isSafeInteger(workout72.selectedSourceCodeFirstEvent) ? workout72.selectedSourceCodeFirstEvent : "unknown"}`,
    `energy_diagnostic_workout_72_selected_identity_code_first_event=${Number.isSafeInteger(workout72.selectedIdentityCodeFirstEvent) ? workout72.selectedIdentityCodeFirstEvent : "unknown"}`,
    `energy_diagnostic_workout_72_stepper_shadow_present=${yesNo(workout72.stepperShadowPresent === true)}`,
    `energy_diagnostic_workout_72_strength_selected_source=${yesNo(strengthBinding?.selectedSourceIsStrengthEstimate === true)}`,
    `energy_diagnostic_workout_72_strength_selected_identity=${yesNo(strengthBinding?.selectedIdentityIsStrengthSession === true)}`,
    `energy_diagnostic_workout_72_strength_session_exists=${yesNo(strengthBinding?.sessionExists === true)}`,
    `energy_diagnostic_workout_72_strength_session_completed=${yesNo(strengthBinding?.sessionCompleted === true)}`,
    `energy_diagnostic_workout_72_strength_session_matched_workout=${yesNo(strengthBinding?.sessionMatchedToWorkout72 === true)}`,
    `energy_diagnostic_workout_72_strength_alias_count=${Number.isSafeInteger(strengthBinding?.strengthSessionAliasCount) ? strengthBinding.strengthSessionAliasCount : "unknown"}`,
    `energy_diagnostic_workout_72_strength_alias_same_event_count=${Number.isSafeInteger(strengthBinding?.strengthSessionAliasSameEventCount) ? strengthBinding.strengthSessionAliasSameEventCount : "unknown"}`,
    `energy_diagnostic_workout_72_strength_snapshot_exists=${yesNo(strengthBinding?.snapshotExists === true)}`,
    `energy_diagnostic_workout_72_strength_snapshot_revision_matches_session=${yesNo(strengthBinding?.snapshotRevisionMatchesSession === true)}`,
    `energy_diagnostic_workout_72_strength_snapshot_accounting_revision_matches=${yesNo(strengthBinding?.snapshotAccountingRevisionMatchesSession === true)}`,
    `energy_diagnostic_workout_72_strength_snapshot_payload_identity_matches=${yesNo(strengthBinding?.snapshotPayloadIdentityMatches === true)}`,
    `energy_diagnostic_workout_72_strength_snapshot_fingerprint_matches_payload=${yesNo(strengthBinding?.snapshotFingerprintMatchesPayload === true)}`,
    `energy_diagnostic_workout_72_strength_shadow_exists=${yesNo(strengthBinding?.shadowExists === true)}`,
    `energy_diagnostic_workout_72_strength_shadow_revision_matches=${yesNo(strengthBinding?.shadowModelRevisionMatches === true)}`,
    `energy_diagnostic_workout_72_strength_shadow_fingerprint_matches_payload=${yesNo(strengthPayloadFingerprintMatches)}`,
    `energy_diagnostic_workout_72_strength_shadow_input_fingerprint_matches_selected=${yesNo(strengthBinding?.shadowInputFingerprintMatchesSelected === true)}`,
    `energy_diagnostic_workout_72_strength_shadow_available=${yesNo(strengthBinding?.shadowAvailable === true)}`,
    `energy_diagnostic_workout_72_strength_shadow_kcal_matches_current=${yesNo(strengthShadowKcalMatches)}`,
    `energy_diagnostic_workout_72_strength_candidate_provenance_matches_shadow=${yesNo(strengthBinding?.selectedCandidateProvenanceMatchesShadow === true)}`,
    `energy_diagnostic_workout_72_strength_stage02_mass_matches_snapshot=${yesNo(strengthBinding?.shadowStage02MassMatchesSnapshot === true)}`,
    `energy_diagnostic_workout_72_strength_stage02_revision_matches_snapshot=${yesNo(strengthBinding?.shadowStage02RevisionMatchesSnapshot === true)}`,
    `energy_diagnostic_workout_72_strength_stage02_identity_matches_snapshot=${yesNo(strengthBinding?.shadowStage02IdentityMatchesSnapshot === true)}`,
    `energy_diagnostic_workout_72_strength_stage02_revision_is_current=${yesNo(strengthBinding?.shadowStage02RevisionIsCurrent === true)}`,
    `energy_diagnostic_workout_72_strength_energy_mass_matches_available_stage02=${strengthBinding?.energyMassMatchesAvailableStage02 === null ? "not-applicable" : yesNo(strengthBinding?.energyMassMatchesAvailableStage02 === true)}`,
    `energy_diagnostic_workout_72_strength_mass_status=${["observed", "model-estimated", "unavailable"].includes(strengthBinding?.stage02MassStatus) ? strengthBinding.stage02MassStatus : "unknown"}`,
  ] : [];

  return [
    `energy_diagnostic_workout_56_shadow_present=${yesNo(shadowPresent)}`,
    `energy_diagnostic_workout_56_shadow_model_revision_matches=${yesNo(modelRevisionMatches)}`,
    `energy_diagnostic_workout_56_shadow_result_is_object=${yesNo(resultIsRecord)}`,
    `energy_diagnostic_workout_56_shadow_contract_version_matches=${yesNo(contractVersionMatches)}`,
    `energy_diagnostic_workout_56_shadow_input_fingerprint_valid=${yesNo(inputFingerprintValid)}`,
    `energy_diagnostic_workout_56_shadow_input_fingerprint_matches_canonical_event=${yesNo(inputFingerprintValid && canonicalEventInputFingerprintValid && inputFingerprint === canonicalEventInputFingerprint)}`,
    `energy_diagnostic_workout_56_shadow_mass_reference_is_object=${yesNo(shadowMassReferenceIsRecord)}`,
    `energy_diagnostic_workout_56_shadow_source_fingerprint_valid=${yesNo(sourceFingerprintValid)}`,
    `energy_diagnostic_workout_56_shadow_source_fingerprint_matches_persisted_payload=${yesNo(sourceFingerprintMatchesPayload)}`,
    `energy_diagnostic_workout_56_shadow_source_fingerprint_matches_verifier_reconstruction=${yesNo(sourceFingerprintMatchesVerifierPayload)}`,
    `energy_diagnostic_workout_56_shadow_source_fingerprint_matches_payload_with_canonical_input=${yesNo(sourceFingerprintMatchesPayloadWithCanonicalInput)}`,
    `energy_diagnostic_workout_56_shadow_persisted_result_key_count=${resultKeys.length}`,
    `energy_diagnostic_workout_56_shadow_estimator_result_key_count=${estimatorKeys.length}`,
    `energy_diagnostic_workout_56_shadow_missing_estimator_keys=${safeKeyList(missingEstimatorFields)}`,
    `energy_diagnostic_workout_56_shadow_unknown_estimator_field_count=${unknownEstimatorFieldCount}`,
    `energy_diagnostic_workout_56_shadow_mass_status=${["observed", "model-estimated", "unavailable"].includes(massStatus) ? massStatus : "unknown"}`,
    `energy_diagnostic_workout_56_shadow_mass_value_valid=${yesNo(massValueValid)}`,
    `energy_diagnostic_workout_56_shadow_mass_policy_matches=${yesNo(massPolicyMatches)}`,
    `energy_diagnostic_workout_56_shadow_mass_source_shape_valid=${yesNo(massSourceShapeValid)}`,
    `energy_diagnostic_workout_56_shadow_mass_model_shape_valid=${yesNo(massModelShapeValid)}`,
    `energy_diagnostic_workout_56_reconciliation_status=${["pending", "ambiguous", "confirmed", "none"].includes(row.reconciliationStatus) ? row.reconciliationStatus : "unknown"}`,
    `energy_diagnostic_workout_56_reconciliation_representative_is_workout_56=${yesNo(row.reconciliationRepresentativeIsWorkout56 === true)}`,
    `energy_diagnostic_workout_56_reconciliation_representative_visible=${yesNo(row.reconciliationRepresentativeVisible === true)}`,
    `energy_diagnostic_workout_56_reconciliation_representative_shadow_exists=${yesNo(row.reconciliationRepresentativeShadowExists === true)}`,
    `energy_diagnostic_workout_56_shadow_failure_reason=${failureReason}`,
    ...workout72Lines,
  ];
}

export function sanitizeCheckoutDiagnosticOutput(rawOutput) {
  const payloadPrefix = "energy_diagnostic_workout_56_shadow_payload_b64=";
  const lines = rawOutput.split(/\r?\n/);
  const payloadLines = lines.filter((line) => line.startsWith(payloadPrefix));
  const safeOutput = lines.filter((line) => !line.startsWith(payloadPrefix) && line.length > 0);
  const summary = ["energy_diagnostic_workout_56_shadow_diagnostic_status=unavailable"];

  if (payloadLines.length === 1) {
    const encoded = payloadLines[0].slice(payloadPrefix.length);
    if (encoded === "none") {
      summary.splice(0, summary.length, ...summarizeStepperShadowDiagnostic(null));
      summary.push("energy_diagnostic_workout_56_shadow_diagnostic_status=complete");
    } else if (encoded === "unavailable") {
      summary.push("energy_diagnostic_workout_56_shadow_diagnostic_status=unavailable");
    } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      try {
        const row = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        summary.splice(0, summary.length, ...summarizeStepperShadowDiagnostic(row));
        summary.push("energy_diagnostic_workout_56_shadow_diagnostic_status=complete");
      } catch {
        summary.push("energy_diagnostic_workout_56_shadow_diagnostic_status=invalid_payload");
      }
    } else {
      summary.push("energy_diagnostic_workout_56_shadow_diagnostic_status=invalid_payload");
    }
  } else if (payloadLines.length > 1) {
    summary.push("energy_diagnostic_workout_56_shadow_diagnostic_status=duplicate_payload");
  }

  return [...safeOutput, ...summary].join("\n");
}

function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    process.stderr.write("Expected a captured read-only diagnostic output file.\n");
    process.exitCode = 2;
    return;
  }
  try {
    process.stdout.write(sanitizeCheckoutDiagnosticOutput(readFileSync(resolve(outputPath), "utf8")) + "\n");
  } catch {
    process.stderr.write("Could not sanitize the captured read-only diagnostic output.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
