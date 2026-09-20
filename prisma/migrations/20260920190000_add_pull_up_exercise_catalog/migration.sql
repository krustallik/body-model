-- Add the supported standard bodyweight pull-up without using its display name
-- for runtime/model resolution.  Keep a pre-existing portable-key conflict
-- explicit rather than silently assigning the canonical identity to it.
DO $$
DECLARE
  catalog_by_key_id INTEGER;
  catalog_by_key_name VARCHAR(200);
  catalog_by_name_id INTEGER;
  catalog_by_name_key VARCHAR(80);
BEGIN
  SELECT "id", "name"
    INTO catalog_by_key_id, catalog_by_key_name
    FROM "ExerciseCatalog"
   WHERE "profileId" = 1
     AND "stableKey" = 'pull_up';

  SELECT "id", "stableKey"
    INTO catalog_by_name_id, catalog_by_name_key
    FROM "ExerciseCatalog"
   WHERE "profileId" = 1
     AND "name" = 'Підтягування на перекладині';

  IF catalog_by_key_id IS NOT NULL THEN
    IF catalog_by_key_name <> 'Підтягування на перекладині' THEN
      RAISE EXCEPTION 'ExerciseCatalog name conflict for canonical pull_up exercise';
    END IF;

    IF catalog_by_name_id IS NOT NULL AND catalog_by_name_id <> catalog_by_key_id THEN
      RAISE EXCEPTION 'ExerciseCatalog pull_up stableKey/name conflict';
    END IF;

    UPDATE "ExerciseCatalog"
       SET "isActive" = TRUE
     WHERE "id" = catalog_by_key_id;
  ELSIF catalog_by_name_id IS NOT NULL THEN
    IF catalog_by_name_key IS NOT NULL AND catalog_by_name_key <> 'pull_up' THEN
      RAISE EXCEPTION 'ExerciseCatalog stableKey conflict for canonical pull_up exercise';
    END IF;

    UPDATE "ExerciseCatalog"
       SET "stableKey" = 'pull_up',
           "isActive" = TRUE
     WHERE "id" = catalog_by_name_id;
  ELSE
    INSERT INTO "ExerciseCatalog" ("profileId", "name", "stableKey", "isActive")
    VALUES (1, 'Підтягування на перекладині', 'pull_up', TRUE);
  END IF;
END $$;
