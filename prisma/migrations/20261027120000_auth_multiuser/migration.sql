-- Fail before any DDL unless the required legacy owner row exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Profile" WHERE "id" = 1) THEN
    RAISE EXCEPTION 'auth multi-user transition requires existing Profile 1';
  END IF;
END $$;
-- DropForeignKey
ALTER TABLE "ActiveEnergyCandidate" DROP CONSTRAINT "ActiveEnergyCandidate_event_fkey";

-- DropForeignKey
ALTER TABLE "ActiveEnergyCanonicalEvent" DROP CONSTRAINT "ActiveEnergyCanonicalEvent_superseded_by_fkey";

-- DropForeignKey
ALTER TABLE "ActiveEnergyEventAlias" DROP CONSTRAINT "ActiveEnergyEventAlias_event_fkey";

-- DropForeignKey
ALTER TABLE "ActiveEnergyEventAlias" DROP CONSTRAINT "ActiveEnergyEventAlias_workout_fkey";

-- DropForeignKey
ALTER TABLE "ActiveEnergyResolutionRevision" DROP CONSTRAINT "ActiveEnergyResolutionRevision_event_fkey";

-- DropForeignKey
ALTER TABLE "ExerciseCatalog" DROP CONSTRAINT "ExerciseCatalog_currentLoadAccountingConfigId_fkey";

-- DropForeignKey
ALTER TABLE "ExerciseLoadConfiguration" DROP CONSTRAINT "ExerciseLoadConfiguration_exerciseCatalogId_fkey";

-- DropForeignKey
ALTER TABLE "HealthMetricSample" DROP CONSTRAINT "HealthMetricSample_dailyHealthDataId_fkey";

-- DropForeignKey
ALTER TABLE "HealthSyncSnapshot" DROP CONSTRAINT "HealthSyncSnapshot_dailyHealthDataId_fkey";

-- DropForeignKey
ALTER TABLE "HeartRateSample" DROP CONSTRAINT "HeartRateSample_dailyHealthDataId_fkey";

-- DropForeignKey
ALTER TABLE "ProgramExercise" DROP CONSTRAINT "ProgramExercise_exerciseCatalogId_fkey";

-- DropForeignKey
ALTER TABLE "ProgramExercise" DROP CONSTRAINT "ProgramExercise_programVersionId_fkey";

-- DropForeignKey
ALTER TABLE "RestingHeartRateSample" DROP CONSTRAINT "RestingHeartRateSample_dailyHealthDataId_fkey";

-- DropForeignKey
ALTER TABLE "StepperReconciliationCandidate" DROP CONSTRAINT "StepperReconciliationCandidate_garminWorkoutId_fkey";

-- DropForeignKey
ALTER TABLE "StepperReconciliationCandidate" DROP CONSTRAINT "StepperReconciliationCandidate_groupId_fkey";

-- DropForeignKey
ALTER TABLE "StepperReconciliationCandidate" DROP CONSTRAINT "StepperReconciliationCandidate_manualWorkoutId_fkey";

-- DropForeignKey
ALTER TABLE "StepperReconciliationGroup" DROP CONSTRAINT "StepperReconciliationGroup_provisionalWorkoutId_fkey";

-- DropForeignKey
ALTER TABLE "StrengthDiarySession" DROP CONSTRAINT "StrengthDiarySession_matchedWorkoutId_fkey";
ALTER TABLE "StrengthSessionExercise" DROP CONSTRAINT "StrengthSessionExercise_sessionId_fkey";
ALTER TABLE "StrengthSessionExercise" DROP CONSTRAINT "StrengthSessionExercise_sourceExerciseCatalogId_fkey";
ALTER TABLE "ExperimentalStrengthEnergyShadow" DROP CONSTRAINT "ExperimentalStrengthEnergyShadow_sessionId_fkey";
ALTER TABLE "ExperimentalStrengthGlycogenDemandShadow" DROP CONSTRAINT "ExperimentalStrengthGlycogenDemandShadow_sessionId_fkey";
ALTER TABLE "ExperimentalTransientExerciseWaterShadow" DROP CONSTRAINT "ExperimentalTransientExerciseWaterShadow_sessionId_fkey";
ALTER TABLE "ExperimentalStepperActiveEnergyShadow" DROP CONSTRAINT "ExperimentalStepperActiveEnergyShadow_workoutId_fkey";
ALTER TABLE "ExperimentalStepperGlycogenDemandShadow" DROP CONSTRAINT "ExperimentalStepperGlycogenDemandShadow_workoutId_fkey";

