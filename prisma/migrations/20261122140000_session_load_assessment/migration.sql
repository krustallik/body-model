-- Store a post-session answer separately from the pre-session training intent.
-- Nullable addition preserves all existing session rows without backfilling.
ALTER TABLE "StrengthDiarySession"
  ADD COLUMN "sessionLoadAssessment" VARCHAR(16);

ALTER TABLE "StrengthDiarySession"
  ADD CONSTRAINT "StrengthDiarySession_session_load_assessment_check"
    CHECK ("sessionLoadAssessment" IS NULL OR "sessionLoadAssessment" IN ('LIGHTER', 'NOT_LIGHTER'));
