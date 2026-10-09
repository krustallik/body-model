-- Additive episode-aware Unified V2 persistence. Unified V1 remains unchanged
-- so an older application can continue reading and upserting its existing key.
CREATE TABLE "UnifiedExperimentalPhysiologyStateV2" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "modelEpisodeId" INTEGER NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "boundaryAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
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

    CONSTRAINT "UnifiedExperimentalPhysiologyStateV2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UnifiedExperimentalPhysiologyStateV2_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UnifiedExperimentalPhysiologyStateV2_modelEpisodeId_fkey"
      FOREIGN KEY ("modelEpisodeId") REFERENCES "ModelEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_date_key"
  ON "UnifiedExperimentalPhysiologyStateV2"("profileId", "modelEpisodeId", "date");
CREATE INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_boundaryAt_idx"
  ON "UnifiedExperimentalPhysiologyStateV2"("profileId", "boundaryAt");
CREATE INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_boundaryAt_idx"
  ON "UnifiedExperimentalPhysiologyStateV2"("profileId", "modelEpisodeId", "boundaryAt");
CREATE INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevision_updatedAt_idx"
  ON "UnifiedExperimentalPhysiologyStateV2"("profileId", "modelRevision", "updatedAt");
CREATE INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatus_boundaryAt_idx"
  ON "UnifiedExperimentalPhysiologyStateV2"("profileId", "qualityStatus", "boundaryAt");
CREATE INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_resultFingerprint_idx"
  ON "UnifiedExperimentalPhysiologyStateV2"("profileId", "resultFingerprint");
