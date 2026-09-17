-- A sync for one local day can contain HealthKit samples from earlier local days.
-- Those samples retain their timestamp-derived date and do not belong to the
-- outer day's DailyHealthData record.
ALTER TABLE "HeartRateSample" ALTER COLUMN "dailyHealthDataId" DROP NOT NULL;
ALTER TABLE "RestingHeartRateSample" ALTER COLUMN "dailyHealthDataId" DROP NOT NULL;
