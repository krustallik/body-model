import { prisma } from "@/lib/db/prisma";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
  initialExperimentalGlycogenStateV1,
  transitionExperimentalGlycogenStateV1,
  type ExperimentalGlycogenStateV1,
} from "@/model/physiology-v7/experimental-glycogen-state-v1";
import {
  transitionExperimentalDataGapContextV1,
  type ExperimentalDataGapContextV1,
  type ExperimentalSourceCoverageV1,
} from "@/model/physiology-v7/experimental-data-gap-context-v1";

type GlycogenShadowResult = {
  availability?: string;
  estimatedGlycogenDeltaKg?: number | null;
  lowerBoundKg?: number | null;
  upperBoundKg?: number | null;
};

function readDepletion(result: unknown): {
  point: number;
  lower: number;
  upper: number;
} | null {
  if (!result || typeof result !== "object") return null;
  const row = result as GlycogenShadowResult;
  if (row.availability !== "available") return null;
  const point = row.estimatedGlycogenDeltaKg;
  if (point === null || point === undefined || !Number.isFinite(point) || point > 0) {
    return null;
  }
  const lower = row.lowerBoundKg === null || row.lowerBoundKg === undefined
    || !Number.isFinite(row.lowerBoundKg)
    ? point
    : row.lowerBoundKg;
  const upper = row.upperBoundKg === null || row.upperBoundKg === undefined
    || !Number.isFinite(row.upperBoundKg)
    ? point
    : row.upperBoundKg;
  return { point, lower, upper };
}

function sumDepletions(
  parts: Array<{ point: number; lower: number; upper: number } | null>,
): { point: number; lower: number; upper: number } | null {
  const available = parts.filter((part): part is NonNullable<typeof part> => part !== null);
  if (available.length === 0) return null;
  return {
    point: available.reduce((sum, part) => sum + part.point, 0),
    lower: available.reduce((sum, part) => sum + Math.min(part.lower, part.upper, part.point), 0),
    upper: available.reduce((sum, part) => sum + Math.max(part.lower, part.upper, part.point), 0),
  };
}

function stateFromStoredResult(result: unknown): ExperimentalGlycogenStateV1 | null {
  if (!result || typeof result !== "object") return null;
  const state = (result as { state?: ExperimentalGlycogenStateV1 }).state;
  if (!state || state.availability !== "available" || state.relativeDeviationKg === null) {
    return null;
  }
  return state;
}

function gapContextFromStoredResult(result: unknown): ExperimentalDataGapContextV1 | null {
  if (!result || typeof result !== "object") return null;
  const context = (result as { gapContext?: ExperimentalDataGapContextV1 }).gapContext;
  return context?.fingerprint ? context : null;
}

async function loadDayInputs(profileId: number, date: string): Promise<{
  exerciseDepletionKg: number | null;
  exerciseDepletionLowerKg: number | null;
  exerciseDepletionUpperKg: number | null;
  workoutFeedObserved: boolean | null;
  carbsG: number | null;
  proteinG: number | null;
  activeEnergyKcal: number | null;
}> {
  const [health, strengthShadows, stepperShadows] = await Promise.all([
    prisma.dailyHealthData.findUnique({
      where: { date },
      select: {
        carbsG: true,
        proteinG: true,
        activeEnergyKcal: true,
        workoutFeedObserved: true,
      },
    }),
    prisma.experimentalStrengthGlycogenDemandShadow.findMany({
      where: {
        profileId,
        session: { matchedWorkout: { dailyHealthData: { date } } },
      },
      select: { result: true },
    }),
    prisma.experimentalStepperGlycogenDemandShadow.findMany({
      where: {
        profileId,
        workout: { dailyHealthData: { date } },
      },
      select: { result: true },
    }),
  ]);

  const depletion = sumDepletions([
    ...strengthShadows.map((row) => readDepletion(row.result)),
    ...stepperShadows.map((row) => readDepletion(row.result)),
  ]);

  return {
    exerciseDepletionKg: depletion?.point ?? null,
    exerciseDepletionLowerKg: depletion?.lower ?? null,
    exerciseDepletionUpperKg: depletion?.upper ?? null,
    workoutFeedObserved: health?.workoutFeedObserved ?? null,
    carbsG: health?.carbsG ?? null,
    proteinG: health?.proteinG ?? null,
    activeEnergyKcal: health?.activeEnergyKcal ?? null,
  };
}

function glycogenCoverage(day: Awaited<ReturnType<typeof loadDayInputs>>): Record<string, ExperimentalSourceCoverageV1> {
  return {
    // Glycogen needs carbohydrate evidence; protein is retained separately as
    // context for the existing transition and never fabricated here.
    nutrition: day.carbsG === null ? "missing" : "observed",
    training: day.workoutFeedObserved === true ? "observed"
      : day.workoutFeedObserved === false ? "observed" : "unresolved",
    activity: day.activeEnergyKcal === null ? "missing" : "device-estimated",
  };
}

/**
 * Deterministic historical rebuild of experimental glycogen state.
 * Delayed sync / replay with the same day inputs reproduces the same trajectory.
 */
export async function rebuildExperimentalGlycogenStateShadows(input: {
  profileId?: number;
  fromDate: string;
  toDate: string;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  if (input.toDate < input.fromDate) {
    throw new RangeError("toDate must be ≥ fromDate");
  }

  const priorRow = await prisma.experimentalGlycogenStateShadow.findFirst({
    where: { profileId, date: { lt: input.fromDate } },
    orderBy: { date: "desc" },
    select: { result: true },
  });
  let prior = stateFromStoredResult(priorRow?.result) ?? initialExperimentalGlycogenStateV1();
  let priorGapContext = gapContextFromStoredResult(priorRow?.result);

  for (let date = input.fromDate; date <= input.toDate; date = addCalendarDays(date, 1)) {
    const day = await loadDayInputs(profileId, date);
    const gapContext = transitionExperimentalDataGapContextV1({
      date,
      sources: glycogenCoverage(day),
      prior: priorGapContext,
    });
    const transition = transitionExperimentalGlycogenStateV1({
      prior,
      exerciseDepletionKg: day.exerciseDepletionKg,
      exerciseDepletionLowerKg: day.exerciseDepletionLowerKg,
      exerciseDepletionUpperKg: day.exerciseDepletionUpperKg,
      workoutFeedObserved: day.workoutFeedObserved,
      carbsG: day.carbsG,
      proteinG: day.proteinG,
      activeEnergyKcal: day.activeEnergyKcal,
    });
    const result = { ...transition, gapContext };
    const features = { ...transition.features, gapContext };
    const sourceFingerprint = stableSha256(result);
    await prisma.experimentalGlycogenStateShadow.upsert({
      where: { profileId_date: { profileId, date } },
      create: {
        profileId,
        date,
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
        features,
        result,
      },
      update: {
        sourceFingerprint,
        modelRevision: EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
        features,
        result,
      },
    });
    prior = transition.state;
    priorGapContext = gapContext;
  }
}

/**
 * Isolated experimental/shadow daily glycogen state step.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalGlycogenStateShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  await rebuildExperimentalGlycogenStateShadows({
    profileId: input.profileId,
    fromDate: input.date,
    toDate: input.date,
  });
}
