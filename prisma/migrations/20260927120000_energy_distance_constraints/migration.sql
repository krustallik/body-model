-- Harden reconciliation candidate statuses and Workout supersession referential integrity.

ALTER TABLE "StepperReconciliationCandidate" DROP CONSTRAINT IF EXISTS "StepperReconciliationCandidate_status_check";
ALTER TABLE "StepperReconciliationCandidate"
  ADD CONSTRAINT "StepperReconciliationCandidate_status_check"
  CHECK ("candidateStatus" IN ('pending', 'ambiguous', 'confirmed', 'rejected'));

DO $$ BEGIN
  ALTER TABLE "Workout"
    ADD CONSTRAINT "Workout_supersededByWorkoutId_fkey"
    FOREIGN KEY ("supersededByWorkoutId") REFERENCES "Workout"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StepperReconciliationGroup"
    ADD CONSTRAINT "StepperReconciliationGroup_provisionalWorkoutId_fkey"
    FOREIGN KEY ("provisionalWorkoutId") REFERENCES "Workout"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
