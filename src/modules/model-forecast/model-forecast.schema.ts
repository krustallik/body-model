import { z } from "zod";
import { OCCUPATIONAL_CATEGORIES } from "@/model/occupational-activity";

const nutrition = z.object({
  caloriesKcal: z.number().positive().max(20_000),
  proteinG: z.number().nonnegative().max(1_000),
  fatG: z.number().nonnegative().max(1_000),
  carbsG: z.number().nonnegative().max(2_000),
}).strict().refine((value) => value.proteinG + value.fatG + value.carbsG > 0, {
  message: "at least one macronutrient must be positive",
});

const occupationInterval = z.object({
  category: z.enum(Object.keys(OCCUPATIONAL_CATEGORIES) as [keyof typeof OCCUPATIONAL_CATEGORIES, ...(keyof typeof OCCUPATIONAL_CATEGORIES)[]]),
  durationHours: z.number().positive().max(24),
  breakDurationHours: z.number().nonnegative().max(24).nullable().default(0),
  workWalkingDistanceKm: z.number().nonnegative().max(100).nullable().default(0),
  averageWalkingSpeedKmh: z.number().positive().max(15).nullable().default(5),
}).strict().refine((value) => value.breakDurationHours === null
  || value.breakDurationHours <= value.durationHours, {
  path: ["breakDurationHours"], message: "must not exceed durationHours",
});

const behaviorDay = z.object({
  nutrition,
  outsideWorkWalkingDistanceKm: z.number().nonnegative().max(100),
  averageWalkingSpeedKmh: z.number().positive().max(15),
  strengthTrainingMinutes: z.number().nonnegative().max(600),
  occupation: z.array(occupationInterval).max(8),
}).strict().refine(
  (value) => value.occupation.reduce((sum, interval) => sum + interval.durationHours, 0) <= 24,
  { path: ["occupation"], message: "total duration must not exceed 24 hours" },
);

const partialBehaviorDay = z.object({
  nutrition: nutrition.optional(),
  outsideWorkWalkingDistanceKm: z.number().nonnegative().max(100).optional(),
  averageWalkingSpeedKmh: z.number().positive().max(15).optional(),
  strengthTrainingMinutes: z.number().nonnegative().max(600).optional(),
  occupation: z.array(occupationInterval).max(8).optional(),
}).strict();

const schedule = z.object({
  defaultDay: behaviorDay,
  byDate: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), partialBehaviorDay).optional(),
  strengthByWeekday: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.number().nonnegative().max(600)).optional(),
}).strict();

const fixedScenario = z.object({ mode: z.literal("fixed"), schedule }).strict();
const recentScenario = z.object({
  mode: z.literal("recent-behavior"),
  donorLookbackDays: z.number().int().min(7).max(365).optional(),
  minimumDonorDays: z.number().int().min(7).max(90).optional(),
  blockLengthDays: z.number().int().min(1).max(28).optional(),
}).strict();
const targetScenario = z.object({
  mode: z.literal("target-centered"),
  schedule,
  variability: z.object({
    nutritionLogStandardDeviation: z.number().positive().max(1).optional(),
    macroCompositionLogStandardDeviation: z.number().positive().max(1).optional(),
    walkingLogStandardDeviation: z.number().positive().max(2).optional(),
    strengthAdherenceProbability: z.number().min(0).max(1).optional(),
    occupationAdherenceProbability: z.number().min(0).max(1).optional(),
  }).strict().optional(),
}).strict();

export const ForecastConfigSchema = z.object({
  pathCount: z.number().int().min(1).max(20_000).optional(),
  lowerProbability: z.number().min(0).lt(0.25).optional(),
  innerLowerProbability: z.number().gt(0).lt(0.5).optional(),
  innerUpperProbability: z.number().gt(0.5).lt(1).optional(),
  upperProbability: z.number().gt(0.75).max(1).optional(),
  recentDonorLookbackDays: z.number().int().min(7).max(365).optional(),
  minimumReliableDonorDays: z.number().int().min(7).max(90).optional(),
  blockLengthDays: z.number().int().min(1).max(28).optional(),
  fallbackNutritionLogStandardDeviation: z.number().positive().max(1).optional(),
  fallbackMacroCompositionLogStandardDeviation: z.number().positive().max(1).optional(),
  fallbackWalkingLogStandardDeviation: z.number().positive().max(2).optional(),
  strengthAdherenceProbability: z.number().min(0).max(1).optional(),
  occupationAdherenceProbability: z.number().min(0).max(1).optional(),
  minimumValidPathFraction: z.number().gt(0).max(1).optional(),
  longHorizonThresholdDays: z.number().int().min(30).max(3_650).optional(),
  longHorizonRecommendedPathCount: z.number().int().min(128).max(20_000).optional(),
}).strict();

export const ForecastModelRequestSchema = z.object({
  episodeId: z.number().int().positive().optional(),
  horizonDays: z.number().int().min(1).max(3_650),
  seed: z.number().int().min(0).max(2_147_483_647).default(20_260_824),
  scenario: z.discriminatedUnion("mode", [fixedScenario, recentScenario, targetScenario]),
  config: ForecastConfigSchema.optional(),
}).strict();

export type ForecastModelRequest = z.infer<typeof ForecastModelRequestSchema>;
