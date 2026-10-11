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
  IF TG_OP <> 'INSERT' THEN old_date := physiology_v7_workout_date(OLD."matchedWorkoutId"); END IF;
  IF TG_OP <> 'DELETE' THEN new_date := physiology_v7_workout_date(NEW."matchedWorkoutId"); END IF;
  IF old_date IS NULL AND TG_OP <> 'INSERT' THEN SELECT MIN("date") INTO old_date FROM "DailyHealthData"; END IF;
  IF new_date IS NULL AND TG_OP <> 'DELETE' THEN SELECT MIN("date") INTO new_date FROM "DailyHealthData"; END IF;
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
