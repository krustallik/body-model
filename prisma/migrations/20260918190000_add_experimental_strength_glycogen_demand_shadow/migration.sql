CREATE TABLE "ExperimentalStrengthGlycogenDemandShadow" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "modelRevision" VARCHAR(100) NOT NULL,
    "features" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ExperimentalStrengthGlycogenDemandShadow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentalStrengthGlycogenDemandShadow_sessionId_key"
ON "ExperimentalStrengthGlycogenDemandShadow"("sessionId");
CREATE INDEX "ExperimentalStrengthGlycogenDemandShadow_profileId_updatedAt_idx"
ON "ExperimentalStrengthGlycogenDemandShadow"("profileId", "updatedAt");

ALTER TABLE "ExperimentalStrengthGlycogenDemandShadow"
ADD CONSTRAINT "ExperimentalStrengthGlycogenDemandShadow_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "StrengthDiarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
