-- Portable model identity. Nullable by design: custom catalog rows are not
-- automatically mapped and remain identity-unavailable to v7 model code.
ALTER TABLE "ExerciseCatalog" ADD COLUMN "stableKey" VARCHAR(80);

-- The one-time legacy name match exists only in this migration. It is never a
-- runtime/model resolver. Refuse to silently replace an already assigned key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ExerciseCatalog" AS catalog
    JOIN (VALUES
      ('Жим гантелей на похилій лаві вгору (30°)', 'incline_dumbbell_press_30deg'),
      ('Розведення гантелей на горизонтальній лаві', 'flat_dumbbell_fly'),
      ('Віджимання від ручок', 'pushup_handles'),
      ('Жим гантелей сидячи', 'seated_dumbbell_press'),
      ('Махи гантеллю однією рукою вбік', 'one_arm_lateral_raise'),
      ('Розгинання однієї руки в блоці', 'one_arm_cable_triceps_extension'),
      ('Розгинання однієї руки з гантеллю в нахилі', 'bent_over_one_arm_dumbbell_triceps_extension'),
      ('Тяга горизонтального блоку сидячи однією рукою', 'one_arm_seated_cable_row'),
      ('Гіперекстензія', 'hyperextension'),
      ('Згинання однієї руки від коліна', 'one_arm_concentration_curl'),
      ('Згинання рук з розворотом сидячи на похилій лаві', 'incline_seated_rotating_dumbbell_curl'),
      ('Згинання кисті з гантеллю в упорі', 'supported_dumbbell_wrist_curl')
    ) AS canonical("name", "stableKey")
      ON catalog."profileId" = 1 AND catalog."name" = canonical."name"
    WHERE catalog."stableKey" IS NOT NULL
      AND catalog."stableKey" <> canonical."stableKey"
  ) THEN
    RAISE EXCEPTION 'ExerciseCatalog stableKey conflict for a canonical exercise';
  END IF;
END $$;

UPDATE "ExerciseCatalog" AS catalog
SET "stableKey" = canonical."stableKey"
FROM (VALUES
  ('Жим гантелей на похилій лаві вгору (30°)', 'incline_dumbbell_press_30deg'),
  ('Розведення гантелей на горизонтальній лаві', 'flat_dumbbell_fly'),
  ('Віджимання від ручок', 'pushup_handles'),
  ('Жим гантелей сидячи', 'seated_dumbbell_press'),
  ('Махи гантеллю однією рукою вбік', 'one_arm_lateral_raise'),
  ('Розгинання однієї руки в блоці', 'one_arm_cable_triceps_extension'),
  ('Розгинання однієї руки з гантеллю в нахилі', 'bent_over_one_arm_dumbbell_triceps_extension'),
  ('Тяга горизонтального блоку сидячи однією рукою', 'one_arm_seated_cable_row'),
  ('Гіперекстензія', 'hyperextension'),
  ('Згинання однієї руки від коліна', 'one_arm_concentration_curl'),
  ('Згинання рук з розворотом сидячи на похилій лаві', 'incline_seated_rotating_dumbbell_curl'),
  ('Згинання кисті з гантеллю в упорі', 'supported_dumbbell_wrist_curl')
) AS canonical("name", "stableKey")
WHERE catalog."profileId" = 1
  AND catalog."name" = canonical."name"
  AND catalog."stableKey" IS NULL;

CREATE UNIQUE INDEX "ExerciseCatalog_profileId_stableKey_key"
  ON "ExerciseCatalog"("profileId", "stableKey");
