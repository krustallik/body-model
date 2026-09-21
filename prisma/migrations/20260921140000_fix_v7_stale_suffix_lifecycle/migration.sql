-- A source correction invalidates every dependent result.  Do not retain a
-- current-through watermark beyond that source until the suffix is replayed.
CREATE OR REPLACE FUNCTION physiology_v7_invalidate(p_profile_id INTEGER, p_date VARCHAR(10))
RETURNS VOID AS $$
BEGIN
  IF p_date IS NULL THEN RETURN; END IF;
  INSERT INTO "PhysiologyV7Lifecycle" (
    "profileId", "staleFromDate", "invalidationGeneration",
    "stateVersion", "sourceNormalizationVersion", "dailyRuntimeVersion",
    "rangeRebuildVersion", "rebuildServiceVersion", "updatedAt"
  ) VALUES (
    p_profile_id, p_date, 1,
    'bodycast-physiology-v7-state-v3', 'bodycast-v7-source-normalization-1',
    'bodycast-physiology-daily-runtime-v7-1', 'bodycast-physiology-range-rebuild-v7-1',
    'bodycast-physiology-v7-rebuild-service-1', CURRENT_TIMESTAMP
  ) ON CONFLICT ("profileId") DO UPDATE SET
    "staleFromDate" = CASE
      WHEN "PhysiologyV7Lifecycle"."staleFromDate" IS NULL THEN EXCLUDED."staleFromDate"
      ELSE LEAST("PhysiologyV7Lifecycle"."staleFromDate", EXCLUDED."staleFromDate")
    END,
    "currentThroughDate" = CASE
      WHEN "PhysiologyV7Lifecycle"."currentThroughDate" >= EXCLUDED."staleFromDate"
        THEN to_char((EXCLUDED."staleFromDate"::date - INTERVAL '1 day'), 'YYYY-MM-DD')
      ELSE "PhysiologyV7Lifecycle"."currentThroughDate"
    END,
    "invalidationGeneration" = "PhysiologyV7Lifecycle"."invalidationGeneration" + 1,
    "updatedAt" = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;
