CREATE TABLE "ExperimentalGlycogenStateShadow" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "date" VARCHAR(10) NOT NULL,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "modelRevision" VARCHAR(100) NOT NULL,
    "features" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ExperimentalGlycogenStateShadow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentalGlycogenStateShadow_profileId_date_key"
ON "ExperimentalGlycogenStateShadow"("profileId", "date");
CREATE INDEX "ExperimentalGlycogenStateShadow_profileId_updatedAt_idx"
ON "ExperimentalGlycogenStateShadow"("profileId", "updatedAt");
