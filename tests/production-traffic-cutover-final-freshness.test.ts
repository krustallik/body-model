import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_IMAGE_ID,
  bashAvailable,
  createFixture,
  maintenanceRoute,
  runFixture,
} from "./helpers/production-release-cutover-fixture";

function prepareV4ActivationFixture(fixture: ReturnType<typeof createFixture>) {
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

describe("production V4 final freshness fence", () => {
  it.skipIf(!bashAvailable)("blocks V4 mutation when main advances during the final schema preflight", () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ON_FINAL_SCHEMA_PREFLIGHT: "1",
    });

    expect(result.status).not.toBe(0);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("schema-preflight-no-deps");
    expect(events).toContain("main-advanced");
    expect(events).toContain("unified-v3-postflight");
    expect(events).toContain("v3-postflight:final");
    expect(events).not.toContain("unified-v4-activation");
    expect(events).not.toContain("live-route-mutation:serving");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("fails closed without V4 mutation when final canonical-main fetch fails", () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      FAIL_CANONICAL_FETCH_AFTER_V3: "1",
    });

    expect(result.status).not.toBe(0);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("unified-v3-postflight");
    expect(events).toContain("v3-postflight:final");
    expect(events).toContain("canonical-main-fetch-failed");
    expect(events).not.toContain("unified-v4-activation");
    expect(events).not.toContain("live-route-mutation:serving");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);
});
