CREATE TABLE "ExperimentalGlycogenRepletionShadow" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "date" VARCHAR(10) NOT NULL,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "modelRevision" VARCHAR(100) NOT NULL,
    "features" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ExperimentalGlycogenRepletionShadow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentalGlycogenRepletionShadow_profileId_date_key"
ON "ExperimentalGlycogenRepletionShadow"("profileId", "date");
CREATE INDEX "ExperimentalGlycogenRepletionShadow_profileId_updatedAt_idx"
ON "ExperimentalGlycogenRepletionShadow"("profileId", "updatedAt");
