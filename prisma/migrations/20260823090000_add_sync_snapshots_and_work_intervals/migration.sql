CREATE TABLE "HealthSyncSnapshot" (
    "id" SERIAL NOT NULL,
    "dailyHealthDataId" INTEGER NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMPTZ(3),
    "timezone" VARCHAR(100) NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "bodyFatPercent" DECIMAL(10,4),
    "caloriesKcal" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "steps" INTEGER,
    "activeEnergyKcal" DOUBLE PRECISION,
    "averageWalkingSpeedKmh" DECIMAL(10,4),
    "walkingDistanceKm" DECIMAL(10,4),
    "strengthTrainingMinutes" DECIMAL(10,4),
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "HealthSyncSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkInterval" (
    "id" SERIAL NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkInterval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkInterval_positive_duration" CHECK ("endAt" > "startAt")
);

CREATE INDEX "HealthSyncSnapshot_date_receivedAt_idx"
ON "HealthSyncSnapshot"("date", "receivedAt");

CREATE INDEX "HealthSyncSnapshot_dailyHealthDataId_idx"
ON "HealthSyncSnapshot"("dailyHealthDataId");

CREATE INDEX "WorkInterval_date_startAt_idx" ON "WorkInterval"("date", "startAt");
CREATE INDEX "WorkInterval_startAt_endAt_idx" ON "WorkInterval"("startAt", "endAt");

ALTER TABLE "WorkInterval"
ADD CONSTRAINT "WorkInterval_no_overlap"
EXCLUDE USING GIST (tstzrange("startAt", "endAt", '[)') WITH &&);

ALTER TABLE "HealthSyncSnapshot"
ADD CONSTRAINT "HealthSyncSnapshot_dailyHealthDataId_fkey"
FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
