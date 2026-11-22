-- Additive, nullable training analytics context. Existing plans and sessions
-- remain valid and historical set observations are not rewritten.
ALTER TABLE "ProgramExercise"
  ADD COLUMN "plannedRepsMin" INTEGER,
  ADD COLUMN "plannedRepsMax" INTEGER,
  ADD COLUMN "plannedRir" INTEGER;

ALTER TABLE "StrengthSessionExercise"
  ADD COLUMN "plannedRepsMin" INTEGER,
  ADD COLUMN "plannedRepsMax" INTEGER,
  ADD COLUMN "plannedRir" INTEGER;

ALTER TABLE "StrengthDiarySession"
  ADD COLUMN "sessionIntent" VARCHAR(32),
  ADD COLUMN "trainingBlockLabel" VARCHAR(80),
  ADD COLUMN "trainingWeekNumber" INTEGER;

ALTER TABLE "StrengthSet"
  ADD COLUMN "restBeforeSeconds" INTEGER;

ALTER TABLE "ProgramExercise"
  ADD CONSTRAINT "ProgramExercise_planned_reps_positive_check"
    CHECK (("plannedRepsMin" IS NULL OR "plannedRepsMin" > 0)
      AND ("plannedRepsMax" IS NULL OR "plannedRepsMax" > 0)
      AND ("plannedRepsMin" IS NULL OR "plannedRepsMax" IS NULL OR "plannedRepsMin" <= "plannedRepsMax")),
  ADD CONSTRAINT "ProgramExercise_planned_rir_check"
    CHECK ("plannedRir" IS NULL OR "plannedRir" BETWEEN 0 AND 10);

ALTER TABLE "StrengthSessionExercise"
  ADD CONSTRAINT "StrengthSessionExercise_planned_reps_positive_check"
    CHECK (("plannedRepsMin" IS NULL OR "plannedRepsMin" > 0)
      AND ("plannedRepsMax" IS NULL OR "plannedRepsMax" > 0)
      AND ("plannedRepsMin" IS NULL OR "plannedRepsMax" IS NULL OR "plannedRepsMin" <= "plannedRepsMax")),
  ADD CONSTRAINT "StrengthSessionExercise_planned_rir_check"
    CHECK ("plannedRir" IS NULL OR "plannedRir" BETWEEN 0 AND 10);

ALTER TABLE "StrengthDiarySession"
  ADD CONSTRAINT "StrengthDiarySession_session_intent_check"
    CHECK ("sessionIntent" IS NULL OR "sessionIntent" IN ('regular', 'easy-deload', 'strength', 'test', 'return-from-break')),
  ADD CONSTRAINT "StrengthDiarySession_training_week_number_check"
    CHECK ("trainingWeekNumber" IS NULL OR "trainingWeekNumber" BETWEEN 1 AND 52);

ALTER TABLE "StrengthSet"
  ADD CONSTRAINT "StrengthSet_rest_before_seconds_check"
    CHECK ("restBeforeSeconds" IS NULL OR "restBeforeSeconds" BETWEEN 0 AND 86400);
