CREATE TABLE "PhysiologyV7ShadowDiagnostic" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "date" VARCHAR(10) NOT NULL,
    "productionEpisodeId" INTEGER,
    "productionModelVersion" VARCHAR(100),
    "productionOutput" JSONB NOT NULL,
    "v7Status" VARCHAR(20) NOT NULL,
    "v7ResultFingerprint" VARCHAR(64),
    "v7Versions" JSONB NOT NULL,
    "v7Projection" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "runtimeDurationMs" INTEGER NOT NULL,
    "executionStatus" VARCHAR(20) NOT NULL,
    "errorCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PhysiologyV7ShadowDiagnostic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PhysiologyV7ShadowDiagnostic_profileId_date_key" ON "PhysiologyV7ShadowDiagnostic"("profileId", "date");
CREATE INDEX "PhysiologyV7ShadowDiagnostic_profileId_updatedAt_idx" ON "PhysiologyV7ShadowDiagnostic"("profileId", "updatedAt");
CREATE INDEX "PhysiologyV7ShadowDiagnostic_executionStatus_updatedAt_idx" ON "PhysiologyV7ShadowDiagnostic"("executionStatus", "updatedAt");
