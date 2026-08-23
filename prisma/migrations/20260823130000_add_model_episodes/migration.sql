CREATE TABLE "ModelEpisode" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "startDate" VARCHAR(10) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "modelVersion" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(3),
    "ecfPolicy" VARCHAR(40) NOT NULL,
    "baselineEnergyIntakeKcalPerDay" DOUBLE PRECISION NOT NULL,
    "baselineCarbIntakeG" DOUBLE PRECISION NOT NULL,
    "baselineWindowStartDate" VARCHAR(10) NOT NULL,
    "baselineWindowEndDate" VARCHAR(10) NOT NULL,
    "baselineNutritionDayCount" INTEGER NOT NULL,
    "baselineWeightObservationCount" INTEGER NOT NULL,
    "baselineWeightTrendKgPerWeek" DOUBLE PRECISION NOT NULL,
    "baselineWeightTrendPercentPerWeek" DOUBLE PRECISION NOT NULL,
    "baselineDerivationMethod" VARCHAR(100) NOT NULL,
    "initialFatMassKg" DOUBLE PRECISION NOT NULL,
    "initialLeanTissueKg" DOUBLE PRECISION NOT NULL,
    "initialGlycogenKg" DOUBLE PRECISION NOT NULL,
    "baselineExtracellularFluidLiters" DOUBLE PRECISION NOT NULL,
    "initialExtracellularFluidDeviationLiters" DOUBLE PRECISION NOT NULL,
    "initialAdaptiveThermogenesisKcalPerDay" DOUBLE PRECISION NOT NULL,
    "initialFilteredWeightKg" DOUBLE PRECISION NOT NULL,
    "initialWeightFilterVarianceKg2" DOUBLE PRECISION NOT NULL,
    "initialRmrKcalPerDay" DOUBLE PRECISION NOT NULL,
    "dynamicRmrFatCoefficient" DOUBLE PRECISION NOT NULL,
    "dynamicRmrLeanCoefficient" DOUBLE PRECISION NOT NULL,
    "dynamicRmrCalibrationOffsetKcalPerDay" DOUBLE PRECISION NOT NULL,
    "adaptiveThermogenesisBeta" DOUBLE PRECISION NOT NULL,
    "adaptiveThermogenesisTimeConstantDays" DOUBLE PRECISION NOT NULL,
    "weightProcessNoiseVarianceKg2PerDay" DOUBLE PRECISION NOT NULL,
    "weightMeasurementNoiseVarianceKg2" DOUBLE PRECISION NOT NULL,
    "personalOffsetKcalPerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activityCalibration" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "calibrationStatus" VARCHAR(40) NOT NULL DEFAULT 'insufficient-history',
    "calibrationDiagnostics" JSONB NOT NULL,
    "latestModeledDate" VARCHAR(10),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ModelEpisode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModelEpisode_dates_check" CHECK (
      "startDate" ~ '^\d{4}-\d{2}-\d{2}$'
      AND to_char(to_date("startDate", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "startDate"
      AND "baselineWindowStartDate" ~ '^\d{4}-\d{2}-\d{2}$'
      AND to_char(to_date("baselineWindowStartDate", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "baselineWindowStartDate"
      AND "baselineWindowEndDate" ~ '^\d{4}-\d{2}-\d{2}$'
      AND to_char(to_date("baselineWindowEndDate", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "baselineWindowEndDate"
      AND ("latestModeledDate" IS NULL OR (
        "latestModeledDate" ~ '^\d{4}-\d{2}-\d{2}$'
        AND to_char(to_date("latestModeledDate", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "latestModeledDate"
      ))
    ),
    CONSTRAINT "ModelEpisode_positive_baseline_check" CHECK (
      "baselineEnergyIntakeKcalPerDay" > 0
      AND "baselineCarbIntakeG" > 0
      AND "baselineNutritionDayCount" > 0
      AND "baselineWeightObservationCount" > 0
    ),
    CONSTRAINT "ModelEpisode_positive_state_check" CHECK (
      "initialFatMassKg" > 0
      AND "initialLeanTissueKg" > 0
      AND "initialGlycogenKg" > 0
      AND "baselineExtracellularFluidLiters" > 0
      AND "initialFilteredWeightKg" > 0
      AND "initialWeightFilterVarianceKg2" > 0
      AND "initialRmrKcalPerDay" > 0
      AND "adaptiveThermogenesisTimeConstantDays" > 0
      AND "weightProcessNoiseVarianceKg2PerDay" >= 0
      AND "weightMeasurementNoiseVarianceKg2" > 0
      AND "activityCalibration" >= 0
    ),
    CONSTRAINT "ModelEpisode_ecf_policy_check" CHECK (
      "ecfPolicy" IN ('full', 'assume-unchanged-sodium', 'hold-ecf')
    ),
    CONSTRAINT "ModelEpisode_calibration_status_check" CHECK (
      "calibrationStatus" IN (
        'insufficient-history', 'invalid-history', 'offset-only',
        'fully-calibrated', 'defaults-retained'
      )
    ),
    CONSTRAINT "ModelEpisode_active_timestamp_check" CHECK (
      ("active" AND "deactivatedAt" IS NULL)
      OR (NOT "active" AND "deactivatedAt" IS NOT NULL)
    )
);

CREATE TABLE "DailyModelState" (
    "id" SERIAL NOT NULL,
    "episodeId" INTEGER NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "sourceQuality" JSONB NOT NULL,
    "missingFields" JSONB NOT NULL,
    "modelVersion" VARCHAR(100) NOT NULL,
    "startWeightKg" DOUBLE PRECISION,
    "endWeightKg" DOUBLE PRECISION,
    "fatMassKg" DOUBLE PRECISION,
    "leanTissueKg" DOUBLE PRECISION,
    "glycogenKg" DOUBLE PRECISION,
    "extracellularFluidDeviationLiters" DOUBLE PRECISION,
    "dynamicRmrKcalPerDay" DOUBLE PRECISION,
    "tefKcalPerDay" DOUBLE PRECISION,
    "activityKcalPerDay" DOUBLE PRECISION,
    "adaptiveThermogenesisKcalPerDay" DOUBLE PRECISION,
    "energyIntakeKcal" DOUBLE PRECISION,
    "energyExpenditureKcal" DOUBLE PRECISION,
    "energyBalanceKcal" DOUBLE PRECISION,
    "deltaFatKg" DOUBLE PRECISION,
    "deltaLeanTissueKg" DOUBLE PRECISION,
    "deltaGlycogenKg" DOUBLE PRECISION,
    "filteredWeightKg" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyModelState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DailyModelState_date_check" CHECK (
      "date" ~ '^\d{4}-\d{2}-\d{2}$'
      AND to_char(to_date("date", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "date"
    ),
    CONSTRAINT "DailyModelState_status_check" CHECK (
      "status" IN ('complete', 'incomplete', 'blocked')
    )
);

CREATE UNIQUE INDEX "ModelEpisode_one_active_key"
ON "ModelEpisode" ((1)) WHERE "active" = true;
CREATE INDEX "ModelEpisode_active_idx" ON "ModelEpisode"("active");
CREATE INDEX "ModelEpisode_startDate_idx" ON "ModelEpisode"("startDate");
CREATE INDEX "ModelEpisode_profileId_idx" ON "ModelEpisode"("profileId");
CREATE UNIQUE INDEX "DailyModelState_episodeId_date_key"
ON "DailyModelState"("episodeId", "date");
CREATE INDEX "DailyModelState_episodeId_date_idx"
ON "DailyModelState"("episodeId", "date");
CREATE INDEX "DailyModelState_date_idx" ON "DailyModelState"("date");

ALTER TABLE "ModelEpisode"
ADD CONSTRAINT "ModelEpisode_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "Profile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyModelState"
ADD CONSTRAINT "DailyModelState_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "ModelEpisode"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
