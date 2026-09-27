import {
  RECONCILIATION_POLICY_V1,
  displayedDailyStepsV1,
  pendingPairCountsV1,
  type EventCountBoundsV1,
} from "@/model/activity/canonical-activity-policy-v1";

export const RECONCILIATION_MATCH_COVERAGE = 0.7;

export type ReconciliationWorkoutV1 = {
  id: number;
  origin: "manual" | "garmin";
  startMs: number;
  endMs: number;
  stepCount: number | null;
};

export type ReconciliationCandidateV1 = {
  manualWorkoutId: number;
  garminWorkoutId: number;
  manualCoverage: number;
  garminCoverage: number;
  matched: boolean;
  stepEvidenceStatus: "comparable" | "garmin-zero-does-not-replace-manual" | "manual-steps-absent" | "garmin-steps-absent";
};

export type ReconciliationEvaluationV1 = {
  policyVersion: typeof RECONCILIATION_POLICY_V1;
  status: "unrelated" | "pending" | "ambiguous" | "confirmed" | "rejected";
  candidates: ReconciliationCandidateV1[];
  eventCounts: EventCountBoundsV1 | null;
  /** Reconciliation never hides or supersedes source rows. Activation does that later. */
  visibilityMutation: null;
  displayedSteps: number | null;
  potentialDuplication: boolean;
};

function overlapMs(left: ReconciliationWorkoutV1, right: ReconciliationWorkoutV1): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function coverage(owner: ReconciliationWorkoutV1, other: ReconciliationWorkoutV1): number {
  const duration = owner.endMs - owner.startMs;
  if (!(duration > 0)) return 0;
  return overlapMs(owner, other) / duration;
}

export function evaluateStepperReconciliationV1(input: {
  manual: readonly ReconciliationWorkoutV1[];
  garmin: readonly ReconciliationWorkoutV1[];
  synchronizedSteps: number | null;
  decision?: "confirm" | "reject";
  confirmedPair?: { manualWorkoutId: number; garminWorkoutId: number };
}): ReconciliationEvaluationV1 {
  const candidates: ReconciliationCandidateV1[] = [];
  for (const manual of input.manual) {
    for (const garmin of input.garmin) {
      const manualCoverage = coverage(manual, garmin);
      const garminCoverage = coverage(garmin, manual);
      const matched = manualCoverage >= RECONCILIATION_MATCH_COVERAGE
        && garminCoverage >= RECONCILIATION_MATCH_COVERAGE;
      let stepEvidenceStatus: ReconciliationCandidateV1["stepEvidenceStatus"] = "comparable";
      if (manual.stepCount === null) stepEvidenceStatus = "manual-steps-absent";
      else if (garmin.stepCount === null) stepEvidenceStatus = "garmin-steps-absent";
      else if (garmin.stepCount === 0 && manual.stepCount > 0) {
        stepEvidenceStatus = "garmin-zero-does-not-replace-manual";
      }
      candidates.push({
        manualWorkoutId: manual.id,
        garminWorkoutId: garmin.id,
        manualCoverage,
        garminCoverage,
        matched,
        stepEvidenceStatus,
      });
    }
  }
  const matched = candidates.filter((candidate) => candidate.matched);
  let status: ReconciliationEvaluationV1["status"] = "unrelated";
  if (input.decision === "reject") status = "rejected";
  else if (input.decision === "confirm" && input.confirmedPair
    && matched.some((candidate) => candidate.manualWorkoutId === input.confirmedPair!.manualWorkoutId
      && candidate.garminWorkoutId === input.confirmedPair!.garminWorkoutId)) {
    status = "confirmed";
  } else if (matched.length > 1) status = "ambiguous";
  else if (matched.length === 1) status = "pending";

  const manualSteps = input.manual.reduce((sum, workout) => sum + (workout.stepCount ?? 0), 0);
  const superseded = status === "confirmed";
  const steps = displayedDailyStepsV1({
    synchronizedSteps: input.synchronizedSteps,
    manualSteps,
    superseded,
    unresolvedOverlap: status === "pending" || status === "ambiguous",
  });
  return {
    policyVersion: RECONCILIATION_POLICY_V1,
    status,
    candidates,
    eventCounts: status === "pending" ? pendingPairCountsV1() : null,
    visibilityMutation: null,
    displayedSteps: steps.displayedSteps,
    potentialDuplication: steps.potentialDuplication,
  };
}
