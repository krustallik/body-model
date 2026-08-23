ALTER TABLE "ModelEpisode"
ADD COLUMN "baselineNutritionFallback" JSONB,
ADD COLUMN "nutritionMaxBridgeDays" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "DailyModelState"
ADD COLUMN "dataQuality" VARCHAR(20) NOT NULL DEFAULT 'observed',
ADD COLUMN "nutritionSource" VARCHAR(30) NOT NULL DEFAULT 'observed',
ADD COLUMN "nutritionImputationMethod" VARCHAR(50),
ADD COLUMN "nutritionReferenceDayCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nutritionGapLength" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nutritionImputationDiagnostics" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "DailyModelState"
SET
  "dataQuality" = CASE
    WHEN "status" = 'complete' THEN 'observed'
    WHEN "status" = 'incomplete' THEN 'incomplete'
    ELSE 'blocked'
  END,
  "nutritionSource" = CASE
    WHEN "status" = 'complete' THEN 'observed'
    ELSE 'missing'
  END;

ALTER TABLE "ModelEpisode"
ADD CONSTRAINT "ModelEpisode_nutrition_gap_policy_check"
CHECK ("nutritionMaxBridgeDays" >= 0 AND "nutritionMaxBridgeDays" <= 7);

ALTER TABLE "DailyModelState"
ADD CONSTRAINT "DailyModelState_data_quality_check"
CHECK ("dataQuality" IN ('observed', 'estimated', 'incomplete', 'blocked')),
ADD CONSTRAINT "DailyModelState_nutrition_source_check"
CHECK ("nutritionSource" IN ('observed', 'imputed-local', 'imputed-fallback', 'missing')),
ADD CONSTRAINT "DailyModelState_nutrition_provenance_check"
CHECK (
  "nutritionReferenceDayCount" >= 0
  AND "nutritionGapLength" >= 0
  AND (
    ("nutritionSource" = 'observed'
      AND "nutritionImputationMethod" IS NULL
      AND "nutritionReferenceDayCount" = 0
      AND "nutritionGapLength" = 0)
    OR
    ("nutritionSource" IN ('imputed-local', 'imputed-fallback')
      AND "nutritionImputationMethod" IS NOT NULL
      AND "nutritionReferenceDayCount" > 0
      AND "nutritionGapLength" > 0)
    OR
    ("nutritionSource" = 'missing'
      AND "nutritionImputationMethod" IS NULL)
  )
);
