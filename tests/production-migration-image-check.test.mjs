import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyMigrationImageFiles } from "../scripts/production-migration-image-check.mjs";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST } from "../scripts/production-migration-manifests.mjs";

const repositoryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createImageFixture() {
  const fixturePath = await mkdtemp(path.join(os.tmpdir(), "bodycast-migrator-image-"));
  await Promise.all([
    cp(path.join(repositoryPath, "prisma", "migrations"), path.join(fixturePath, "prisma", "migrations"), { recursive: true }),
    cp(path.join(repositoryPath, "scripts"), path.join(fixturePath, "scripts"), { recursive: true }),
  ]);
  for (const name of ["unified-v3-postflight.mjs", "unified-v4-activate-replay.mjs", "unified-v4-traffic-check.mjs"]) {
    await writeFile(path.join(fixturePath, "scripts", name), `// generated rollout fixture: ${name}\n${"x".repeat(300)}\n`);
  }
  for (const migration of ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations) {
    const relative = `prisma/migrations/${migration.name}/migration.sql`;
    const committedBytes = execFileSync("git", ["show", `HEAD:${relative}`], { cwd: repositoryPath, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(path.join(fixturePath, relative), committedBytes);
  }
  return fixturePath;
}

describe("production migrator image runtime closure", () => {
  it("loads the preflight, final-guard, and Prisma entrypoint dependency graphs", async () => {
    const fixturePath = await createImageFixture();
    try {
      const result = await verifyMigrationImageFiles(fixturePath);
      expect(result.authorizationRuntime.map(({ name }) => name)).toEqual([
        "production-db-preflight.mjs",
        "production-forward-resume.mjs",
        "production-migration-final-guard.mjs",
        "production-release-marker.mjs",
        "run-prisma-migrate-with-lock-timeout.mjs",
      ]);
    } finally {
      await rm(fixturePath, { recursive: true, force: true });
    }
  });

  it("fails closed when a linked owner-identity dependency is absent from the image", async () => {
    const fixturePath = await createImageFixture();
    try {
      await rm(path.join(fixturePath, "scripts", "github-owner-identity.mjs"));

      await expect(verifyMigrationImageFiles(fixturePath)).rejects.toThrow(/github-owner-identity\.mjs/);
    } finally {
      await rm(fixturePath, { recursive: true, force: true });
    }
  });

  it("copies identity and marker dependencies into the migrator image", async () => {
    const dockerfile = await readFile(path.join(repositoryPath, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("COPY scripts/github-owner-identity.mjs scripts/postgres-database-identity.mjs ./scripts/");
    expect(dockerfile).toContain("COPY scripts/production-forward-resume.mjs scripts/production-release-marker.mjs ./scripts/");
  });
});
