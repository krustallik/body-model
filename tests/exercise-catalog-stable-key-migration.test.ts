import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";

const migrationPath = "prisma/migrations/20260917200000_add_exercise_catalog_stable_key/migration.sql";

describe("ExerciseCatalog stable-key migration contract", () => {
  const migration = readFileSync(migrationPath, "utf8");

  it("is additive and only backfills the exact canonical catalog rows", () => {
    expect(migration).toContain('ALTER TABLE "ExerciseCatalog" ADD COLUMN "stableKey" VARCHAR(80)');
    expect(migration).toContain('CREATE UNIQUE INDEX "ExerciseCatalog_profileId_stableKey_key"');
    expect(migration).toContain('catalog."profileId" = 1');
    expect(migration).toContain('catalog."stableKey" IS NULL');
    expect(migration).toContain("RAISE EXCEPTION 'ExerciseCatalog stableKey conflict for a canonical exercise'");

    for (const exercise of CANONICAL_EXERCISE_IDENTITIES) {
      expect(migration).toContain(exercise.stableKey);
      expect(migration).toContain(exercise.displayName);
    }
  });

  it("does not rewrite historical training sources, sessions, sets, programs, or muscle snapshots", () => {
    expect(migration).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+"(?:Workout|StrengthDiarySession|StrengthSessionExercise|StrengthSet|TrainingProgram|TrainingProgramVersion|ProgramExercise)"/i);
    expect(migration).not.toMatch(/muscleMappingSnapshot/i);
    expect(migration).not.toMatch(/CREATE TABLE "ExerciseCatalog"/i);
  });
});
