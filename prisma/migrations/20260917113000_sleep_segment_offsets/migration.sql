-- Preserve source wall-clock offsets so sleepDate attribution survives travel
-- and does not depend on a hardcoded IANA city timezone.
ALTER TABLE "SleepSegment" ADD COLUMN "startOffsetMinutes" INTEGER;
ALTER TABLE "SleepSegment" ADD COLUMN "endOffsetMinutes" INTEGER;
