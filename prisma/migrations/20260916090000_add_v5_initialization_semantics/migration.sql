ALTER TABLE "ModelEpisode"
ADD COLUMN "observedReferenceNutrition" JSONB,
ADD COLUMN "energyHomeostasisReferenceKcalPerDay" DOUBLE PRECISION,
ADD COLUMN "glycogenReferenceCarbIntakeG" DOUBLE PRECISION,
ADD COLUMN "initialPersonalOffsetKcalPerDay" DOUBLE PRECISION,
ADD COLUMN "initializationStatus" VARCHAR(40),
ADD COLUMN "initializationDiagnostics" JSONB;

ALTER TABLE "ModelEpisode"
ADD CONSTRAINT "ModelEpisode_v5_reference_values_check"
CHECK (
  ("energyHomeostasisReferenceKcalPerDay" IS NULL OR "energyHomeostasisReferenceKcalPerDay" > 0)
  AND ("glycogenReferenceCarbIntakeG" IS NULL OR "glycogenReferenceCarbIntakeG" > 0)
);
