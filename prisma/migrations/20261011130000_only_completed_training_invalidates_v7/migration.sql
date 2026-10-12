CREATE OR REPLACE FUNCTION physiology_v7_model_date(p_profile_id INTEGER, p_event_at TIMESTAMPTZ)
RETURNS VARCHAR(10) AS $$
DECLARE
  affected VARCHAR(10);
  active_count INTEGER;
  active_start TIMESTAMPTZ;
  active_is_last BOOLEAN;
  invalid_boundary_count INTEGER;
  final_episode_active BOOLEAN;
  final_episode_start TIMESTAMPTZ;
  final_episode_end TIMESTAMPTZ;
BEGIN
  IF p_event_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO invalid_boundary_count
  FROM "ModelEpisode" e
  WHERE e."profileId" = p_profile_id
    AND to_char(
      (e."startDate"::timestamp AT TIME ZONE e."timezone") AT TIME ZONE e."timezone",
      'YYYY-MM-DD HH24:MI:SS'
    ) <> e."startDate" || ' 00:00:00';
  IF invalid_boundary_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ModelEpisode start boundary does not round-trip in its timezone';
  END IF;

  SELECT COUNT(*) INTO active_count FROM "ModelEpisode" WHERE "profileId" = p_profile_id AND "active";
  IF active_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ModelEpisode active partition is ambiguous';
  END IF;

  SELECT "startDate"::timestamp AT TIME ZONE "timezone" INTO active_start
  FROM "ModelEpisode" WHERE "profileId" = p_profile_id AND "active";

  WITH effective_boundaries AS (
    SELECT e."id", e."active", e."deactivatedAt",
      e."startDate"::timestamp AT TIME ZONE e."timezone" AS "startInstant"
    FROM "ModelEpisode" e
    WHERE e."profileId" = p_profile_id
      AND (e."active" OR active_start IS NULL
        OR e."startDate"::timestamp AT TIME ZONE e."timezone" <= active_start)
  ), ordered_boundaries AS (
    SELECT *,
      LEAD("startInstant") OVER (ORDER BY "startInstant" ASC, "id" ASC) AS "nextStartInstant",
      ROW_NUMBER() OVER (ORDER BY "startInstant" DESC, "id" DESC) AS reverse_position
    FROM effective_boundaries
  )
  SELECT "active", "startInstant", "deactivatedAt"
  INTO final_episode_active, final_episode_start, final_episode_end
  FROM ordered_boundaries WHERE reverse_position = 1;

  IF final_episode_active IS FALSE
      AND (final_episode_end IS NULL OR final_episode_end <= final_episode_start) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Last inactive ModelEpisode has no valid upper boundary';
  END IF;

  SELECT "active" INTO active_is_last
  FROM (
    SELECT e."active", ROW_NUMBER() OVER (
      ORDER BY e."startDate"::timestamp AT TIME ZONE e."timezone" DESC, e."id" DESC
    ) AS reverse_position
    FROM "ModelEpisode" e
    WHERE e."profileId" = p_profile_id
      AND (e."active" OR active_start IS NULL
        OR e."startDate"::timestamp AT TIME ZONE e."timezone" <= active_start)
  ) effective
  WHERE reverse_position = 1;
  IF active_start IS NOT NULL AND active_is_last IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Active ModelEpisode partition is ambiguous';
  END IF;

  WITH episode_boundaries AS (
    SELECT
      e."id",
      e."startDate",
      e."timezone",
      e."active",
      e."deactivatedAt",
      e."startDate"::timestamp AT TIME ZONE e."timezone" AS "startInstant"
    FROM "ModelEpisode" e
    WHERE e."profileId" = p_profile_id
  ), effective_boundaries AS (
    SELECT * FROM episode_boundaries
    WHERE "active" OR active_start IS NULL OR "startInstant" <= active_start
  ), ordered_boundaries AS (
    SELECT *, LEAD("startInstant") OVER (ORDER BY "startInstant" ASC, "id" ASC) AS "nextStartInstant"
    FROM effective_boundaries
  )
  SELECT to_char(p_event_at AT TIME ZONE "timezone", 'YYYY-MM-DD') INTO affected
  FROM ordered_boundaries
  WHERE p_event_at >= "startInstant"
    AND ("nextStartInstant" IS NOT NULL AND p_event_at < "nextStartInstant"
      OR "nextStartInstant" IS NULL AND ("active" OR p_event_at < "deactivatedAt"))
    AND to_char(p_event_at AT TIME ZONE "timezone", 'YYYY-MM-DD') >= "startDate"
  ORDER BY "startInstant" DESC, "id" DESC
  LIMIT 1;

  IF affected IS NULL THEN
    affected := to_char(p_event_at AT TIME ZONE 'Europe/Bratislava', 'YYYY-MM-DD');
  END IF;
  RETURN affected;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION physiology_v7_training_model_date(
  p_profile_id INTEGER,
  p_matched_workout_id INTEGER,
  p_effective_accounting_at TIMESTAMPTZ,
  p_web_started_at TIMESTAMPTZ,
  p_created_at TIMESTAMPTZ
)
RETURNS VARCHAR(10) AS $$
DECLARE
  event_at TIMESTAMPTZ;
  workout_date VARCHAR(10);
  event_date VARCHAR(10);
