DROP INDEX "HealthMetricSample_sourceFingerprint_key";

ALTER TABLE "HealthMetricSample"
  DROP COLUMN "sourceFingerprint";

CREATE UNIQUE INDEX "HealthMetricSample_metric_timestamp_key"
  ON "HealthMetricSample"("metric", "timestamp");
