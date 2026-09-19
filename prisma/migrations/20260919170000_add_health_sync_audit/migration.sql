CREATE TABLE "HealthSyncAudit" (
    "id" SERIAL NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" VARCHAR(64) NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "rawBody" TEXT,
    "contentType" VARCHAR(200),
    "errorType" VARCHAR(100),
    CONSTRAINT "HealthSyncAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HealthSyncAudit_receivedAt_idx" ON "HealthSyncAudit"("receivedAt");
CREATE INDEX "HealthSyncAudit_outcome_receivedAt_idx" ON "HealthSyncAudit"("outcome", "receivedAt");
