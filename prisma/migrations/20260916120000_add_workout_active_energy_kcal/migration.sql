-- Additive: Garmin/device active workout calories (resting component already excluded).
-- Legacy energyKcal is retained without reinterpretation.
ALTER TABLE "Workout"
ADD COLUMN "activeEnergyKcal" DOUBLE PRECISION;
