ALTER TABLE "Workout"
  ADD COLUMN "syncProtected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hiddenFromHistory" BOOLEAN NOT NULL DEFAULT false;
