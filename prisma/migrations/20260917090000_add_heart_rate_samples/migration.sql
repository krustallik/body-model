CREATE TABLE "HeartRateSample" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "dailyHealthDataId" INTEGER NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "bpm" DOUBLE PRECISION NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'shortcut',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "HeartRateSample_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RestingHeartRateSample" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "dailyHealthDataId" INTEGER NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "bpm" DOUBLE PRECISION NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'shortcut',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "RestingHeartRateSample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HeartRateSample_profileId_timestamp_bpm_key" ON "HeartRateSample"("profileId", "timestamp", "bpm");
CREATE INDEX "HeartRateSample_date_timestamp_idx" ON "HeartRateSample"("date", "timestamp");
CREATE INDEX "HeartRateSample_dailyHealthDataId_timestamp_idx" ON "HeartRateSample"("dailyHealthDataId", "timestamp");
CREATE UNIQUE INDEX "RestingHeartRateSample_profileId_timestamp_bpm_key" ON "RestingHeartRateSample"("profileId", "timestamp", "bpm");
CREATE INDEX "RestingHeartRateSample_date_timestamp_idx" ON "RestingHeartRateSample"("date", "timestamp");
CREATE INDEX "RestingHeartRateSample_dailyHealthDataId_timestamp_idx" ON "RestingHeartRateSample"("dailyHealthDataId", "timestamp");

ALTER TABLE "HeartRateSample" ADD CONSTRAINT "HeartRateSample_dailyHealthDataId_fkey" FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestingHeartRateSample" ADD CONSTRAINT "RestingHeartRateSample_dailyHealthDataId_fkey" FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id") ON DELETE CASCADE ON UPDATE CASCADE;
