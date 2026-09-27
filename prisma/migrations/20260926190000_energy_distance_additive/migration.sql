-- Additive energy/distance policy fields. Does not rewrite raw Garmin or Apple observations.

ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "manualStepCount" INTEGER;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "manualActiveEnergyKcal" DOUBLE PRECISION;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "supersededByWorkoutId" INTEGER;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMPTZ(3);
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "supersessionReason" VARCHAR(80);

CREATE TABLE IF NOT EXISTS "StepperReconciliationGroup" (
  "id" SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL DEFAULT 1,
  "status" VARCHAR(20) NOT NULL,
  "evaluationRevision" INTEGER NOT NULL DEFAULT 0,
  "provisionalWorkoutId" INTEGER,
  "policyVersion" VARCHAR(80) NOT NULL,
  "localDate" VARCHAR(10) NOT NULL,
  "sourceRevision" VARCHAR(80),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "StepperReconciliationGroup_profileId_status_idx"
  ON "StepperReconciliationGroup" ("profileId", "status");
CREATE INDEX IF NOT EXISTS "StepperReconciliationGroup_profileId_localDate_idx"
  ON "StepperReconciliationGroup" ("profileId", "localDate");

ALTER TABLE "StepperReconciliationGroup" DROP CONSTRAINT IF EXISTS "StepperReconciliationGroup_status_check";
ALTER TABLE "StepperReconciliationGroup"
  ADD CONSTRAINT "StepperReconciliationGroup_status_check"
  CHECK ("status" IN ('pending', 'ambiguous', 'confirmed', 'rejected'));

CREATE TABLE IF NOT EXISTS "StepperReconciliationCandidate" (
  "id" SERIAL PRIMARY KEY,
  "groupId" INTEGER NOT NULL REFERENCES "StepperReconciliationGroup"("id") ON DELETE CASCADE,
  "manualWorkoutId" INTEGER NOT NULL,
  "garminWorkoutId" INTEGER NOT NULL,
  "candidateStatus" VARCHAR(40) NOT NULL,
  "manualCoverage" DOUBLE PRECISION NOT NULL,
  "garminCoverage" DOUBLE PRECISION NOT NULL,
  "stepEvidenceStatus" VARCHAR(40) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "StepperReconciliationCandidate_manualWorkoutId_garminWorkoutId_key"
  ON "StepperReconciliationCandidate" ("manualWorkoutId", "garminWorkoutId");
CREATE INDEX IF NOT EXISTS "StepperReconciliationCandidate_groupId_idx"
  ON "StepperReconciliationCandidate" ("groupId");
CREATE INDEX IF NOT EXISTS "StepperReconciliationCandidate_garminWorkoutId_idx"
  ON "StepperReconciliationCandidate" ("garminWorkoutId");

CREATE TABLE IF NOT EXISTS "ActivationRollbackEntry" (
  "id" SERIAL PRIMARY KEY,
  "generationId" VARCHAR(80) NOT NULL,
  "recordKind" VARCHAR(40) NOT NULL,
  "recordId" INTEGER NOT NULL,
  "field" VARCHAR(80) NOT NULL,
  "previousValue" JSONB NOT NULL,
  "newValue" JSONB NOT NULL,
  "sourceRevision" VARCHAR(80),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ActivationRollbackEntry_generationId_idx"
  ON "ActivationRollbackEntry" ("generationId");

DO $$ BEGIN
  ALTER TABLE "StepperReconciliationCandidate"
    ADD CONSTRAINT "StepperReconciliationCandidate_manualWorkoutId_fkey"
    FOREIGN KEY ("manualWorkoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "StepperReconciliationCandidate"
    ADD CONSTRAINT "StepperReconciliationCandidate_garminWorkoutId_fkey"
    FOREIGN KEY ("garminWorkoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "StepperReconciliationCandidate_confirmed_manual_key"
  ON "StepperReconciliationCandidate" ("manualWorkoutId")
  WHERE "candidateStatus" = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS "StepperReconciliationCandidate_confirmed_garmin_key"
  ON "StepperReconciliationCandidate" ("garminWorkoutId")
  WHERE "candidateStatus" = 'confirmed';