BEGIN
  IF p_matched_workout_id IS NOT NULL THEN
    SELECT d."date", w."startAt" AT TIME ZONE 'UTC'
    INTO workout_date, event_at
    FROM "Workout" w
    JOIN "DailyHealthData" d ON d."id" = w."dailyHealthDataId"
    WHERE w."id" = p_matched_workout_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Matched workout or its daily source row is missing';
    END IF;
    event_date := physiology_v7_model_date(p_profile_id, event_at);
    RETURN CASE
      WHEN workout_date IS NULL THEN event_date
      WHEN event_date IS NULL THEN workout_date
      ELSE LEAST(workout_date, event_date)
    END;
  END IF;

  event_at := COALESCE(event_at, p_effective_accounting_at, p_web_started_at, p_created_at);
  RETURN physiology_v7_model_date(p_profile_id, event_at);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION physiology_v7_matched_workout_source_trigger()
RETURNS TRIGGER AS $$
DECLARE
  pid INTEGER;
  old_date VARCHAR(10);
  new_date VARCHAR(10);
  affected VARCHAR(10);
BEGIN
  IF OLD."startAt" IS NOT DISTINCT FROM NEW."startAt" THEN
    RETURN NEW;
  END IF;

  FOR pid IN
    SELECT DISTINCT s."profileId"
    FROM "StrengthDiarySession" s
    WHERE s."matchedWorkoutId" = OLD."id" AND s."status" = 'COMPLETED'
  LOOP
    old_date := physiology_v7_model_date(pid, OLD."startAt" AT TIME ZONE 'UTC');
    new_date := physiology_v7_model_date(pid, NEW."startAt" AT TIME ZONE 'UTC');
    affected := CASE
      WHEN old_date IS NULL THEN new_date
      WHEN new_date IS NULL THEN old_date
      ELSE LEAST(old_date, new_date)
    END;
    PERFORM physiology_v7_invalidate(pid, affected);
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION physiology_v7_matched_workout_delete_trigger()
RETURNS TRIGGER AS $$
DECLARE
  pid INTEGER;
  affected VARCHAR(10);
BEGIN
  FOR pid IN
    SELECT DISTINCT s."profileId"
    FROM "StrengthDiarySession" s
    WHERE s."matchedWorkoutId" = OLD."id" AND s."status" = 'COMPLETED'
  LOOP
    affected := physiology_v7_model_date(pid, OLD."startAt" AT TIME ZONE 'UTC');
    PERFORM physiology_v7_invalidate(pid, affected);
  END LOOP;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION physiology_v7_training_date(p_session_id INTEGER)
RETURNS VARCHAR(10) AS $$
DECLARE
  affected VARCHAR(10);
