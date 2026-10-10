import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_IMAGE_ID,
  bashAvailable,
  maintenanceRoute,
  createFixture,
  runFixture,
  appState,
} from "./helpers/production-release-cutover-fixture";

function prepareFixture(fixture: ReturnType<typeof createFixture>) {
  writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
  writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
  writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
  writeFileSync(path.join(fixture.root, "app-image-id"), `${CANDIDATE_IMAGE_ID}\n`);
  writeFileSync(path.join(fixture.root, "image-latest"), `${CANDIDATE_IMAGE_ID}\n`);
  writeFileSync(path.join(fixture.root, "app-status"), "healthy\n");
  const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
  writeFileSync(path.join(gitDir, "bodycast-production-schema-cutover"),
    `schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=${fixture.candidateSha}\nstate=app-ready\n`);
}

describe("production full-history recalculation cutover", () => {
  it("provides the isolated restore password required by encrypted backup rehearsal", () => {
    const workflow = readFileSync(new URL("../.github/workflows/production-full-history-recalculate.yml", import.meta.url), "utf8");
    const step = workflow.split("- name: Restore snapshot and rehearse full-history recalculation")[1]?.split("      - name:")[0] ?? "";
    expect(step).toContain("DATABASE_URL: postgresql://bodycast_restore:isolated_restore_test_password@127.0.0.1:5432/bodycast_restore");
    expect(step).toContain("PGPASSWORD: isolated_restore_test_password");
    expect(step).toContain("POSTGRES_IMAGE: public.ecr.aws/docker/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24");
    expect(step).toContain("node scripts/restore-encrypted-postgres-backup.mjs");
    expect(step).toContain("docker run --rm --network host");
  });

  it.skipIf(!bashAvailable)("recalculates under one lock, verifies V3 postflight, and restores the exact app behind maintenance", () => {
    const fixture = createFixture();
    prepareFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh full-history-recalculate", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(path.join(fixture.root, "lock-count"), "utf8").trim()).toBe("1");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const recalc = events.indexOf("full-history-recalculate");
    const v3 = events.indexOf("unified-v3-postflight");
    expect(recalc).toBeGreaterThan(-1);
    expect(v3).toBeGreaterThan(recalc);
    expect(events).not.toContain("unified-v4-activation");
    expect(events).not.toContain("live-route-mutation:serving");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(appState(fixture)).toMatchObject({ sha: fixture.candidateSha, status: "healthy", present: "true" });
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance and does not activate V4 when recalculation fails", () => {
    const fixture = createFixture();
    prepareFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh full-history-recalculate", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      FAIL_FULL_HISTORY_RECALCULATE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("full-history-recalculate");
    expect(events).not.toContain("unified-v4-activation");
    expect(events).not.toContain("live-route-mutation:serving");
    const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
    expect(readFileSync(path.join(gitDir, "bodycast-production-schema-cutover"), "utf8")).toContain("state=app-ready");
    expect(existsSync(path.join(fixture.root, "app-present"))).toBe(true);
  }, 30_000);
});
