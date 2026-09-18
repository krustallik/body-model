CREATE TABLE "ExperimentalStrengthEnergyShadow" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "modelRevision" VARCHAR(100) NOT NULL,
    "features" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ExperimentalStrengthEnergyShadow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentalStrengthEnergyShadow_sessionId_key"
ON "ExperimentalStrengthEnergyShadow"("sessionId");
CREATE INDEX "ExperimentalStrengthEnergyShadow_profileId_updatedAt_idx"
ON "ExperimentalStrengthEnergyShadow"("profileId", "updatedAt");

ALTER TABLE "ExperimentalStrengthEnergyShadow"
ADD CONSTRAINT "ExperimentalStrengthEnergyShadow_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "StrengthDiarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
