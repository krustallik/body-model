-- Preserve the old profile/date uniqueness for unassigned legacy evidence,
-- while allowing identical dates in distinct ModelEpisodes.
DROP INDEX "RelMuscleDelta_episode_date_key";
CREATE UNIQUE INDEX "RelMuscleDelta_episode_date_key"
  ON "ExperimentalSkeletalMuscleDeltaShadow"("profileId", "modelEpisodeId", "date")
  NULLS NOT DISTINCT;

DROP INDEX "RelMuscleCessation_episode_date_key";
CREATE UNIQUE INDEX "RelMuscleCessation_episode_date_key"
  ON "ExperimentalCessationDetrainingShadow"("profileId", "modelEpisodeId", "date")
  NULLS NOT DISTINCT;
