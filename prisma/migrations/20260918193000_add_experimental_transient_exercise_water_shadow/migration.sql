CREATE TABLE "ExperimentalTransientExerciseWaterShadow" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "modelRevision" VARCHAR(100) NOT NULL,
    "features" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ExperimentalTransientExerciseWaterShadow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentalTransientExerciseWaterShadow_sessionId_key"
ON "ExperimentalTransientExerciseWaterShadow"("sessionId");
CREATE INDEX "ExperimentalTransientExerciseWaterShadow_profileId_updatedAt_idx"
ON "ExperimentalTransientExerciseWaterShadow"("profileId", "updatedAt");

ALTER TABLE "ExperimentalTransientExerciseWaterShadow"
ADD CONSTRAINT "ExperimentalTransientExerciseWaterShadow_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "StrengthDiarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
