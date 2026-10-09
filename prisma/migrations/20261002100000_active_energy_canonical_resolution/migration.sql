CREATE TABLE "ActiveEnergyCanonicalEvent" (
  "id" SERIAL NOT NULL,
  "profileId" INTEGER NOT NULL DEFAULT 1,
  "logicalEventKey" VARCHAR(180) NOT NULL,
  "eventKind" VARCHAR(32) NOT NULL,
  "occurrenceAt" TIMESTAMPTZ(3) NOT NULL,
  "modelDate" VARCHAR(10) NOT NULL,
  "modelTimeZone" VARCHAR(100) NOT NULL,
  "inputFingerprint" VARCHAR(64) NOT NULL,
  "resolutionRevision" INTEGER NOT NULL DEFAULT 0,
  "isStale" BOOLEAN NOT NULL DEFAULT TRUE,
  "supersededByEventId" INTEGER,
  "currentResolutionFingerprint" VARCHAR(64),
  "currentSource" VARCHAR(40),
  "currentKcal" DOUBLE PRECISION,
  "currentProvenance" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ActiveEnergyCanonicalEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActiveEnergyCanonicalEvent_profile_key_key" UNIQUE ("profileId", "logicalEventKey"),
  CONSTRAINT "ActiveEnergyCanonicalEvent_superseded_by_fkey" FOREIGN KEY ("supersededByEventId") REFERENCES "ActiveEnergyCanonicalEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ActiveEnergyCanonicalEvent_revisions_nonnegative" CHECK ("resolutionRevision" >= 0),
  CONSTRAINT "ActiveEnergyCanonicalEvent_fingerprints_hex" CHECK (
    "inputFingerprint" ~ '^[0-9a-f]{64}$' AND
    ("currentResolutionFingerprint" IS NULL OR "currentResolutionFingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "ActiveEnergyCanonicalEvent_current_kcal_nonnegative" CHECK ("currentKcal" IS NULL OR ("currentKcal" >= 0 AND "currentKcal" < 'Infinity'::float8))
);
CREATE INDEX "ActiveEnergyCanonicalEvent_profile_date_idx" ON "ActiveEnergyCanonicalEvent"("profileId", "modelDate");
CREATE INDEX "ActiveEnergyCanonicalEvent_profile_occurrence_idx" ON "ActiveEnergyCanonicalEvent"("profileId", "occurrenceAt");
CREATE INDEX "ActiveEnergyCanonicalEvent_superseded_by_idx" ON "ActiveEnergyCanonicalEvent"("supersededByEventId");

CREATE TABLE "ActiveEnergyEventAlias" (
  "id" SERIAL NOT NULL,
  "profileId" INTEGER NOT NULL,
  "sourceType" VARCHAR(32) NOT NULL,
  "sourceId" VARCHAR(120) NOT NULL,
  "eventId" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workoutId" INTEGER,
  CONSTRAINT "ActiveEnergyEventAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActiveEnergyEventAlias_profile_source_key" UNIQUE ("profileId", "sourceType", "sourceId"),
  CONSTRAINT "ActiveEnergyEventAlias_event_fkey" FOREIGN KEY ("eventId") REFERENCES "ActiveEnergyCanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActiveEnergyEventAlias_workout_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ActiveEnergyEventAlias_event_idx" ON "ActiveEnergyEventAlias"("eventId");

CREATE TABLE "ActiveEnergyCandidate" (
  "id" SERIAL NOT NULL,
  "eventId" INTEGER NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "sourceIdentity" VARCHAR(180) NOT NULL,
  "sourceFingerprint" VARCHAR(64) NOT NULL,
  "availability" VARCHAR(20) NOT NULL,
  "valueKcal" DOUBLE PRECISION,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActiveEnergyCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActiveEnergyCandidate_event_fkey" FOREIGN KEY ("eventId") REFERENCES "ActiveEnergyCanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActiveEnergyCandidate_event_source_fingerprint_key" UNIQUE ("eventId", "source", "sourceIdentity", "sourceFingerprint"),
  CONSTRAINT "ActiveEnergyCandidate_availability_value_check" CHECK (("availability" = 'available' AND "valueKcal" IS NOT NULL AND "valueKcal" >= 0 AND "valueKcal" < 'Infinity'::float8) OR ("availability" = 'unavailable' AND "valueKcal" IS NULL)),
  CONSTRAINT "ActiveEnergyCandidate_fingerprint_hex" CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "ActiveEnergyCandidate_event_created_idx" ON "ActiveEnergyCandidate"("eventId", "createdAt");

CREATE TABLE "ActiveEnergyResolutionRevision" (
  "id" SERIAL NOT NULL,
  "eventId" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "resolutionFingerprint" VARCHAR(64) NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "valueKcal" DOUBLE PRECISION,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActiveEnergyResolutionRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActiveEnergyResolutionRevision_event_fkey" FOREIGN KEY ("eventId") REFERENCES "ActiveEnergyCanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActiveEnergyResolutionRevision_event_revision_key" UNIQUE ("eventId", "revision"),
  CONSTRAINT "ActiveEnergyResolutionRevision_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "ActiveEnergyResolutionRevision_fingerprint_hex" CHECK ("resolutionFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ActiveEnergyResolutionRevision_value_check" CHECK ("valueKcal" IS NULL OR ("valueKcal" >= 0 AND "valueKcal" < 'Infinity'::float8))
);
CREATE INDEX "ActiveEnergyResolutionRevision_event_fingerprint_idx" ON "ActiveEnergyResolutionRevision"("eventId", "resolutionFingerprint");
