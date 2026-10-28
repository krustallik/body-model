-- Model episodes are independent per Profile, not a process-wide singleton.
DROP INDEX "ModelEpisode_one_active_key";

CREATE UNIQUE INDEX "ModelEpisode_profileId_one_active_key"
ON "ModelEpisode" ("profileId")
WHERE "active" = true;

-- Keep the immutable sync snapshot when a daily projection is removed. The
-- profile component remains required for tenant isolation, so only the
-- nullable dailyHealthDataId part of the composite key is cleared.
ALTER TABLE "HealthSyncSnapshot"
DROP CONSTRAINT "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey";

ALTER TABLE "HealthSyncSnapshot"
ADD CONSTRAINT "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey"
FOREIGN KEY ("profileId", "dailyHealthDataId")
REFERENCES "DailyHealthData"("profileId", "id")
ON DELETE SET NULL ("dailyHealthDataId")
ON UPDATE CASCADE;
