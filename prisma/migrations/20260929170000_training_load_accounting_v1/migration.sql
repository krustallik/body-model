-- Stage 02 load accounting persistence. All fields are nullable by design.
-- Existing rows are intentionally not backfilled or reinterpreted.
ALTER TABLE "ExerciseCatalog"
  ADD COLUMN "currentLoadAccountingConfigId" INTEGER;

CREATE TABLE "ExerciseLoadConfiguration" (
  "id" SERIAL NOT NULL,
  "exerciseCatalogId" INTEGER NOT NULL,
  "configVersion" VARCHAR(80) NOT NULL,
  "configuration" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExerciseLoadConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExerciseCatalog_currentLoadAccountingConfigId_key"
  ON "ExerciseCatalog"("currentLoadAccountingConfigId");
CREATE UNIQUE INDEX "ExerciseLoadConfiguration_exerciseCatalogId_configVersion_key"
  ON "ExerciseLoadConfiguration"("exerciseCatalogId", "configVersion");
CREATE INDEX "ExerciseLoadConfiguration_exerciseCatalogId_createdAt_idx"
  ON "ExerciseLoadConfiguration"("exerciseCatalogId", "createdAt");

ALTER TABLE "ExerciseLoadConfiguration"
  ADD CONSTRAINT "ExerciseLoadConfiguration_exerciseCatalogId_fkey"
  FOREIGN KEY ("exerciseCatalogId") REFERENCES "ExerciseCatalog"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExerciseCatalog"
  ADD CONSTRAINT "ExerciseCatalog_currentLoadAccountingConfigId_fkey"
  FOREIGN KEY ("currentLoadAccountingConfigId") REFERENCES "ExerciseLoadConfiguration"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProgramExercise"
  ADD COLUMN "loadAccountingConfigSnapshot" JSONB;

ALTER TABLE "StrengthSessionExercise"
  ADD COLUMN "loadAccountingConfigSnapshot" JSONB;

ALTER TABLE "StrengthSet"
  ADD COLUMN "loadAccountingOverride" JSONB;

ALTER TABLE "HealthMetricSample"
  ADD COLUMN "source" VARCHAR(40);