-- DropForeignKey
ALTER TABLE "StrengthDiarySession" DROP CONSTRAINT "StrengthDiarySession_programId_fkey";

-- DropForeignKey
ALTER TABLE "StrengthDiarySession" DROP CONSTRAINT "StrengthDiarySession_programVersionId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProgram" DROP CONSTRAINT "TrainingProgram_currentVersionId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProgramVersion" DROP CONSTRAINT "TrainingProgramVersion_programId_fkey";

-- DropForeignKey
ALTER TABLE "UnifiedExperimentalPhysiologyStateV2" DROP CONSTRAINT "UnifiedExperimentalPhysiologyStateV2_modelEpisodeId_fkey";

-- DropForeignKey
ALTER TABLE "Workout" DROP CONSTRAINT "Workout_dailyHealthDataId_fkey";

-- DropForeignKey
ALTER TABLE "Workout" DROP CONSTRAINT "Workout_supersededByWorkoutId_fkey";

-- DropIndex
DROP INDEX "ActiveEnergyCandidate_event_created_idx";

-- DropIndex
ALTER TABLE "ActiveEnergyCandidate" DROP CONSTRAINT "ActiveEnergyCandidate_event_source_fingerprint_key";

-- DropIndex
DROP INDEX "ActiveEnergyResolutionRevision_event_fingerprint_idx";

-- DropIndex
ALTER TABLE "ActiveEnergyResolutionRevision" DROP CONSTRAINT "ActiveEnergyResolutionRevision_event_revision_key";

-- DropIndex
DROP INDEX "DailyHealthData_date_key";

-- DropIndex
DROP INDEX "ExerciseLoadConfiguration_exerciseCatalogId_configVersion_key";

-- DropIndex
DROP INDEX "HealthActivityInterval_sourceFingerprint_key";

-- DropIndex
DROP INDEX "HealthMetricSample_metric_timestamp_key";

-- DropIndex
DROP INDEX "ProgramExercise_programVersionId_sortOrder_key";

-- DropIndex
DROP INDEX "StepperReconciliationCandidate_garminWorkoutId_idx";

-- DropIndex
DROP INDEX "StepperReconciliationCandidate_groupId_idx";

-- DropIndex
DROP INDEX "StepperReconciliationCandidate_manualWorkoutId_garminWorkoutId_";

-- DropIndex
DROP INDEX "StrengthDiarySession_matchedWorkoutId_key";

-- DropIndex
DROP INDEX "TrainingProgram_currentVersionId_key";

-- DropIndex
DROP INDEX "TrainingProgramVersion_programId_versionNumber_key";

-- DropIndex
DROP INDEX "UnifiedPublicationBlock_ownerLeaseUntil_idx";

-- DropIndex
DROP INDEX "Workout_dailyHealthDataId_sourceIdentity_key";

-- AlterTable
ALTER TABLE "ActivationRollbackEntry" ADD COLUMN "profileId" INTEGER;
UPDATE "ActivationRollbackEntry" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "ActivationRollbackEntry" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ActiveEnergyCandidate" ADD COLUMN "profileId" INTEGER;
UPDATE "ActiveEnergyCandidate" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "ActiveEnergyCandidate" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ActiveEnergyCanonicalEvent" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ActiveEnergyResolutionRevision" ADD COLUMN "profileId" INTEGER;
UPDATE "ActiveEnergyResolutionRevision" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "ActiveEnergyResolutionRevision" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "DailyHealthData" ADD COLUMN "profileId" INTEGER;
UPDATE "DailyHealthData" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "DailyHealthData" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ExerciseCatalog" ALTER COLUMN "profileId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExerciseLoadConfiguration" ADD COLUMN "profileId" INTEGER;
UPDATE "ExerciseLoadConfiguration" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "ExerciseLoadConfiguration" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ExperimentalCessationDetrainingShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalFatWeightUncertaintyShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalFfmRetentionShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalGlycogenAssociatedWaterShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalGlycogenRepletionShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalGlycogenStateShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalLocalHypertrophyResponseShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalSkeletalMuscleDeltaShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalStepperActiveEnergyShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalStepperGlycogenDemandShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalStrengthEnergyShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalStrengthGlycogenDemandShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExperimentalTransientExerciseWaterShadow" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FatWeightShadowV1Result" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HealthActivityInterval" ADD COLUMN "profileId" INTEGER;
UPDATE "HealthActivityInterval" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "HealthActivityInterval" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "HealthMetricSample" ADD COLUMN "profileId" INTEGER;
UPDATE "HealthMetricSample" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "HealthMetricSample" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "HealthSyncAudit" ADD COLUMN     "profileId" INTEGER;

