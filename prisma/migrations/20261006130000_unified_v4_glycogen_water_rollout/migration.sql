ALTER TABLE "PhysiologyV7Lifecycle"
  ADD COLUMN "unifiedTargetRevision" VARCHAR(100) NOT NULL
    DEFAULT 'unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics',
  ADD COLUMN "unifiedRolloutEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unifiedPublishedRolloutEpoch" INTEGER;

ALTER TABLE "PhysiologyV7Lifecycle"
  ADD CONSTRAINT "PhysiologyV7Lifecycle_unifiedTargetRevision_supported"
    CHECK ("unifiedTargetRevision" IN (
      'unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics',
      'unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once'
    )),
  ADD CONSTRAINT "PhysiologyV7Lifecycle_unifiedRolloutEpoch_nonnegative"
    CHECK ("unifiedRolloutEpoch" >= 0);
