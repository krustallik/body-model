-- Retrospective / historical Strength Diary editing.
-- entryMode LIVE|RETROSPECTIVE, nullable web timestamps, session revision,
-- session-exercise origin, explicit program-change audit.

ALTER TABLE "StrengthDiarySession"
  ADD COLUMN "entryMode" VARCHAR(20) NOT NULL DEFAULT 'LIVE',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "StrengthDiarySession"
  ALTER COLUMN "webStartedAt" DROP NOT NULL;

CREATE INDEX "StrengthDiarySession_profileId_entryMode_idx"
  ON "StrengthDiarySession"("profileId", "entryMode");

ALTER TABLE "StrengthSessionExercise"
  ADD COLUMN "origin" VARCHAR(20) NOT NULL DEFAULT 'PLANNED';

CREATE TABLE "StrengthDiaryProgramChange" (
  "id" SERIAL PRIMARY KEY,
  "sessionId" INTEGER NOT NULL,
  "fromProgramId" INTEGER NOT NULL,
  "fromProgramVersionId" INTEGER NOT NULL,
  "toProgramId" INTEGER NOT NULL,
  "toProgramVersionId" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StrengthDiaryProgramChange_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "StrengthDiarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StrengthDiaryProgramChange_sessionId_createdAt_idx"
  ON "StrengthDiaryProgramChange"("sessionId", "createdAt");
