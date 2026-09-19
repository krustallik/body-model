CREATE TABLE "HealthActivityInterval" (
    "id" SERIAL NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "metric" VARCHAR(32) NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "value" DECIMAL(16,8) NOT NULL,
    "sourceFingerprint" VARCHAR(180) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HealthActivityInterval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HealthActivityInterval_sourceFingerprint_key"
ON "HealthActivityInterval"("sourceFingerprint");

CREATE INDEX "HealthActivityInterval_metric_date_startAt_idx"
ON "HealthActivityInterval"("metric", "date", "startAt");

CREATE INDEX "HealthActivityInterval_metric_startAt_endAt_idx"
ON "HealthActivityInterval"("metric", "startAt", "endAt");
