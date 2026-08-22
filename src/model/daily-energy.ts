import { calculateActivity } from "./activity/activity";
import { calculateStrengthActivity } from "./activity/strength";
import { calculateWalkingActivity } from "./activity/walking";
import { calculateAge } from "./age";
import { calculateBaseTdee } from "./base-tdee";
import type { ModelSex } from "./constants";
import { calculateRmr } from "./rmr";
import { calculateTef } from "./tef";

type OptionalMeasurement = number | null | undefined;

export type DailyEnergyInput = {
  profile: {
    sex: ModelSex;
    dateOfBirth: string;
    heightCm: number;
  };
  date: string;
  weightKg: number;
  macros: {
    proteinG: OptionalMeasurement;
    carbsG: OptionalMeasurement;
    fatG: OptionalMeasurement;
  };
  walking: {
    distanceKm: OptionalMeasurement;
    averageSpeedKmh: OptionalMeasurement;
  };
  strength: {
    durationMinutes: OptionalMeasurement;
  };
};

export type DailyEnergyResult = {
  rmrKcal: number;
  tefKcal: number | null;
  walkingActivityKcal: number | null;
  strengthActivityKcal: number | null;
  activityKcal: number | null;
  baseTdeeKcal: number | null;
};

export function calculateDailyEnergy(input: DailyEnergyInput): DailyEnergyResult {
  const ageYears = calculateAge(input.profile.dateOfBirth, input.date);
  const rmrKcal = calculateRmr({
    sex: input.profile.sex,
    weightKg: input.weightKg,
    heightCm: input.profile.heightCm,
    ageYears,
  });
  const tefKcal = calculateTef(input.macros);
  const walkingActivityKcal = calculateWalkingActivity({
    weightKg: input.weightKg,
    rmrKcalPerDay: rmrKcal,
    distanceKm: input.walking.distanceKm,
    averageSpeedKmh: input.walking.averageSpeedKmh,
  });
  const strengthActivityKcal = calculateStrengthActivity({
    weightKg: input.weightKg,
    rmrKcalPerDay: rmrKcal,
    durationMinutes: input.strength.durationMinutes,
  });
  const activityKcal = calculateActivity({ walkingActivityKcal, strengthActivityKcal });
  const baseTdeeKcal = calculateBaseTdee({ rmrKcal, tefKcal, activityKcal });

  return {
    rmrKcal,
    tefKcal,
    walkingActivityKcal,
    strengthActivityKcal,
    activityKcal,
    baseTdeeKcal,
  };
}
