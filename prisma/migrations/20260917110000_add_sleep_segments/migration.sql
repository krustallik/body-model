-- Sleep segments are independent of DailyHealthData (no FK) so the 30-day
-- daily health prune cannot cascade-delete raw sleep source history.
CREATE TABLE "SleepSegment" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "rawState" VARCHAR(100) NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'shortcut',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SleepSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SleepSegment_profileId_startAt_endAt_state_key" ON "SleepSegment"("profileId", "startAt", "endAt", "state");
CREATE INDEX "SleepSegment_profileId_startAt_idx" ON "SleepSegment"("profileId", "startAt");
CREATE INDEX "SleepSegment_profileId_endAt_idx" ON "SleepSegment"("profileId", "endAt");
