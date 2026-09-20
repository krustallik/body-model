CREATE TABLE "HealthMetricSample" (
    "id" SERIAL NOT NULL,
    "dailyHealthDataId" INTEGER,
    "date" VARCHAR(10) NOT NULL,
    "metric" VARCHAR(64) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "value" DECIMAL(18,10) NOT NULL,
    "sourceFingerprint" VARCHAR(250) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthMetricSample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HealthMetricSample_sourceFingerprint_key" ON "HealthMetricSample"("sourceFingerprint");
CREATE INDEX "HealthMetricSample_date_metric_timestamp_idx" ON "HealthMetricSample"("date", "metric", "timestamp");
CREATE INDEX "HealthMetricSample_dailyHealthDataId_idx" ON "HealthMetricSample"("dailyHealthDataId");

ALTER TABLE "HealthMetricSample"
  ADD CONSTRAINT "HealthMetricSample_dailyHealthDataId_fkey"
  FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
