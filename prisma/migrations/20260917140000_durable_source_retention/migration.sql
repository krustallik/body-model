-- Durable source FK protection + indexes for rebuild queries.
-- Workout: Restrict accidental DailyHealthData deletes from cascading.
-- HR / resting HR: SetNull so day deletes never wipe raw series.
-- SleepSegment remains independent (no FK to DailyHealthData).

ALTER TABLE "Workout" DROP CONSTRAINT "Workout_dailyHealthDataId_fkey";
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_dailyHealthDataId_fkey"
FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Workout_startAt_endAt_idx" ON "Workout"("startAt", "endAt");

ALTER TABLE "HeartRateSample" DROP CONSTRAINT "HeartRateSample_dailyHealthDataId_fkey";
ALTER TABLE "HeartRateSample" ADD CONSTRAINT "HeartRateSample_dailyHealthDataId_fkey"
FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "HeartRateSample_profileId_timestamp_idx"
ON "HeartRateSample"("profileId", "timestamp");

ALTER TABLE "RestingHeartRateSample" DROP CONSTRAINT "RestingHeartRateSample_dailyHealthDataId_fkey";
ALTER TABLE "RestingHeartRateSample" ADD CONSTRAINT "RestingHeartRateSample_dailyHealthDataId_fkey"
FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "RestingHeartRateSample_profileId_timestamp_idx"
ON "RestingHeartRateSample"("profileId", "timestamp");
