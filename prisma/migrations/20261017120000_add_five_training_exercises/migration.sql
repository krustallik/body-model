-- Add five supported Training exercises without rewriting existing catalog or history.
-- Resolve by key or exact name and fail on conflicting identities instead of
-- creating a second row. The profile/key unique index is the serialization guard.
DO $$
DECLARE
  exercise RECORD;
  catalog_by_key_id INTEGER;
  catalog_by_key_name VARCHAR(200);
  catalog_by_name_id INTEGER;
  catalog_by_name_key VARCHAR(80);
BEGIN
  FOR exercise IN
    SELECT * FROM (VALUES
      ('bulgarian_split_squat', 'Болгарські присідання з упором задньої ноги на лаву'),
      ('forward_dumbbell_lunge', 'Випади вперед'),
      ('goblet_squat', 'Присідання з гантеллю в руках'),
      ('dumbbell_crunch', 'Прямі скручування з гантеллю на прес'),
      ('dumbbell_russian_twist', 'Бокові скручування з гантеллю на прес')
    ) AS supported("stableKey", "name")
  LOOP
    SELECT "id", "name"
      INTO catalog_by_key_id, catalog_by_key_name
      FROM "ExerciseCatalog"
     WHERE "profileId" = 1
       AND "stableKey" = exercise."stableKey";

    SELECT "id", "stableKey"
      INTO catalog_by_name_id, catalog_by_name_key
      FROM "ExerciseCatalog"
     WHERE "profileId" = 1
       AND "name" = exercise."name"
     FOR UPDATE;

    IF catalog_by_key_id IS NOT NULL THEN
      IF catalog_by_key_name <> exercise."name" THEN
        RAISE EXCEPTION 'ExerciseCatalog name conflict for canonical exercise %', exercise."stableKey";
      END IF;
      IF catalog_by_name_id IS NOT NULL AND catalog_by_name_id <> catalog_by_key_id THEN
        RAISE EXCEPTION 'ExerciseCatalog stableKey/name rows conflict for canonical exercise %', exercise."stableKey";
      END IF;
      UPDATE "ExerciseCatalog" SET "isActive" = TRUE WHERE "id" = catalog_by_key_id;
    ELSIF catalog_by_name_id IS NOT NULL THEN
      IF catalog_by_name_key IS NOT NULL AND catalog_by_name_key <> exercise."stableKey" THEN
        RAISE EXCEPTION 'ExerciseCatalog stableKey conflict for canonical exercise %', exercise."stableKey";
      END IF;
      -- Assigning a canonical identity changes how downstream model code
      -- interprets an exercise. Never silently re-key a legacy catalog row
      -- already referenced by a program or historical session; that needs an
      -- explicit source migration/replay, outside this catalog-only migration.
      IF EXISTS (
        SELECT 1 FROM "ProgramExercise" WHERE "exerciseCatalogId" = catalog_by_name_id
      ) OR EXISTS (
        SELECT 1 FROM "StrengthSessionExercise" WHERE "sourceExerciseCatalogId" = catalog_by_name_id
      ) THEN
        RAISE EXCEPTION 'ExerciseCatalog canonical identity migration requires an unreferenced legacy row for %', exercise."stableKey";
      END IF;
      UPDATE "ExerciseCatalog"
         SET "stableKey" = exercise."stableKey", "isActive" = TRUE
       WHERE "id" = catalog_by_name_id;
    ELSE
      INSERT INTO "ExerciseCatalog" ("profileId", "name", "stableKey", "isActive")
      VALUES (1, exercise."name", exercise."stableKey", TRUE);
    END IF;
  END LOOP;
END $$;
