import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";

const stableKeyMigrationPath = "prisma/migrations/20260917200000_add_exercise_catalog_stable_key/migration.sql";
const pullUpMigrationPath = "prisma/migrations/20260920190000_add_pull_up_exercise_catalog/migration.sql";
const fiveExerciseMigrationPath = "prisma/migrations/20261017120000_add_five_training_exercises/migration.sql";

describe("ExerciseCatalog stable-key migration contract", () => {
  const stableKeyMigration = readFileSync(stableKeyMigrationPath, "utf8");
  const pullUpMigration = readFileSync(pullUpMigrationPath, "utf8");
  const fiveExerciseMigration = readFileSync(fiveExerciseMigrationPath, "utf8");

  it("keeps the original stable-key migration additive", () => {
    expect(stableKeyMigration).toContain('ALTER TABLE "ExerciseCatalog" ADD COLUMN "stableKey" VARCHAR(80)');
    expect(stableKeyMigration).toContain('CREATE UNIQUE INDEX "ExerciseCatalog_profileId_stableKey_key"');
    expect(stableKeyMigration).toContain('catalog."profileId" = 1');
    expect(stableKeyMigration).toContain('catalog."stableKey" IS NULL');
    expect(stableKeyMigration).toContain("RAISE EXCEPTION 'ExerciseCatalog stableKey conflict for a canonical exercise'");
  });

  it("covers every canonical identity across immutable catalog migrations", () => {
    const canonicalCatalogMigrations = `${stableKeyMigration}\n${pullUpMigration}\n${fiveExerciseMigration}`;

    for (const exercise of CANONICAL_EXERCISE_IDENTITIES) {
      expect(canonicalCatalogMigrations).toContain(exercise.stableKey);
      expect(canonicalCatalogMigrations).toContain(exercise.displayName);
    }

    expect(pullUpMigration).toContain("'pull_up'");
    expect(pullUpMigration).toContain("'Підтягування на перекладині'");
  });

  it("does not rewrite historical training sources, sessions, sets, programs, or muscle snapshots", () => {
    const canonicalCatalogMigrations = `${stableKeyMigration}\n${pullUpMigration}\n${fiveExerciseMigration}`;
    expect(canonicalCatalogMigrations).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+"(?:Workout|StrengthDiarySession|StrengthSessionExercise|StrengthSet|TrainingProgram|TrainingProgramVersion|ProgramExercise)"/i);
    expect(canonicalCatalogMigrations).not.toMatch(/muscleMappingSnapshot/i);
    expect(canonicalCatalogMigrations).not.toMatch(/CREATE TABLE "ExerciseCatalog"/i);
  });

  it("fails closed before assigning canonical identity to a catalog row referenced by source history", () => {
    const nameLookup = fiveExerciseMigration.indexOf('AND "name" = exercise."name"\n     FOR UPDATE;');
    const referenceGuard = fiveExerciseMigration.indexOf('FROM "ProgramExercise" WHERE "exerciseCatalogId" = catalog_by_name_id');
    const sessionGuard = fiveExerciseMigration.indexOf('FROM "StrengthSessionExercise" WHERE "sourceExerciseCatalogId" = catalog_by_name_id');
    const identityUpdate = fiveExerciseMigration.indexOf('SET "stableKey" = exercise."stableKey", "isActive" = TRUE');
    expect(nameLookup).toBeGreaterThanOrEqual(0);
    expect(referenceGuard).toBeGreaterThan(nameLookup);
    expect(sessionGuard).toBeGreaterThan(referenceGuard);
    expect(identityUpdate).toBeGreaterThan(sessionGuard);
    expect(fiveExerciseMigration).toContain("ExerciseCatalog canonical identity migration requires an unreferenced legacy row");
    expect(fiveExerciseMigration).toMatch(/IF EXISTS\s*\([\s\S]*?\)\s*OR EXISTS\s*\([\s\S]*?\)\s*THEN\s*RAISE EXCEPTION/i);
  });
});
