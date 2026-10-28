-- Match Prisma's composite relation contract. Application-level deletes clear
-- only the optional projection pointer while preserving the immutable snapshot.
ALTER TABLE "HealthSyncSnapshot"
DROP CONSTRAINT "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey";

ALTER TABLE "HealthSyncSnapshot"
ADD CONSTRAINT "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey"
FOREIGN KEY ("profileId", "dailyHealthDataId")
REFERENCES "DailyHealthData"("profileId", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
