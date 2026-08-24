CREATE TABLE "ModelUnknownInterval" (
    "id" SERIAL NOT NULL,
    "episodeId" INTEGER NOT NULL,
    "startDate" VARCHAR(10) NOT NULL,
    "lastUnknownDate" VARCHAR(10) NOT NULL,
    "endDate" VARCHAR(10),
    "anchorDate" VARCHAR(10),
    "firstPostGapObservationDate" VARCHAR(10),
    "postGapObservedDayCount" INTEGER NOT NULL DEFAULT 0,
    "postGapObservationDates" JSONB NOT NULL DEFAULT '[]',
    "missingTransitionFields" JSONB NOT NULL,
    "recoveryRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ModelUnknownInterval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModelUnknownInterval_date_check" CHECK (
      "startDate" ~ '^\d{4}-\d{2}-\d{2}$'
      AND "lastUnknownDate" ~ '^\d{4}-\d{2}-\d{2}$'
      AND ("endDate" IS NULL OR "endDate" ~ '^\d{4}-\d{2}-\d{2}$')
      AND ("anchorDate" IS NULL OR "anchorDate" ~ '^\d{4}-\d{2}-\d{2}$')
      AND ("firstPostGapObservationDate" IS NULL
        OR "firstPostGapObservationDate" ~ '^\d{4}-\d{2}-\d{2}$')
    ),
    CONSTRAINT "ModelUnknownInterval_order_check" CHECK (
      "lastUnknownDate" >= "startDate"
      AND ("endDate" IS NULL OR "endDate" = "lastUnknownDate")
      AND ("anchorDate" IS NULL OR "anchorDate" < "startDate")
      AND ("firstPostGapObservationDate" IS NULL
        OR "firstPostGapObservationDate" > "lastUnknownDate")
    ),
    CONSTRAINT "ModelUnknownInterval_observation_count_check" CHECK (
      "postGapObservedDayCount" >= 0
    ),
    CONSTRAINT "ModelUnknownInterval_recovery_required_check" CHECK (
      "recoveryRequired" = true
    )
);

CREATE UNIQUE INDEX "ModelUnknownInterval_episodeId_startDate_key"
ON "ModelUnknownInterval"("episodeId", "startDate");

CREATE INDEX "ModelUnknownInterval_episodeId_startDate_idx"
ON "ModelUnknownInterval"("episodeId", "startDate");

CREATE INDEX "ModelUnknownInterval_episodeId_endDate_idx"
ON "ModelUnknownInterval"("episodeId", "endDate");

ALTER TABLE "ModelUnknownInterval"
ADD CONSTRAINT "ModelUnknownInterval_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "ModelEpisode"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
