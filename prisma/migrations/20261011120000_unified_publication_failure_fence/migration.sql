ALTER TABLE "PhysiologyV7Lifecycle"
  ADD COLUMN "unifiedPublicationBlockedFromDate" VARCHAR(10),
  ADD COLUMN "unifiedPublicationBlockedSource" VARCHAR(20);

CREATE TABLE "UnifiedPublicationBlock" (
  "profileId" INTEGER NOT NULL,
  "source" VARCHAR(20) NOT NULL,
  "sourceKey" VARCHAR(100) NOT NULL,
  "fromDate" VARCHAR(10) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnifiedPublicationBlock_pkey" PRIMARY KEY ("profileId", "source", "sourceKey"),
  CONSTRAINT "UnifiedPublicationBlock_source_check" CHECK ("source" IN ('health', 'day', 'training', 'stepper')),
  CONSTRAINT "UnifiedPublicationBlock_sourceKey_check" CHECK (length("sourceKey") > 0),
  CONSTRAINT "UnifiedPublicationBlock_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UnifiedPublicationBlock_profileId_fromDate_idx"
  ON "UnifiedPublicationBlock" ("profileId", "fromDate");
