-- REJECTED is a durable terminal state for an idempotency key whose first
-- request was definitively rejected before creating a source set. This
-- follow-up is additive because the ledger migration may already be applied.
BEGIN;

ALTER TABLE "TrainingSetCreateOperation"
  DROP CONSTRAINT "TrainingSetCreateOperation_state_check";

ALTER TABLE "TrainingSetCreateOperation"
  ADD CONSTRAINT "TrainingSetCreateOperation_state_check"
  CHECK ("state" IN ('PENDING', 'COMMITTED', 'TOMBSTONED', 'REJECTED'));

ALTER TABLE "TrainingSetCreateOperation"
  DROP CONSTRAINT "TrainingSetCreateOperation_result_check";

ALTER TABLE "TrainingSetCreateOperation"
  ADD CONSTRAINT "TrainingSetCreateOperation_result_check"
  CHECK (
    ("state" IN ('PENDING', 'REJECTED') AND "canonicalSetId" IS NULL)
    OR ("state" IN ('COMMITTED', 'TOMBSTONED') AND "canonicalSetId" IS NOT NULL)
  );

COMMIT;
