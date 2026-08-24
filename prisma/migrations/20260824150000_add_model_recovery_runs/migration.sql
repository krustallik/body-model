CREATE TABLE "ModelRecoveryRun" (
    "id" SERIAL NOT NULL,
    "episodeId" INTEGER NOT NULL,
    "algorithmVersion" VARCHAR(100) NOT NULL,
    "seed" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "configFingerprint" VARCHAR(64) NOT NULL,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "firstUnknownDate" VARCHAR(10) NOT NULL,
    "latestRecoveredDate" VARCHAR(10) NOT NULL,
    "observationCount" INTEGER NOT NULL,
    "generatedParticleCount" INTEGER NOT NULL,
    "validParticleCount" INTEGER NOT NULL,
    "invalidParticleCount" INTEGER NOT NULL,
    "effectiveSampleSize" DOUBLE PRECISION NOT NULL,
    "normalizedEffectiveSampleSize" DOUBLE PRECISION NOT NULL,
    "maximumWeight" DOUBLE PRECISION NOT NULL,
    "diagnostics" JSONB NOT NULL,
    "posteriorSummary" JSONB NOT NULL,
    "ensemble" JSONB NOT NULL,
    "staleAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ModelRecoveryRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelRecoveryRun_episodeId_algorithmVersion_seed_configFingerpr_key"
ON "ModelRecoveryRun"("episodeId", "algorithmVersion", "seed", "configFingerprint", "sourceFingerprint");

CREATE INDEX "ModelRecoveryRun_episodeId_staleAt_updatedAt_idx"
ON "ModelRecoveryRun"("episodeId", "staleAt", "updatedAt");

CREATE INDEX "ModelRecoveryRun_episodeId_status_idx"
ON "ModelRecoveryRun"("episodeId", "status");

ALTER TABLE "ModelRecoveryRun" ADD CONSTRAINT "ModelRecoveryRun_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "ModelEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