BEGIN
  SELECT physiology_v7_training_model_date(
    s."profileId", s."matchedWorkoutId", s."effectiveAccountingAt", s."webStartedAt", s."createdAt"
  ) INTO affected
  FROM "StrengthDiarySession" s
  WHERE s."id" = p_session_id;
  RETURN affected;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION physiology_v7_session_source_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_date VARCHAR(10);
  new_date VARCHAR(10);
  affected VARCHAR(10);
  pid INTEGER;
  old_completed BOOLEAN := false;
  new_completed BOOLEAN := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_completed := OLD."status" = 'COMPLETED'; END IF;
  IF TG_OP <> 'DELETE' THEN new_completed := NEW."status" = 'COMPLETED'; END IF;
  IF NOT old_completed AND NOT new_completed THEN RETURN COALESCE(NEW, OLD); END IF;

  pid := COALESCE(NEW."profileId", OLD."profileId", 1);
  IF old_completed AND TG_OP <> 'INSERT' THEN
    IF TG_OP = 'UPDATE'
        AND OLD."matchedWorkoutId" IS NOT NULL
        AND NEW."matchedWorkoutId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Workout" WHERE "id" = OLD."matchedWorkoutId") THEN
      -- The FK-driven SET NULL after Workout deletion has already been fenced
      -- by Workout's BEFORE DELETE trigger; the old row no longer exists here.
      old_date := NULL;
    ELSE
      old_date := physiology_v7_training_model_date(
        OLD."profileId", OLD."matchedWorkoutId", OLD."effectiveAccountingAt", OLD."webStartedAt", OLD."createdAt"
      );
    END IF;
  END IF;
  IF new_completed AND TG_OP <> 'DELETE' THEN
    new_date := physiology_v7_training_model_date(
      NEW."profileId", NEW."matchedWorkoutId", NEW."effectiveAccountingAt", NEW."webStartedAt", NEW."createdAt"
    );
  END IF;
  affected := CASE WHEN old_date IS NULL THEN new_date WHEN new_date IS NULL THEN old_date ELSE LEAST(old_date, new_date) END;
  PERFORM physiology_v7_invalidate(pid, affected);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION physiology_v7_session_child_source_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_sid INTEGER;
  new_sid INTEGER;
  candidate_sid INTEGER;
  affected VARCHAR(10);
  pid INTEGER;
  session_status VARCHAR(20);
BEGIN
  IF TG_TABLE_NAME = 'StrengthSessionExercise' THEN
    IF TG_OP <> 'INSERT' THEN old_sid := OLD."sessionId"; END IF;
    IF TG_OP <> 'DELETE' THEN new_sid := NEW."sessionId"; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      SELECT "sessionId" INTO old_sid FROM "StrengthSessionExercise"
      WHERE "id" = OLD."sessionExerciseId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "sessionId" INTO new_sid FROM "StrengthSessionExercise"
      WHERE "id" = NEW."sessionExerciseId";
    END IF;
  END IF;
  -- An UPDATE can move an exercise/set between sessions. Both the old and new
  -- completed source may have changed, so fence every distinct parent.
  FOR candidate_sid IN
    SELECT DISTINCT candidate
    FROM unnest(ARRAY[old_sid, new_sid]) AS candidates(candidate)
    WHERE candidate IS NOT NULL
  LOOP
    SELECT "profileId", "status" INTO pid, session_status
    FROM "StrengthDiarySession" WHERE "id" = candidate_sid;
    IF session_status = 'COMPLETED' THEN
      affected := physiology_v7_training_date(candidate_sid);
      PERFORM physiology_v7_invalidate(COALESCE(pid, 1), affected);
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Workout_v7_invalidate"
AFTER UPDATE OF "startAt" ON "Workout"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_matched_workout_source_trigger();

CREATE TRIGGER "Workout_v7_invalidate_matched_delete"
BEFORE DELETE ON "Workout"
FOR EACH ROW EXECUTE FUNCTION physiology_v7_matched_workout_delete_trigger();
