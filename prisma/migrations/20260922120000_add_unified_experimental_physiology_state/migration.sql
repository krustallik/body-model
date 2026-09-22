-- Unified V1 is an isolated experimental/shadow state. It is never read by
-- production TDEE, forecast, goal planning, or canonical body composition.
CREATE TABLE "UnifiedExperimentalPhysiologyState" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "date" VARCHAR(10) NOT NULL,
    "modelRevision" VARCHAR(120) NOT NULL,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "priorStateFingerprint" VARCHAR(64),
    "resultFingerprint" VARCHAR(64) NOT NULL,
    "qualityStatus" VARCHAR(30) NOT NULL,
    "gapSeverity" VARCHAR(30) NOT NULL,
    "state" JSONB NOT NULL,
    "deltas" JSONB NOT NULL,
    "uncertainty" JSONB NOT NULL,
    "reconciliation" JSONB NOT NULL,
    "energyLedger" JSONB NOT NULL,
    "sourceLineage" JSONB NOT NULL,
    "diagnostics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnifiedExperimentalPhysiologyState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnifiedExperimentalPhysiologyState_profileId_date_key"
  ON "UnifiedExperimentalPhysiologyState"("profileId", "date");
CREATE INDEX "UnifiedExperimentalPhysiologyState_profileId_date_idx"
  ON "UnifiedExperimentalPhysiologyState"("profileId", "date");
CREATE INDEX "UnifiedExperimentalPhysiologyState_profileId_modelRevision_updatedAt_idx"
  ON "UnifiedExperimentalPhysiologyState"("profileId", "modelRevision", "updatedAt");
CREATE INDEX "UnifiedExperimentalPhysiologyState_profileId_qualityStatus_date_idx"
  ON "UnifiedExperimentalPhysiologyState"("profileId", "qualityStatus", "date");
CREATE INDEX "UnifiedExperimentalPhysiologyState_profileId_resultFingerprint_idx"
  ON "UnifiedExperimentalPhysiologyState"("profileId", "resultFingerprint");

ALTER TABLE "UnifiedExperimentalPhysiologyState"
  ADD CONSTRAINT "UnifiedExperimentalPhysiologyState_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
