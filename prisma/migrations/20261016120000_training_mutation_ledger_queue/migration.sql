BEGIN;

CREATE TABLE "TrainingRefreshJob" (
    "profileId" INTEGER NOT NULL,
    "requestedGeneration" INTEGER NOT NULL DEFAULT 0,
    "completedGeneration" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMPTZ(3),
    "dirtyFromDate" VARCHAR(10),
    "dirtyToDate" VARCHAR(10),
    "affectedSessionIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "leaseToken" VARCHAR(36),
    "leaseUntil" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastErrorType" VARCHAR(100),
    "lastErrorAt" TIMESTAMPTZ(3),
    "lastProgressStage" VARCHAR(80),
    "lastProgressAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingRefreshJob_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT "TrainingRefreshJob_profileId_fkey" FOREIGN KEY ("profileId")
      REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingRefreshJob_generation_check" CHECK (
      "requestedGeneration" >= 0 AND "completedGeneration" >= 0
      AND "completedGeneration" <= "requestedGeneration"
    ),
    CONSTRAINT "TrainingRefreshJob_attemptCount_check" CHECK ("attemptCount" >= 0)
);

CREATE INDEX "TrainingRefreshJob_dueAt_nextAttemptAt_leaseUntil_idx"
  ON "TrainingRefreshJob"("dueAt", "nextAttemptAt", "leaseUntil");
CREATE INDEX "TrainingRefreshJob_requestedGeneration_completedGeneration_idx"
  ON "TrainingRefreshJob"("requestedGeneration", "completedGeneration");

CREATE TABLE "TrainingSourceChange" (
    "sourceChangeId" VARCHAR(36) NOT NULL,
    "profileId" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "operationKind" VARCHAR(50) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "evidenceComplete" BOOLEAN NOT NULL DEFAULT TRUE,
    "affectedSessionIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "affectedExerciseIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "affectedSetIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "oldSourceIdentity" JSONB,
    "newSourceIdentity" JSONB,
    "oldEventInstants" JSONB,
    "newEventInstants" JSONB,
    "oldModelDates" VARCHAR(10)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(10)[],
    "newModelDates" VARCHAR(10)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(10)[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(3),
    CONSTRAINT "TrainingSourceChange_pkey" PRIMARY KEY ("sourceChangeId"),
    CONSTRAINT "TrainingSourceChange_profileId_fkey" FOREIGN KEY ("profileId")
      REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrainingSourceChange_generation_check" CHECK ("generation" > 0),
    CONSTRAINT "TrainingSourceChange_schemaVersion_check" CHECK ("schemaVersion" > 0)
);

CREATE INDEX "TrainingSourceChange_profileId_generation_acknowledgedAt_idx"
  ON "TrainingSourceChange"("profileId", "generation", "acknowledgedAt");
CREATE INDEX "TrainingSourceChange_profileId_createdAt_idx"
  ON "TrainingSourceChange"("profileId", "createdAt");

CREATE TABLE "TrainingSetCreateOperation" (
    "profileId" INTEGER NOT NULL,
    "operationId" VARCHAR(36) NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "payloadDigest" VARCHAR(64) NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "canonicalSetId" INTEGER,
    "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingSetCreateOperation_pkey" PRIMARY KEY ("profileId", "operationId"),
    CONSTRAINT "TrainingSetCreateOperation_profileId_fkey" FOREIGN KEY ("profileId")
      REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrainingSetCreateOperation_state_check" CHECK ("state" IN ('PENDING', 'COMMITTED', 'TOMBSTONED')),
    CONSTRAINT "TrainingSetCreateOperation_payloadVersion_check" CHECK ("payloadVersion" = 1),
    CONSTRAINT "TrainingSetCreateOperation_target_check" CHECK ("sessionId" > 0 AND "exerciseId" > 0),
    CONSTRAINT "TrainingSetCreateOperation_result_check" CHECK (
      ("state" = 'PENDING' AND "canonicalSetId" IS NULL)
      OR ("state" IN ('COMMITTED', 'TOMBSTONED') AND "canonicalSetId" IS NOT NULL)
    )
);

CREATE INDEX "TrainingSetCreateOperation_profileId_sessionId_state_idx"
  ON "TrainingSetCreateOperation"("profileId", "sessionId", "state");
CREATE INDEX "TrainingSetCreateOperation_profileId_canonicalSetId_idx"
  ON "TrainingSetCreateOperation"("profileId", "canonicalSetId");

COMMIT;
