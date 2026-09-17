import { z } from "zod";
import { RESISTANCE, TRAINING_LIMITS } from "./training.constants";
import { parseNullableNumericInput } from "@/modules/days/day.schema";

export const ResistanceTypeSchema = z.enum([
  RESISTANCE.EXTERNAL_WEIGHT,
  RESISTANCE.RESISTANCE_BAND,
  RESISTANCE.BODYWEIGHT,
]);

const positiveInt = z.number().int().positive();

export const ProgramExerciseInputSchema = z.object({
  catalogId: positiveInt,
  plannedSets: z.number().int().positive().max(TRAINING_LIMITS.maxPlannedSets),
  resistanceType: ResistanceTypeSchema,
  order: z.number().int().nonnegative().optional(),
}).strict();

export const CreateProgramSchema = z.object({
  name: z.string().trim().min(1).max(TRAINING_LIMITS.maxProgramNameLength),
  exercises: z.array(ProgramExerciseInputSchema).min(1).max(TRAINING_LIMITS.maxExercisesPerProgram),
}).strict();

export const UpdateProgramSchema = z.object({
  name: z.string().trim().min(1).max(TRAINING_LIMITS.maxProgramNameLength).optional(),
  exercises: z.array(ProgramExerciseInputSchema).min(1).max(TRAINING_LIMITS.maxExercisesPerProgram).optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.exercises !== undefined,
  "at least one of name or exercises is required",
);

export const ProgramIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

export const SessionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

export const SessionExerciseParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  exerciseId: z.coerce.number().int().positive(),
}).strict();

export const SessionSetParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  setId: z.coerce.number().int().positive(),
}).strict();

export const StartSessionSchema = z.object({
  programId: positiveInt,
}).strict();

const nullableLoad = z.preprocess(
  parseNullableNumericInput,
  z.number().positive().max(TRAINING_LIMITS.maxLoadKg).nullable().optional(),
);

export const CreateSetSchema = z.object({
  reps: z.preprocess(parseNullableNumericInput, z.number().int().positive().max(TRAINING_LIMITS.maxReps)),
  weightKg: nullableLoad,
  bandNominalResistanceKg: nullableLoad,
  setNumber: z.preprocess(parseNullableNumericInput, z.number().int().positive().optional()),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const UpdateSetSchema = z.object({
  reps: z.preprocess(parseNullableNumericInput, z.number().int().positive().max(TRAINING_LIMITS.maxReps).optional()),
  weightKg: nullableLoad,
  bandNominalResistanceKg: nullableLoad,
  completedAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "at least one set field is required",
);

export const ManualMatchSchema = z.object({
  /**
   * Workout id to link, or null to explicitly finalize as UNMATCHED.
   */
  workoutId: z.number().int().positive().nullable(),
}).strict();

export const CreateFromWorkoutSchema = z.object({
  workoutId: positiveInt,
  programId: positiveInt,
  programVersionId: positiveInt.optional(),
}).strict();

export const BulkCreateFromWorkoutsSchema = z.object({
  workoutIds: z.array(positiveInt).min(1).max(50),
  programId: positiveInt,
  programVersionId: positiveInt.optional(),
}).strict();

export const ChangeSessionProgramSchema = z.object({
  programId: positiveInt,
  programVersionId: positiveInt.optional(),
}).strict();

export const CreateSessionExerciseSchema = z.object({
  catalogId: positiveInt,
  plannedSets: z.number().int().positive().max(TRAINING_LIMITS.maxPlannedSets).default(3),
  resistanceType: ResistanceTypeSchema,
  order: z.number().int().nonnegative().optional(),
}).strict();

export const UpdateSessionExerciseSchema = z.object({
  plannedSets: z.number().int().positive().max(TRAINING_LIMITS.maxPlannedSets).optional(),
  resistanceType: ResistanceTypeSchema.optional(),
  order: z.number().int().nonnegative().optional(),
  /**
   * Required when changing resistanceType on an exercise that already has
   * incompatible load fields on actual sets — clears those load fields.
   */
  confirmResistanceChange: z.boolean().optional(),
}).strict().refine(
  (value) =>
    value.plannedSets !== undefined
    || value.resistanceType !== undefined
    || value.order !== undefined,
  "at least one exercise field is required",
);

export const DeleteSessionExerciseSchema = z.object({
  confirm: z.boolean().optional(),
}).strict();

export const ReorderSessionExercisesSchema = z.object({
  exerciseIds: z.array(positiveInt).min(1).max(TRAINING_LIMITS.maxExercisesPerProgram),
}).strict();

export const HistoricalWorkoutsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  onlyMissingDiary: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
}).strict();

export const RecentSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

export const CatalogListQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
}).strict();

export const ProgramListQuerySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
}).strict();

export type CreateProgramInput = z.infer<typeof CreateProgramSchema>;
export type UpdateProgramInput = z.infer<typeof UpdateProgramSchema>;
export type StartSessionInput = z.infer<typeof StartSessionSchema>;
export type CreateSetInput = z.infer<typeof CreateSetSchema>;
export type UpdateSetInput = z.infer<typeof UpdateSetSchema>;
export type ManualMatchInput = z.infer<typeof ManualMatchSchema>;
export type CreateFromWorkoutInput = z.infer<typeof CreateFromWorkoutSchema>;
export type BulkCreateFromWorkoutsInput = z.infer<typeof BulkCreateFromWorkoutsSchema>;
export type ChangeSessionProgramInput = z.infer<typeof ChangeSessionProgramSchema>;
export type CreateSessionExerciseInput = z.infer<typeof CreateSessionExerciseSchema>;
export type UpdateSessionExerciseInput = z.infer<typeof UpdateSessionExerciseSchema>;
export type DeleteSessionExerciseInput = z.infer<typeof DeleteSessionExerciseSchema>;
export type ReorderSessionExercisesInput = z.infer<typeof ReorderSessionExercisesSchema>;
export type HistoricalWorkoutsQuery = z.infer<typeof HistoricalWorkoutsQuerySchema>;
