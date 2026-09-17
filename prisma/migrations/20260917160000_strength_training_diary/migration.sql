-- Strength Training Diary domain + stable Workout.sourceIdentity reconciliation.
-- Also: ≤1 ACTIVE StrengthDiarySession per profile (partial unique index).

-- 1) Workout stable identity
ALTER TABLE "Workout" ADD COLUMN "sourceIdentity" VARCHAR(320);

UPDATE "Workout"
SET "sourceIdentity" = CASE
  WHEN "externalId" IS NOT NULL AND length(trim("externalId")) > 0
    THEN 'ext:' || trim("externalId")
  ELSE 'fp:' || "type" || '|' || to_char("startAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       || '|' || to_char("endAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
END
WHERE "sourceIdentity" IS NULL;

ALTER TABLE "Workout" ALTER COLUMN "sourceIdentity" SET NOT NULL;

CREATE UNIQUE INDEX "Workout_dailyHealthDataId_sourceIdentity_key"
  ON "Workout"("dailyHealthDataId", "sourceIdentity");

CREATE INDEX "Workout_externalId_idx" ON "Workout"("externalId");

-- 2) Exercise catalog
CREATE TABLE "ExerciseCatalog" (
  "id" SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL DEFAULT 1,
  "name" VARCHAR(200) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMPTZ(3),
  "muscleMapping" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ExerciseCatalog_profileId_name_key" ON "ExerciseCatalog"("profileId", "name");
CREATE INDEX "ExerciseCatalog_profileId_isActive_idx" ON "ExerciseCatalog"("profileId", "isActive");

INSERT INTO "ExerciseCatalog" ("profileId", "name", "isActive") VALUES
  (1, 'Жим гантелей на похилій лаві вгору (30°)', true),
  (1, 'Розведення гантелей на горизонтальній лаві', true),
  (1, 'Віджимання від ручок', true),
  (1, 'Жим гантелей сидячи', true),
  (1, 'Махи гантеллю однією рукою вбік', true),
  (1, 'Розгинання однієї руки в блоці', true),
  (1, 'Розгинання однієї руки з гантеллю в нахилі', true),
  (1, 'Тяга горизонтального блоку сидячи однією рукою', true),
  (1, 'Гіперекстензія', true),
  (1, 'Згинання однієї руки від коліна', true),
  (1, 'Згинання рук з розворотом сидячи на похилій лаві', true),
  (1, 'Згинання кисті з гантеллю в упорі', true);

-- 3) Training programs (create version table before program currentVersion FK)
CREATE TABLE "TrainingProgram" (
  "id" SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL DEFAULT 1,
  "name" VARCHAR(160) NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  "currentVersionId" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TrainingProgramVersion" (
  "id" SERIAL PRIMARY KEY,
  "programId" INTEGER NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingProgramVersion_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TrainingProgramVersion_programId_versionNumber_key"
  ON "TrainingProgramVersion"("programId", "versionNumber");
CREATE INDEX "TrainingProgramVersion_programId_idx" ON "TrainingProgramVersion"("programId");

ALTER TABLE "TrainingProgram"
  ADD CONSTRAINT "TrainingProgram_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "TrainingProgramVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TrainingProgram_currentVersionId_key" ON "TrainingProgram"("currentVersionId");
CREATE INDEX "TrainingProgram_profileId_archivedAt_idx" ON "TrainingProgram"("profileId", "archivedAt");

CREATE TABLE "ProgramExercise" (
  "id" SERIAL PRIMARY KEY,
  "programVersionId" INTEGER NOT NULL,
  "exerciseCatalogId" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "plannedSets" INTEGER NOT NULL,
  "resistanceType" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgramExercise_programVersionId_fkey"
    FOREIGN KEY ("programVersionId") REFERENCES "TrainingProgramVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgramExercise_exerciseCatalogId_fkey"
    FOREIGN KEY ("exerciseCatalogId") REFERENCES "ExerciseCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProgramExercise_programVersionId_sortOrder_key"
  ON "ProgramExercise"("programVersionId", "sortOrder");
CREATE INDEX "ProgramExercise_programVersionId_idx" ON "ProgramExercise"("programVersionId");
CREATE INDEX "ProgramExercise_exerciseCatalogId_idx" ON "ProgramExercise"("exerciseCatalogId");

-- 4) Diary sessions / sets
CREATE TABLE "StrengthDiarySession" (
  "id" SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL DEFAULT 1,
  "programId" INTEGER NOT NULL,
  "programVersionId" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "webStartedAt" TIMESTAMPTZ(3) NOT NULL,
  "webEndedAt" TIMESTAMPTZ(3),
  "matchedWorkoutId" INTEGER,
  "matchStatus" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "matchMethod" VARCHAR(20),
  "matchedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StrengthDiarySession_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StrengthDiarySession_programVersionId_fkey"
    FOREIGN KEY ("programVersionId") REFERENCES "TrainingProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StrengthDiarySession_matchedWorkoutId_fkey"
    FOREIGN KEY ("matchedWorkoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StrengthDiarySession_matchedWorkoutId_key"
  ON "StrengthDiarySession"("matchedWorkoutId");
CREATE INDEX "StrengthDiarySession_profileId_status_idx"
  ON "StrengthDiarySession"("profileId", "status");
CREATE INDEX "StrengthDiarySession_profileId_webStartedAt_idx"
  ON "StrengthDiarySession"("profileId", "webStartedAt");
CREATE INDEX "StrengthDiarySession_matchStatus_idx"
  ON "StrengthDiarySession"("matchStatus");

-- ENGINEERING: at most one ACTIVE diary session per profile (DB-enforced).
CREATE UNIQUE INDEX "StrengthDiarySession_one_active_per_profile"
  ON "StrengthDiarySession"("profileId")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "StrengthSessionExercise" (
  "id" SERIAL PRIMARY KEY,
  "sessionId" INTEGER NOT NULL,
  "sourceExerciseCatalogId" INTEGER,
  "snapshotExerciseName" VARCHAR(200) NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "plannedSets" INTEGER NOT NULL,
  "resistanceType" VARCHAR(32) NOT NULL,
  "muscleMappingSnapshot" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StrengthSessionExercise_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "StrengthDiarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StrengthSessionExercise_sourceExerciseCatalogId_fkey"
    FOREIGN KEY ("sourceExerciseCatalogId") REFERENCES "ExerciseCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StrengthSessionExercise_sessionId_sortOrder_key"
  ON "StrengthSessionExercise"("sessionId", "sortOrder");
CREATE INDEX "StrengthSessionExercise_sessionId_idx" ON "StrengthSessionExercise"("sessionId");

CREATE TABLE "StrengthSet" (
  "id" SERIAL PRIMARY KEY,
  "sessionExerciseId" INTEGER NOT NULL,
  "setNumber" INTEGER NOT NULL,
  "reps" INTEGER NOT NULL,
  "weightKg" DECIMAL(8, 2),
  "bandNominalResistanceKg" DECIMAL(8, 2),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StrengthSet_sessionExerciseId_fkey"
    FOREIGN KEY ("sessionExerciseId") REFERENCES "StrengthSessionExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StrengthSet_sessionExerciseId_setNumber_key"
  ON "StrengthSet"("sessionExerciseId", "setNumber");
CREATE INDEX "StrengthSet_sessionExerciseId_idx" ON "StrengthSet"("sessionExerciseId");
