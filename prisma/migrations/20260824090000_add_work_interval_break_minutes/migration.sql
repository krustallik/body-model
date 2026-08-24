ALTER TABLE "WorkInterval"
ADD COLUMN "breakMinutes" INTEGER;

ALTER TABLE "WorkInterval"
ADD CONSTRAINT "WorkInterval_break_within_interval"
CHECK (
  "breakMinutes" IS NULL
  OR (
    "breakMinutes" >= 0
    AND "breakMinutes" < EXTRACT(EPOCH FROM ("endAt" - "startAt")) / 60
  )
);
