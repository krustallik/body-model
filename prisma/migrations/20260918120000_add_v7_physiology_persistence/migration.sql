CREATE TABLE "PhysiologyV7DailyResult" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "date" VARCHAR(10) NOT NULL,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "priorStateFingerprint" VARCHAR(64) NOT NULL,
    "resultFingerprint" VARCHAR(64) NOT NULL,
    "stateVersion" VARCHAR(100) NOT NULL,
    "dailyRuntimeVersion" VARCHAR(100) NOT NULL,
    "rangeRebuildVersion" VARCHAR(100) NOT NULL,
    "rebuildServiceVersion" VARCHAR(100) NOT NULL,
    "sourceNormalizationVersion" VARCHAR(100) NOT NULL,
    "result" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PhysiologyV7DailyResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PhysiologyV7Lifecycle" (
    "profileId" INTEGER NOT NULL,
    "staleFromDate" VARCHAR(10),
    "invalidationGeneration" INTEGER NOT NULL DEFAULT 0,
    "currentThroughDate" VARCHAR(10),
    "stateVersion" VARCHAR(100) NOT NULL,
    "sourceNormalizationVersion" VARCHAR(100) NOT NULL,
    "dailyRuntimeVersion" VARCHAR(100) NOT NULL,
    "rangeRebuildVersion" VARCHAR(100) NOT NULL,
    "rebuildServiceVersion" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PhysiologyV7Lifecycle_pkey" PRIMARY KEY ("profileId")
);

CREATE UNIQUE INDEX "PhysiologyV7DailyResult_profileId_date_key"
ON "PhysiologyV7DailyResult"("profileId", "date");
CREATE INDEX "PhysiologyV7DailyResult_profileId_date_idx"
ON "PhysiologyV7DailyResult"("profileId", "date");
CREATE INDEX "PhysiologyV7DailyResult_profileId_resultFingerprint_idx"
ON "PhysiologyV7DailyResult"("profileId", "resultFingerprint");
CREATE INDEX "PhysiologyV7Lifecycle_staleFromDate_idx"
ON "PhysiologyV7Lifecycle"("staleFromDate");

-- Atomically merge a source mutation into the earliest-stale watermark.
CREATE FUNCTION physiology_v7_invalidate(p_profile_id INTEGER, p_date VARCHAR(10))
RETURNS VOID AS $$
BEGIN
  IF p_date IS NULL THEN RETURN; END IF;
  INSERT INTO "PhysiologyV7Lifecycle" (
    "profileId", "staleFromDate", "invalidationGeneration",
    "stateVersion", "sourceNormalizationVersion", "dailyRuntimeVersion",
    "rangeRebuildVersion", "rebuildServiceVersion", "updatedAt"
  ) VALUES (
    p_profile_id, p_date, 1,
    'bodycast-physiology-v7-state-v3',
    'bodycast-v7-source-normalization-1',
    'bodycast-physiology-daily-runtime-v7-1',
    'bodycast-physiology-range-rebuild-v7-1',
    'bodycast-physiology-v7-rebuild-service-1', CURRENT_TIMESTAMP
  )
  ON CONFLICT ("profileId") DO UPDATE SET
    "staleFromDate" = CASE
      WHEN "PhysiologyV7Lifecycle"."staleFromDate" IS NULL THEN EXCLUDED."staleFromDate"
      ELSE LEAST("PhysiologyV7Lifecycle"."staleFromDate", EXCLUDED."staleFromDate")
    END,
    "invalidationGeneration" = "PhysiologyV7Lifecycle"."invalidationGeneration" + 1,
    "updatedAt" = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION physiology_v7_daily_source_trigger()
RETURNS TRIGGER AS $$
DECLARE affected VARCHAR(10);
BEGIN
  affected := CASE
    WHEN TG_OP = 'INSERT' THEN NEW."date"
    WHEN TG_OP = 'DELETE' THEN OLD."date"
    ELSE LEAST(NEW."date", OLD."date")
  END;
  PERFORM physiology_v7_invalidate(1, affected);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DailyHealthData_v7_invalidate_insert_delete"
AFTER INSERT OR DELETE ON "DailyHealthData"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_daily_source_trigger();
CREATE TRIGGER "DailyHealthData_v7_invalidate_update"
AFTER UPDATE OF "date", "weightKg", "bodyFatPercent", "caloriesKcal", "proteinG", "fatG", "carbsG", "steps", "walkingDistanceKm", "workoutFeedObserved"
ON "DailyHealthData" FOR EACH ROW EXECUTE FUNCTION physiology_v7_daily_source_trigger();

