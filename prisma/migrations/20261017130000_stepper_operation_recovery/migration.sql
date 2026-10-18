BEGIN;

ALTER TABLE "TrainingSourceChange"
  ADD COLUMN "affectedWorkoutIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

CREATE TABLE "StepperCreateOperation" (
  "profileId" INTEGER NOT NULL,
  "operationId" VARCHAR(36) NOT NULL,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payloadDigest" VARCHAR(64) NOT NULL,
  "workoutId" INTEGER,
  "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StepperCreateOperation_pkey" PRIMARY KEY ("profileId", "operationId"),
  CONSTRAINT "StepperCreateOperation_profileId_fkey" FOREIGN KEY ("profileId")
    REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StepperCreateOperation_payloadVersion_check" CHECK ("payloadVersion" = 1),
  CONSTRAINT "StepperCreateOperation_state_check" CHECK ("state" IN ('PENDING', 'COMMITTED', 'TOMBSTONED')),
  CONSTRAINT "StepperCreateOperation_result_check" CHECK (
    ("state" = 'PENDING' AND "workoutId" IS NULL)
    OR ("state" IN ('COMMITTED', 'TOMBSTONED') AND "workoutId" IS NOT NULL)
  )
);

CREATE INDEX "StepperCreateOperation_profileId_workoutId_idx"
  ON "StepperCreateOperation"("profileId", "workoutId");

COMMIT;
