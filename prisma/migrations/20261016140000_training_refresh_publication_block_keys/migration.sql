BEGIN;

ALTER TABLE "TrainingSourceChange"
  ADD COLUMN "publicationBlockSourceKeys" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[];

COMMIT;
