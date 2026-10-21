import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigrationTree, verifyFreshMigrationLedger } from "../scripts/production-empty-install-ledger.mjs";

const migration = { name: "20260101000000_first", checksum: "a".repeat(64) };
const applied = [{ name: migration.name, checksum: migration.checksum, finishedAt: new Date(), rolledBackAt: null }];
const emptyCounts = { DailyHealthData: 0, Workout: 0, StrengthDiarySession: 0 };

describe("fresh empty-install migration verification", () => {
  it("accepts every exact successful migration on an empty profile/source database", () => {
    expect(verifyFreshMigrationLedger({ migrations: [migration], rows: applied, profileCount: 0, sourceCounts: emptyCounts }))
      .toMatchObject({ migrationCount: 1, profileCount: 0, sourceCounts: emptyCounts });
  });

  it.each([
    ["missing migration", [], /missing or duplicated/],
    ["duplicate migration", [...applied, ...applied], /missing or duplicated/],
    ["unreviewed migration", [...applied, { ...applied[0], name: "20260102000000_extra" }], /absent from the exact release tree/],
    ["changed checksum", [{ ...applied[0], checksum: "b".repeat(64) }], /checksum differs/],
    ["incomplete migration", [{ ...applied[0], finishedAt: null }], /incomplete or rolled back/],
    ["rolled-back migration", [{ ...applied[0], rolledBackAt: new Date() }], /incomplete or rolled back/],
  ])("fails closed for %s", (_name, rows, expected) => {
    expect(() => verifyFreshMigrationLedger({ migrations: [migration], rows, profileCount: 0, sourceCounts: emptyCounts }))
      .toThrow(expected);
  });

  it("rejects a non-empty user profile or raw source table", () => {
    expect(() => verifyFreshMigrationLedger({ migrations: [migration], rows: applied, profileCount: 1, sourceCounts: emptyCounts }))
      .toThrow(/user profile/);
    expect(() => verifyFreshMigrationLedger({ migrations: [migration], rows: applied, profileCount: 0, sourceCounts: { ...emptyCounts, Workout: 1 } }))
      .toThrow(/pre-existing Workout rows/);
  });

  it("hashes the complete migration tree and agrees with the repository's current 74-directory snapshot", async () => {
    const tree = await readMigrationTree(resolve("prisma/migrations"));
    expect(tree.migrations).toHaveLength(74);
    const expected = createHash("sha256");
    for (const item of tree.migrations) {
      const sql = await readFile(resolve("prisma/migrations", item.name, "migration.sql"));
      expect(createHash("sha256").update(sql).digest("hex")).toBe(item.checksum);
      expected.update(`${item.name}\t${item.checksum}\n`);
    }
    expect(tree.digest).toBe(expected.digest("hex"));
  });
});