-- AlterTable
ALTER TABLE "HealthSyncRefreshJob" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HealthSyncSnapshot" ADD COLUMN "profileId" INTEGER;
UPDATE "HealthSyncSnapshot" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "HealthSyncSnapshot" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "HeartRateSample" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ModelEpisode" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PhysiologyV7DailyResult" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PhysiologyV7ShadowDiagnostic" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Profile" DROP CONSTRAINT IF EXISTS "Profile_singleton_check";
CREATE SEQUENCE profile_id_seq;
ALTER TABLE "Profile" ADD COLUMN     "userId" VARCHAR(36),
ALTER COLUMN "id" SET DEFAULT nextval('profile_id_seq'),
ALTER COLUMN "sex" DROP NOT NULL,
ALTER COLUMN "dateOfBirth" DROP NOT NULL,
ALTER COLUMN "heightCm" DROP NOT NULL;
ALTER SEQUENCE profile_id_seq OWNED BY "Profile"."id";
SELECT setval('profile_id_seq', GREATEST(COALESCE((SELECT MAX("id") FROM "Profile"), 1), 1), true);

-- AlterTable
ALTER TABLE "ProgramExercise" ADD COLUMN "profileId" INTEGER;
UPDATE "ProgramExercise" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "ProgramExercise" ALTER COLUMN "profileId" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RestingHeartRateSample" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SleepSegment" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StepperEquipmentAssignment" ALTER COLUMN "profileId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StepperReconciliationCandidate" ADD COLUMN "profileId" INTEGER;
UPDATE "StepperReconciliationCandidate" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "StepperReconciliationCandidate" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "StepperReconciliationGroup" ALTER COLUMN "profileId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StrengthDiarySession" ALTER COLUMN "profileId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StrengthSessionExercise" ADD COLUMN "profileId" INTEGER;
UPDATE "StrengthSessionExercise" AS exercise
SET "profileId" = session."profileId"
FROM "StrengthDiarySession" AS session
WHERE session."id" = exercise."sessionId";
ALTER TABLE "StrengthSessionExercise" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "StrengthSessionAccountingOperation" ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StrengthSessionExercise" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StrengthSet" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TrainingProgram" ALTER COLUMN "profileId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TrainingProgramVersion" ADD COLUMN "profileId" INTEGER;
UPDATE "TrainingProgramVersion" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "TrainingProgramVersion" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "UnifiedExperimentalPhysiologyState" ALTER COLUMN "profileId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UnifiedExperimentalPhysiologyStateV2" ALTER COLUMN "profileId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UnifiedPublicationBlock" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WorkInterval" ADD COLUMN "profileId" INTEGER;
UPDATE "WorkInterval" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "WorkInterval" ALTER COLUMN "profileId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN "profileId" INTEGER;
UPDATE "Workout" SET "profileId" = 1 WHERE "profileId" IS NULL;
ALTER TABLE "Workout" ALTER COLUMN "profileId" SET NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" VARCHAR(36) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" VARCHAR(255),
    "userAgent" VARCHAR(500),
    "userId" VARCHAR(36) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" VARCHAR(36) NOT NULL,
    "accountId" VARCHAR(255) NOT NULL,
    "providerId" VARCHAR(100) NOT NULL,
    "userId" VARCHAR(36) NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" VARCHAR(36) NOT NULL,
    "identifier" VARCHAR(320) NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileApiKey" (
    "id" VARCHAR(36) NOT NULL,
    "profileId" INTEGER NOT NULL,
    "lookupId" VARCHAR(24) NOT NULL,
    "secretHash" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProfileApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRateLimitBucket" (
    "bucketKey" VARCHAR(64) NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "windowStart" BIGINT NOT NULL,

    CONSTRAINT "AuthRateLimitBucket_pkey" PRIMARY KEY ("bucketKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileApiKey_lookupId_key" ON "ProfileApiKey"("lookupId");

-- CreateIndex
CREATE INDEX "ProfileApiKey_profileId_revokedAt_idx" ON "ProfileApiKey"("profileId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuthRateLimitBucket_windowStart_idx" ON "AuthRateLimitBucket"("windowStart");

-- CreateIndex
CREATE INDEX "ActiveEnergyCandidate_profileId_eventId_createdAt_idx" ON "ActiveEnergyCandidate"("profileId", "eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveEnergyCandidate_profileId_eventId_source_sourceIdenti_key" ON "ActiveEnergyCandidate"("profileId", "eventId", "source", "sourceIdentity", "sourceFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveEnergyCanonicalEvent_profileId_id_key" ON "ActiveEnergyCanonicalEvent"("profileId", "id");

-- CreateIndex
CREATE INDEX "ActiveEnergyResolutionRevision_profileId_eventId_resolution_idx" ON "ActiveEnergyResolutionRevision"("profileId", "eventId", "resolutionFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveEnergyResolutionRevision_profileId_eventId_revision_key" ON "ActiveEnergyResolutionRevision"("profileId", "eventId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "DailyHealthData_profileId_id_key" ON "DailyHealthData"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DailyHealthData_profileId_date_key" ON "DailyHealthData"("profileId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseCatalog_profileId_id_key" ON "ExerciseCatalog"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseCatalog_profileId_currentLoadAccountingConfigId_key" ON "ExerciseCatalog"("profileId", "currentLoadAccountingConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseLoadConfiguration_profileId_id_key" ON "ExerciseLoadConfiguration"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseLoadConfiguration_profileId_exerciseCatalogId_confi_key" ON "ExerciseLoadConfiguration"("profileId", "exerciseCatalogId", "configVersion");

-- CreateIndex
CREATE UNIQUE INDEX "HealthActivityInterval_profileId_sourceFingerprint_key" ON "HealthActivityInterval"("profileId", "sourceFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "HealthMetricSample_profileId_metric_timestamp_key" ON "HealthMetricSample"("profileId", "metric", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ModelEpisode_profileId_id_key" ON "ModelEpisode"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramExercise_profileId_id_key" ON "ProgramExercise"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramExercise_profileId_programVersionId_sortOrder_key" ON "ProgramExercise"("profileId", "programVersionId", "sortOrder");

-- CreateIndex
CREATE INDEX "StepperReconciliationCandidate_profileId_groupId_idx" ON "StepperReconciliationCandidate"("profileId", "groupId");

-- CreateIndex
CREATE INDEX "StepperReconciliationCandidate_profileId_garminWorkoutId_idx" ON "StepperReconciliationCandidate"("profileId", "garminWorkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "StepperReconciliationCandidate_profileId_id_key" ON "StepperReconciliationCandidate"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StepperReconciliationCandidate_profileId_manualWorkoutId_ga_key" ON "StepperReconciliationCandidate"("profileId", "manualWorkoutId", "garminWorkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "StepperReconciliationGroup_profileId_id_key" ON "StepperReconciliationGroup"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StrengthDiarySession_id_currentSnapshotRevision_key" ON "StrengthDiarySession"("id", "currentSnapshotRevision");

-- CreateIndex
CREATE UNIQUE INDEX "StrengthDiarySession_profileId_id_key" ON "StrengthDiarySession"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StrengthDiarySession_profileId_matchedWorkoutId_key" ON "StrengthDiarySession"("profileId", "matchedWorkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "StrengthSessionExercise_profileId_id_key" ON "StrengthSessionExercise"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgram_profileId_id_key" ON "TrainingProgram"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgram_profileId_currentVersionId_key" ON "TrainingProgram"("profileId", "currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgramVersion_profileId_id_key" ON "TrainingProgramVersion"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgramVersion_profileId_programId_versionNumber_key" ON "TrainingProgramVersion"("profileId", "programId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Workout_profileId_id_key" ON "Workout"("profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Workout_profileId_dailyHealthDataId_sourceIdentity_key" ON "Workout"("profileId", "dailyHealthDataId", "sourceIdentity");

-- Composite source keys back the profile-aware one-to-one shadow foreign keys.
CREATE UNIQUE INDEX "ExperimentalStrengthEnergyShadow_profileId_sessionId_key" ON "ExperimentalStrengthEnergyShadow"("profileId", "sessionId");
CREATE UNIQUE INDEX "ExperimentalStrengthGlycogenDemandShadow_profileId_sessionI_key" ON "ExperimentalStrengthGlycogenDemandShadow"("profileId", "sessionId");
CREATE UNIQUE INDEX "ExperimentalTransientExerciseWaterShadow_profileId_sessionI_key" ON "ExperimentalTransientExerciseWaterShadow"("profileId", "sessionId");
CREATE UNIQUE INDEX "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_key" ON "ExperimentalStepperActiveEnergyShadow"("profileId", "workoutId");
CREATE UNIQUE INDEX "ExperimentalStepperGlycogenDemandShadow_profileId_workoutId_key" ON "ExperimentalStepperGlycogenDemandShadow"("profileId", "workoutId");

-- RenameForeignKey
ALTER TABLE "StrengthDiarySession" RENAME CONSTRAINT "StrengthDiarySession_current_snapshot_fkey" TO "StrengthDiarySession_id_currentSnapshotRevision_fkey";

-- RenameForeignKey
ALTER TABLE "StrengthSessionAccountingOperation" RENAME CONSTRAINT "StrengthSessionAccountingOperation_result_snapshot_fkey" TO "StrengthSessionAccountingOperation_sessionId_resultSnapsho_fkey";

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyHealthData" ADD CONSTRAINT "DailyHealthData_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthMetricSample" ADD CONSTRAINT "HealthMetricSample_profileId_dailyHealthDataId_fkey" FOREIGN KEY ("profileId", "dailyHealthDataId") REFERENCES "DailyHealthData"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthMetricSample" ADD CONSTRAINT "HealthMetricSample_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartRateSample" ADD CONSTRAINT "HeartRateSample_profileId_dailyHealthDataId_fkey" FOREIGN KEY ("profileId", "dailyHealthDataId") REFERENCES "DailyHealthData"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartRateSample" ADD CONSTRAINT "HeartRateSample_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestingHeartRateSample" ADD CONSTRAINT "RestingHeartRateSample_profileId_dailyHealthDataId_fkey" FOREIGN KEY ("profileId", "dailyHealthDataId") REFERENCES "DailyHealthData"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestingHeartRateSample" ADD CONSTRAINT "RestingHeartRateSample_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SleepSegment" ADD CONSTRAINT "SleepSegment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSyncSnapshot" ADD CONSTRAINT "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey" FOREIGN KEY ("profileId", "dailyHealthDataId") REFERENCES "DailyHealthData"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSyncSnapshot" ADD CONSTRAINT "HealthSyncSnapshot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSyncAudit" ADD CONSTRAINT "HealthSyncAudit_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthActivityInterval" ADD CONSTRAINT "HealthActivityInterval_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_profileId_dailyHealthDataId_fkey" FOREIGN KEY ("profileId", "dailyHealthDataId") REFERENCES "DailyHealthData"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_profileId_supersededByWorkoutId_fkey" FOREIGN KEY ("profileId", "supersededByWorkoutId") REFERENCES "Workout"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseCatalog" ADD CONSTRAINT "ExerciseCatalog_profileId_currentLoadAccountingConfigId_fkey" FOREIGN KEY ("profileId", "currentLoadAccountingConfigId") REFERENCES "ExerciseLoadConfiguration"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseCatalog" ADD CONSTRAINT "ExerciseCatalog_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseLoadConfiguration" ADD CONSTRAINT "ExerciseLoadConfiguration_profileId_exerciseCatalogId_fkey" FOREIGN KEY ("profileId", "exerciseCatalogId") REFERENCES "ExerciseCatalog"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseLoadConfiguration" ADD CONSTRAINT "ExerciseLoadConfiguration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_profileId_currentVersionId_fkey" FOREIGN KEY ("profileId", "currentVersionId") REFERENCES "TrainingProgramVersion"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgramVersion" ADD CONSTRAINT "TrainingProgramVersion_profileId_programId_fkey" FOREIGN KEY ("profileId", "programId") REFERENCES "TrainingProgram"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgramVersion" ADD CONSTRAINT "TrainingProgramVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramExercise" ADD CONSTRAINT "ProgramExercise_profileId_programVersionId_fkey" FOREIGN KEY ("profileId", "programVersionId") REFERENCES "TrainingProgramVersion"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramExercise" ADD CONSTRAINT "ProgramExercise_profileId_exerciseCatalogId_fkey" FOREIGN KEY ("profileId", "exerciseCatalogId") REFERENCES "ExerciseCatalog"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramExercise" ADD CONSTRAINT "ProgramExercise_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrengthDiarySession" ADD CONSTRAINT "StrengthDiarySession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrengthDiarySession" ADD CONSTRAINT "StrengthDiarySession_profileId_programId_fkey" FOREIGN KEY ("profileId", "programId") REFERENCES "TrainingProgram"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrengthDiarySession" ADD CONSTRAINT "StrengthDiarySession_profileId_programVersionId_fkey" FOREIGN KEY ("profileId", "programVersionId") REFERENCES "TrainingProgramVersion"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrengthDiarySession" ADD CONSTRAINT "StrengthDiarySession_profileId_matchedWorkoutId_fkey" FOREIGN KEY ("profileId", "matchedWorkoutId") REFERENCES "Workout"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrengthSessionExercise" ADD CONSTRAINT "StrengthSessionExercise_profileId_sessionId_fkey" FOREIGN KEY ("profileId", "sessionId") REFERENCES "StrengthDiarySession"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrengthSessionExercise" ADD CONSTRAINT "StrengthSessionExercise_profileId_sourceExerciseCatalogId_fkey" FOREIGN KEY ("profileId", "sourceExerciseCatalogId") REFERENCES "ExerciseCatalog"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrengthSessionExercise" ADD CONSTRAINT "StrengthSessionExercise_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalStrengthEnergyShadow" ADD CONSTRAINT "ExperimentalStrengthEnergyShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentalStrengthEnergyShadow" ADD CONSTRAINT "ExperimentalStrengthEnergyShadow_profileId_sessionId_fkey" FOREIGN KEY ("profileId", "sessionId") REFERENCES "StrengthDiarySession"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalStrengthGlycogenDemandShadow" ADD CONSTRAINT "ExperimentalStrengthGlycogenDemandShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentalStrengthGlycogenDemandShadow" ADD CONSTRAINT "ExperimentalStrengthGlycogenDemandShadow_profileId_session_fkey" FOREIGN KEY ("profileId", "sessionId") REFERENCES "StrengthDiarySession"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalTransientExerciseWaterShadow" ADD CONSTRAINT "ExperimentalTransientExerciseWaterShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentalTransientExerciseWaterShadow" ADD CONSTRAINT "ExperimentalTransientExerciseWaterShadow_profileId_session_fkey" FOREIGN KEY ("profileId", "sessionId") REFERENCES "StrengthDiarySession"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalStepperActiveEnergyShadow" ADD CONSTRAINT "ExperimentalStepperActiveEnergyShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentalStepperActiveEnergyShadow" ADD CONSTRAINT "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_fkey" FOREIGN KEY ("profileId", "workoutId") REFERENCES "Workout"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalStepperGlycogenDemandShadow" ADD CONSTRAINT "ExperimentalStepperGlycogenDemandShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentalStepperGlycogenDemandShadow" ADD CONSTRAINT "ExperimentalStepperGlycogenDemandShadow_profileId_workoutI_fkey" FOREIGN KEY ("profileId", "workoutId") REFERENCES "Workout"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkInterval" ADD CONSTRAINT "WorkInterval_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysiologyV7DailyResult" ADD CONSTRAINT "PhysiologyV7DailyResult_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysiologyV7Lifecycle" ADD CONSTRAINT "PhysiologyV7Lifecycle_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysiologyV7ShadowDiagnostic" ADD CONSTRAINT "PhysiologyV7ShadowDiagnostic_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatWeightShadowV1Result" ADD CONSTRAINT "FatWeightShadowV1Result_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalFatWeightUncertaintyShadow" ADD CONSTRAINT "ExperimentalFatWeightUncertaintyShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalGlycogenRepletionShadow" ADD CONSTRAINT "ExperimentalGlycogenRepletionShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalGlycogenAssociatedWaterShadow" ADD CONSTRAINT "ExperimentalGlycogenAssociatedWaterShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalGlycogenStateShadow" ADD CONSTRAINT "ExperimentalGlycogenStateShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalSkeletalMuscleDeltaShadow" ADD CONSTRAINT "ExperimentalSkeletalMuscleDeltaShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalLocalHypertrophyResponseShadow" ADD CONSTRAINT "ExperimentalLocalHypertrophyResponseShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalCessationDetrainingShadow" ADD CONSTRAINT "ExperimentalCessationDetrainingShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentalFfmRetentionShadow" ADD CONSTRAINT "ExperimentalFfmRetentionShadow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnifiedExperimentalPhysiologyStateV2" ADD CONSTRAINT "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisod_fkey" FOREIGN KEY ("profileId", "modelEpisodeId") REFERENCES "ModelEpisode"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepperReconciliationGroup" ADD CONSTRAINT "StepperReconciliationGroup_profileId_provisionalWorkoutId_fkey" FOREIGN KEY ("profileId", "provisionalWorkoutId") REFERENCES "Workout"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepperReconciliationGroup" ADD CONSTRAINT "StepperReconciliationGroup_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepperReconciliationCandidate" ADD CONSTRAINT "StepperReconciliationCandidate_profileId_groupId_fkey" FOREIGN KEY ("profileId", "groupId") REFERENCES "StepperReconciliationGroup"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepperReconciliationCandidate" ADD CONSTRAINT "StepperReconciliationCandidate_profileId_manualWorkoutId_fkey" FOREIGN KEY ("profileId", "manualWorkoutId") REFERENCES "Workout"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepperReconciliationCandidate" ADD CONSTRAINT "StepperReconciliationCandidate_profileId_garminWorkoutId_fkey" FOREIGN KEY ("profileId", "garminWorkoutId") REFERENCES "Workout"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepperReconciliationCandidate" ADD CONSTRAINT "StepperReconciliationCandidate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRollbackEntry" ADD CONSTRAINT "ActivationRollbackEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyCanonicalEvent" ADD CONSTRAINT "ActiveEnergyCanonicalEvent_profileId_supersededByEventId_fkey" FOREIGN KEY ("profileId", "supersededByEventId") REFERENCES "ActiveEnergyCanonicalEvent"("profileId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyCanonicalEvent" ADD CONSTRAINT "ActiveEnergyCanonicalEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyEventAlias" ADD CONSTRAINT "ActiveEnergyEventAlias_profileId_eventId_fkey" FOREIGN KEY ("profileId", "eventId") REFERENCES "ActiveEnergyCanonicalEvent"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyEventAlias" ADD CONSTRAINT "ActiveEnergyEventAlias_profileId_workoutId_fkey" FOREIGN KEY ("profileId", "workoutId") REFERENCES "Workout"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyEventAlias" ADD CONSTRAINT "ActiveEnergyEventAlias_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyCandidate" ADD CONSTRAINT "ActiveEnergyCandidate_profileId_eventId_fkey" FOREIGN KEY ("profileId", "eventId") REFERENCES "ActiveEnergyCanonicalEvent"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyCandidate" ADD CONSTRAINT "ActiveEnergyCandidate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyResolutionRevision" ADD CONSTRAINT "ActiveEnergyResolutionRevision_profileId_eventId_fkey" FOREIGN KEY ("profileId", "eventId") REFERENCES "ActiveEnergyCanonicalEvent"("profileId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveEnergyResolutionRevision" ADD CONSTRAINT "ActiveEnergyResolutionRevision_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileApiKey" ADD CONSTRAINT "ProfileApiKey_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ActiveEnergyCanonicalEvent_profile_date_idx" RENAME TO "ActiveEnergyCanonicalEvent_profileId_modelDate_idx";

-- RenameIndex
ALTER INDEX "ActiveEnergyCanonicalEvent_profile_key_key" RENAME TO "ActiveEnergyCanonicalEvent_profileId_logicalEventKey_key";

-- RenameIndex
ALTER INDEX "ActiveEnergyCanonicalEvent_profile_occurrence_idx" RENAME TO "ActiveEnergyCanonicalEvent_profileId_occurrenceAt_idx";

-- RenameIndex
ALTER INDEX "ActiveEnergyCanonicalEvent_superseded_by_idx" RENAME TO "ActiveEnergyCanonicalEvent_supersededByEventId_idx";

-- RenameIndex
ALTER INDEX "ActiveEnergyEventAlias_event_idx" RENAME TO "ActiveEnergyEventAlias_eventId_idx";

-- RenameIndex
ALTER INDEX "ActiveEnergyEventAlias_profile_source_key" RENAME TO "ActiveEnergyEventAlias_profileId_sourceType_sourceId_key";

-- RenameIndex
ALTER INDEX "ExperimentalGlycogenAssociatedWaterShadow_profileId_updatedAt_i" RENAME TO "ExperimentalGlycogenAssociatedWaterShadow_profileId_updated_idx";

-- RenameIndex
ALTER INDEX "ExperimentalLocalHypertrophyResponseShadow_profileId_updatedAt_" RENAME TO "ExperimentalLocalHypertrophyResponseShadow_profileId_update_idx";

-- RenameIndex
ALTER INDEX "ExperimentalLocalHypertrophyResponseShadow_profileId_weekStartD" RENAME TO "ExperimentalLocalHypertrophyResponseShadow_profileId_weekSt_key";

-- RenameIndex
ALTER INDEX "ExperimentalStrengthGlycogenDemandShadow_profileId_updatedAt_id" RENAME TO "ExperimentalStrengthGlycogenDemandShadow_profileId_updatedA_idx";

-- RenameIndex
ALTER INDEX "ExperimentalTransientExerciseWaterShadow_profileId_updatedAt_id" RENAME TO "ExperimentalTransientExerciseWaterShadow_profileId_updatedA_idx";

-- RenameIndex
ALTER INDEX "ModelRecoveryRun_episodeId_algorithmVersion_seed_configFingerpr" RENAME TO "ModelRecoveryRun_episodeId_algorithmVersion_seed_configFing_key";

-- RenameIndex
ALTER INDEX "StepperEquipmentAssignment_profileId_effectiveFrom_effectiveTo_" RENAME TO "StepperEquipmentAssignment_profileId_effectiveFrom_effectiv_idx";

-- RenameIndex
ALTER INDEX "StrengthSessionAccountingOperation_session_key_key" RENAME TO "StrengthSessionAccountingOperation_sessionId_idempotencyKey_key";

-- RenameIndex
ALTER INDEX "StrengthSessionAccountingOperation_session_status_created_idx" RENAME TO "StrengthSessionAccountingOperation_sessionId_status_created_idx";

-- RenameIndex
ALTER INDEX "StrengthSessionAccountingSnapshot_session_fingerprint_idx" RENAME TO "StrengthSessionAccountingSnapshot_sessionId_inputFingerprin_idx";

-- RenameIndex
ALTER INDEX "StrengthSessionAccountingSnapshot_session_input_revision_idx" RENAME TO "StrengthSessionAccountingSnapshot_sessionId_accountingInput_idx";

-- RenameIndex
ALTER INDEX "StrengthSessionAccountingSnapshot_session_revision_key" RENAME TO "StrengthSessionAccountingSnapshot_sessionId_snapshotRevisio_key";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyState_profileId_modelRevision_upda" RENAME TO "UnifiedExperimentalPhysiologyState_profileId_modelRevision__idx";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyState_profileId_qualityStatus_date" RENAME TO "UnifiedExperimentalPhysiologyState_profileId_qualityStatus__idx";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyState_profileId_resultFingerprint_" RENAME TO "UnifiedExperimentalPhysiologyState_profileId_resultFingerpr_idx";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_b" RENAME TO "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_idx";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_d" RENAME TO "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_key";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevision_up" RENAME TO "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevisio_idx";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatus_bo" RENAME TO "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatu_idx";

-- RenameIndex
ALTER INDEX "UnifiedExperimentalPhysiologyStateV2_profileId_resultFingerprin" RENAME TO "UnifiedExperimentalPhysiologyStateV2_profileId_resultFinger_idx";


