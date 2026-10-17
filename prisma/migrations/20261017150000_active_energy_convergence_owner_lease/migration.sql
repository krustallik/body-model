-- A bounded owner lease distinguishes a live Active Energy convergence from
-- an orphaned fence. Null is treated as expired for fences created before
-- this additive migration, allowing safe restart recovery.
ALTER TABLE "UnifiedPublicationBlock"
  ADD COLUMN "ownerToken" VARCHAR(36),
  ADD COLUMN "ownerLeaseUntil" TIMESTAMPTZ(3);

CREATE INDEX "UnifiedPublicationBlock_ownerLeaseUntil_idx"
  ON "UnifiedPublicationBlock"("source", "ownerLeaseUntil");
