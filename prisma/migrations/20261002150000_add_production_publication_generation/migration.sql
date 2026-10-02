-- Extend the existing profile lifecycle with currentness pointers for the
-- production replay and Unified publication. NULL pointers intentionally make
-- pre-existing materializations non-current until the application rebuilds.
ALTER TABLE "PhysiologyV7Lifecycle"
  ADD COLUMN "productionStaleFromDate" VARCHAR(10),
  ADD COLUMN "productionPublishedGeneration" INTEGER,
  ADD COLUMN "unifiedPublishedGeneration" INTEGER;

CREATE INDEX "PhysiologyV7Lifecycle_productionStaleFromDate_idx"
  ON "PhysiologyV7Lifecycle"("productionStaleFromDate");

ALTER TABLE "DailyModelState"
  ADD COLUMN "weightFilterVarianceKg2" DOUBLE PRECISION;
