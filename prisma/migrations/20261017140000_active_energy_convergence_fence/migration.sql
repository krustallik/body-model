-- Permit the durable, source-scoped fence used while Active Energy feedback
-- candidates converge. Existing source values and rows remain unchanged.
ALTER TABLE "UnifiedPublicationBlock"
  DROP CONSTRAINT "UnifiedPublicationBlock_source_check";

ALTER TABLE "UnifiedPublicationBlock"
  ADD CONSTRAINT "UnifiedPublicationBlock_source_check"
  CHECK ("source" IN ('health', 'day', 'training', 'stepper', 'active_energy'));
