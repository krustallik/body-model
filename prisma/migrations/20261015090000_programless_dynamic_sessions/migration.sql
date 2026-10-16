-- Dynamic strength sessions are live diary entries without a program template.
-- Existing programmed and retrospective sessions keep their exact foreign keys.
ALTER TABLE "StrengthDiarySession"
  ALTER COLUMN "programId" DROP NOT NULL,
  ALTER COLUMN "programVersionId" DROP NOT NULL,
  ADD CONSTRAINT "StrengthDiarySession_program_pair_check"
    CHECK (("programId" IS NULL) = ("programVersionId" IS NULL));
