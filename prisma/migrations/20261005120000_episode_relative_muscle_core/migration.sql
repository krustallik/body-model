-- Additive episode identity and fail-closed stale markers for Relative Muscle
-- shadows. Existing rows remain legacy rows with modelEpisodeId = NULL.

ALTER TABLE "ExperimentalSkeletalMuscleDeltaShadow"
  ADD COLUMN "modelEpisodeId" INTEGER,
  ADD COLUMN "isStale" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "ExperimentalCessationDetrainingShadow"
  ADD COLUMN "modelEpisodeId" INTEGER,
  ADD COLUMN "isStale" BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing profile/date rows do not identify the episode whose baseline they
-- used. Preserve the evidence, but make it ineligible for current reads or
-- suffix predecessors until rebuilt from episode-owned inputs.
UPDATE "ExperimentalSkeletalMuscleDeltaShadow"
SET "isStale" = TRUE;
UPDATE "ExperimentalCessationDetrainingShadow"
SET "isStale" = TRUE;

DROP INDEX "ExperimentalSkeletalMuscleDeltaShadow_profileId_date_key";
DROP INDEX "ExperimentalCessationDetrainingShadow_profileId_date_key";

CREATE UNIQUE INDEX "ModelEpisode_id_profileId_key"
  ON "ModelEpisode"("id", "profileId");

ALTER TABLE "ExperimentalSkeletalMuscleDeltaShadow"
  ADD CONSTRAINT "ExperimentalSkeletalMuscleDeltaShadow_modelEpisodeId_profileId_fkey"
  FOREIGN KEY ("modelEpisodeId", "profileId") REFERENCES "ModelEpisode"("id", "profileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExperimentalCessationDetrainingShadow"
  ADD CONSTRAINT "ExperimentalCessationDetrainingShadow_modelEpisodeId_profileId_fkey"
  FOREIGN KEY ("modelEpisodeId", "profileId") REFERENCES "ModelEpisode"("id", "profileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ExperimentalSkeletalMuscleDeltaShadow_profileId_modelEpisodeId_date_key"
  ON "ExperimentalSkeletalMuscleDeltaShadow"("profileId", "modelEpisodeId", "date");
CREATE INDEX "ExperimentalSkeletalMuscleDeltaShadow_profileId_modelEpisodeId_isStale_date_idx"
  ON "ExperimentalSkeletalMuscleDeltaShadow"("profileId", "modelEpisodeId", "isStale", "date");
CREATE INDEX "ExperimentalSkeletalMuscleDeltaShadow_modelEpisodeId_profileId_idx"
  ON "ExperimentalSkeletalMuscleDeltaShadow"("modelEpisodeId", "profileId");

CREATE UNIQUE INDEX "ExperimentalCessationDetrainingShadow_profileId_modelEpisodeId_date_key"
  ON "ExperimentalCessationDetrainingShadow"("profileId", "modelEpisodeId", "date");
CREATE INDEX "ExperimentalCessationDetrainingShadow_profileId_modelEpisodeId_isStale_date_idx"
  ON "ExperimentalCessationDetrainingShadow"("profileId", "modelEpisodeId", "isStale", "date");
CREATE INDEX "ExperimentalCessationDetrainingShadow_modelEpisodeId_profileId_idx"
  ON "ExperimentalCessationDetrainingShadow"("modelEpisodeId", "profileId");
