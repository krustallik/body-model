CREATE TABLE "ExperimentalStepperGlycogenDemandShadow" (
    "id" SERIAL NOT NULL,
    "workoutId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "modelRevision" VARCHAR(100) NOT NULL,
    "features" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ExperimentalStepperGlycogenDemandShadow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentalStepperGlycogenDemandShadow_workoutId_key"
ON "ExperimentalStepperGlycogenDemandShadow"("workoutId");
CREATE INDEX "ExperimentalStepperGlycogenDemandShadow_profileId_updatedAt_idx"
ON "ExperimentalStepperGlycogenDemandShadow"("profileId", "updatedAt");

ALTER TABLE "ExperimentalStepperGlycogenDemandShadow"
ADD CONSTRAINT "ExperimentalStepperGlycogenDemandShadow_workoutId_fkey"
FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
