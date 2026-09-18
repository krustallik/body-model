CREATE TABLE "ExperimentalLocalHypertrophyResponseShadow" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "weekStartDate" VARCHAR(10) NOT NULL,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "modelRevision" VARCHAR(100) NOT NULL,
    "features" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ExperimentalLocalHypertrophyResponseShadow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentalLocalHypertrophyResponseShadow_profileId_weekStartDate_key"
ON "ExperimentalLocalHypertrophyResponseShadow"("profileId", "weekStartDate");
CREATE INDEX "ExperimentalLocalHypertrophyResponseShadow_profileId_updatedAt_idx"
ON "ExperimentalLocalHypertrophyResponseShadow"("profileId", "updatedAt");
