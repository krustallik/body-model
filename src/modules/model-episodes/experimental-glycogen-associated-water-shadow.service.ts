import { prisma } from "@/lib/db/prisma";
import {
  estimateExperimentalGlycogenAssociatedWaterV1,
  EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
  experimentalGlycogenAssociatedWaterV1Fingerprint,
} from "@/model/physiology-v7/experimental-glycogen-associated-water-v1";

type GlycogenShadowResult = {
  availability?: string;
  estimatedGlycogenDeltaKg?: number | null;
  lowerBoundKg?: number | null;
  upperBoundKg?: number | null;
};

function readGlycogenShadow(result: unknown): {
  point: number;
  lower: number;
  upper: number;
} | null {
  if (!result || typeof result !== "object") return null;
  const row = result as GlycogenShadowResult;
  if (row.availability !== "available") return null;
  const point = row.estimatedGlycogenDeltaKg;
  if (point === null || point === undefined || !Number.isFinite(point)) return null;
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

/**
 * Isolated experimental/shadow daily glycogen-associated water.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalGlycogenAssociatedWaterShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;

  const [
    latestV7,
    strengthShadows,
    stepperShadows,
    repletionShadow,
  ] = await Promise.all([
    prisma.physiologyV7DailyResult.findFirst({
      where: {
        profileId,
        date: { lte: input.date },
      },
      orderBy: { date: "desc" },
      select: { result: true },
    }),
    prisma.experimentalStrengthGlycogenDemandShadow.findMany({
      where: {
        profileId,
        session: { matchedWorkout: { dailyHealthData: { date: input.date } } },
      },
      select: { result: true },
    }),
    prisma.experimentalStepperGlycogenDemandShadow.findMany({
      where: {
        profileId,
        workout: { dailyHealthData: { date: input.date } },
      },
      select: { result: true },
    }),
    prisma.experimentalGlycogenRepletionShadow.findUnique({
      where: { profileId_date: { profileId, date: input.date } },
      select: { result: true },
    }),
  ]);

  const glycogenWaterCompartment = (
    latestV7?.result as {
      resultingState?: {
        compartments?: {
          glycogenWaterKg?: { availability?: string; valueKg?: number | null };
        };
      };
    } | null
  )?.resultingState?.compartments?.glycogenWaterKg;
  const currentGlycogenWaterKg = glycogenWaterCompartment?.availability === "available"
    && typeof glycogenWaterCompartment.valueKg === "number"
    && Number.isFinite(glycogenWaterCompartment.valueKg)
    ? glycogenWaterCompartment.valueKg
    : null;

  const parts = [
    ...strengthShadows.map((row) => readGlycogenShadow(row.result)),
    ...stepperShadows.map((row) => readGlycogenShadow(row.result)),
    readGlycogenShadow(repletionShadow?.result),
  ].filter((part): part is NonNullable<typeof part> => part !== null);

  const glycogenDeltaKg = parts.length === 0
    ? null
    : parts.reduce((sum, part) => sum + part.point, 0);
  const glycogenDeltaLowerKg = parts.length === 0
    ? null
    : parts.reduce((sum, part) => sum + part.lower, 0);
  const glycogenDeltaUpperKg = parts.length === 0
    ? null
    : parts.reduce((sum, part) => sum + part.upper, 0);

  const result = estimateExperimentalGlycogenAssociatedWaterV1({
    glycogenDeltaKg,
    glycogenDeltaLowerKg,
    glycogenDeltaUpperKg,
    currentGlycogenWaterKg,
  });
  const sourceFingerprint = experimentalGlycogenAssociatedWaterV1Fingerprint(result);
  await prisma.experimentalGlycogenAssociatedWaterShadow.upsert({
    where: { profileId_date: { profileId, date: input.date } },
    create: {
      profileId,
      date: input.date,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
      features: result.features,
      result,
    },
  });
}
