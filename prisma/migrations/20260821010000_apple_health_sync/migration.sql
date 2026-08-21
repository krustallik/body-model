CREATE TABLE "DailyHealthData" (
    "id" SERIAL NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "caloriesKcal" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "steps" INTEGER,
    "activeEnergyKcal" DOUBLE PRECISION,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyHealthData_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DailyHealthData_date_format_check" CHECK (
      "date" ~ '^\d{4}-\d{2}-\d{2}$'
      AND to_char(to_date("date", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "date"
    )
);

CREATE TABLE "Workout" (
    "id" SERIAL NOT NULL,
    "dailyHealthDataId" INTEGER NOT NULL,
    "externalId" TEXT,
    "type" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" DOUBLE PRECISION,
    "energyKcal" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyHealthData_date_key" ON "DailyHealthData"("date");
CREATE INDEX "Workout_dailyHealthDataId_idx" ON "Workout"("dailyHealthDataId");

ALTER TABLE "Workout" ADD CONSTRAINT "Workout_dailyHealthDataId_fkey"
FOREIGN KEY ("dailyHealthDataId") REFERENCES "DailyHealthData"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
