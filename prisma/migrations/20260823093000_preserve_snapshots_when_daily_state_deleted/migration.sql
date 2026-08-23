ALTER TABLE "HealthSyncSnapshot"
DROP CONSTRAINT "HealthSyncSnapshot_dailyHealthDataId_fkey";

ALTER TABLE "HealthSyncSnapshot"
ALTER COLUMN "dailyHealthDataId" DROP NOT NULL;

ALTER TABLE "HealthSyncSnapshot"
ADD CONSTRAINT "HealthSyncSnapshot_dailyHealthDataId_fkey"
FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
