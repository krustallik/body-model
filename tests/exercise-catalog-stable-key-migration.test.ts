import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";

const stableKeyMigrationPath = "prisma/migrations/20260917200000_add_exercise_catalog_stable_key/migration.sql";
const pullUpMigrationPath = "prisma/migrations/20260920190000_add_pull_up_exercise_catalog/migration.sql";

describe("ExerciseCatalog stable-key migration contract", () => {
  const stableKeyMigration = readFileSync(stableKeyMigrationPath, "utf8");
  const pullUpMigration = readFileSync(pullUpMigrationPath, "utf8");

  it("keeps the original stable-key migration additive", () => {
    expect(stableKeyMigration).toContain('ALTER TABLE "ExerciseCatalog" ADD COLUMN "stableKey" VARCHAR(80)');
    expect(stableKeyMigration).toContain('CREATE UNIQUE INDEX "ExerciseCatalog_profileId_stableKey_key"');
    expect(stableKeyMigration).toContain('catalog."profileId" = 1');
    expect(stableKeyMigration).toContain('catalog."stableKey" IS NULL');
    expect(stableKeyMigration).toContain("RAISE EXCEPTION 'ExerciseCatalog stableKey conflict for a canonical exercise'");
  });

  it("covers every canonical identity across immutable catalog migrations", () => {
    const canonicalCatalogMigrations = `${stableKeyMigration}\n${pullUpMigration}`;

    for (const exercise of CANONICAL_EXERCISE_IDENTITIES) {
      expect(canonicalCatalogMigrations).toContain(exercise.stableKey);
      expect(canonicalCatalogMigrations).toContain(exercise.displayName);
    }

    expect(pullUpMigration).toContain("'pull_up'");
    expect(pullUpMigration).toContain("'Підтягування на перекладині'");
  });

  it("does not rewrite historical training sources, sessions, sets, programs, or muscle snapshots", () => {
    const canonicalCatalogMigrations = `${stableKeyMigration}\n${pullUpMigration}`;
    expect(canonicalCatalogMigrations).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+"(?:Workout|StrengthDiarySession|StrengthSessionExercise|StrengthSet|TrainingProgram|TrainingProgramVersion|ProgramExercise)"/i);
    expect(canonicalCatalogMigrations).not.toMatch(/muscleMappingSnapshot/i);
    expect(canonicalCatalogMigrations).not.toMatch(/CREATE TABLE "ExerciseCatalog"/i);
  });
});
