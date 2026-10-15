CREATE TABLE "HealthSyncRefreshJob" (
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "requestedGeneration" INTEGER NOT NULL DEFAULT 0,
    "completedGeneration" INTEGER NOT NULL DEFAULT 0,
    "fromDate" VARCHAR(10),
    "toDate" VARCHAR(10),
    "sourceDates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "weightSourceChangedDates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "leaseToken" VARCHAR(36),
    "leaseUntil" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastErrorType" VARCHAR(100),
    "lastErrorAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HealthSyncRefreshJob_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT "HealthSyncRefreshJob_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "Profile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx"
ON "HealthSyncRefreshJob"("nextAttemptAt", "leaseUntil");