CREATE FUNCTION physiology_v7_workout_source_trigger()
RETURNS TRIGGER AS $$
DECLARE old_date VARCHAR(10); new_date VARCHAR(10); affected VARCHAR(10);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT "date" INTO old_date FROM "DailyHealthData" WHERE "id" = OLD."dailyHealthDataId";
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT "date" INTO new_date FROM "DailyHealthData" WHERE "id" = NEW."dailyHealthDataId";
  END IF;
  affected := CASE WHEN old_date IS NULL THEN new_date WHEN new_date IS NULL THEN old_date ELSE LEAST(old_date, new_date) END;
  PERFORM physiology_v7_invalidate(1, affected);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Workout_v7_invalidate_insert_delete"
AFTER INSERT OR DELETE ON "Workout"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_workout_source_trigger();
CREATE TRIGGER "Workout_v7_invalidate_update"
AFTER UPDATE OF "dailyHealthDataId", "type", "startAt", "endAt", "durationMinutes"
ON "Workout" FOR EACH ROW EXECUTE FUNCTION physiology_v7_workout_source_trigger();

CREATE TRIGGER "HealthSyncSnapshot_v7_invalidate_insert_delete"
AFTER INSERT OR DELETE ON "HealthSyncSnapshot"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_daily_source_trigger();
CREATE TRIGGER "HealthSyncSnapshot_v7_invalidate_update"
AFTER UPDATE OF "date", "receivedAt", "syncedAt", "steps"
ON "HealthSyncSnapshot" FOR EACH ROW EXECUTE FUNCTION physiology_v7_daily_source_trigger();

CREATE FUNCTION physiology_v7_training_date(p_session_id INTEGER)
RETURNS VARCHAR(10) AS $$
DECLARE affected VARCHAR(10);
BEGIN
  SELECT d."date" INTO affected
  FROM "StrengthDiarySession" s
  LEFT JOIN "Workout" w ON w."id" = s."matchedWorkoutId"
  LEFT JOIN "DailyHealthData" d ON d."id" = w."dailyHealthDataId"
  WHERE s."id" = p_session_id;
  IF affected IS NULL THEN SELECT MIN("date") INTO affected FROM "DailyHealthData"; END IF;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION physiology_v7_workout_date(p_workout_id INTEGER)
RETURNS VARCHAR(10) AS $$
DECLARE affected VARCHAR(10);
BEGIN
  SELECT d."date" INTO affected FROM "Workout" w
  JOIN "DailyHealthData" d ON d."id" = w."dailyHealthDataId"
  WHERE w."id" = p_workout_id;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION physiology_v7_session_source_trigger()
RETURNS TRIGGER AS $$
DECLARE old_date VARCHAR(10); new_date VARCHAR(10); affected VARCHAR(10); pid INTEGER;
BEGIN
  pid := COALESCE(NEW."profileId", OLD."profileId", 1);
  IF TG_OP <> 'INSERT' THEN old_date := physiology_v7_workout_date(OLD."matchedWorkoutId"); END IF;
  IF TG_OP <> 'DELETE' THEN new_date := physiology_v7_workout_date(NEW."matchedWorkoutId"); END IF;
  IF old_date IS NULL AND TG_OP <> 'INSERT' THEN SELECT MIN("date") INTO old_date FROM "DailyHealthData"; END IF;
  IF new_date IS NULL AND TG_OP <> 'DELETE' THEN SELECT MIN("date") INTO new_date FROM "DailyHealthData"; END IF;
  affected := CASE WHEN old_date IS NULL THEN new_date WHEN new_date IS NULL THEN old_date ELSE LEAST(old_date, new_date) END;
  PERFORM physiology_v7_invalidate(pid, affected);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StrengthDiarySession_v7_invalidate"
AFTER INSERT OR UPDATE OR DELETE ON "StrengthDiarySession"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_source_trigger();

CREATE FUNCTION physiology_v7_session_child_source_trigger()
RETURNS TRIGGER AS $$
DECLARE sid INTEGER; affected VARCHAR(10); pid INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'StrengthSessionExercise' THEN
    sid := COALESCE(NEW."sessionId", OLD."sessionId");
  ELSE
    SELECT "sessionId" INTO sid FROM "StrengthSessionExercise"
    WHERE "id" = COALESCE(NEW."sessionExerciseId", OLD."sessionExerciseId");
  END IF;
  SELECT "profileId" INTO pid FROM "StrengthDiarySession" WHERE "id" = sid;
  affected := physiology_v7_training_date(sid);
  PERFORM physiology_v7_invalidate(COALESCE(pid, 1), affected);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StrengthSessionExercise_v7_invalidate"
AFTER INSERT OR UPDATE OR DELETE ON "StrengthSessionExercise"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_child_source_trigger();
CREATE TRIGGER "StrengthSet_v7_invalidate"
AFTER INSERT OR UPDATE OR DELETE ON "StrengthSet"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_child_source_trigger();
