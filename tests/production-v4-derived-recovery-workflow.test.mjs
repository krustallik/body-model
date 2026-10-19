import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/production-v4-derived-recovery.yml", import.meta.url), "utf8");
const host = readFileSync(new URL("../scripts/production-v4-derived-recovery-host.sh", import.meta.url), "utf8");
const image = readFileSync(new URL("../Dockerfile.v4-derived-recovery", import.meta.url), "utf8");
const evidence = readFileSync(new URL("../scripts/production-v4-recovery-evidence.ts", import.meta.url), "utf8");

describe("legacy derived V4 recovery release workflow", () => {
  it("is manual-only, pinned to the owner, current main, and protected production environment", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^  (push|pull_request|workflow_run|schedule):/m);
    expect(workflow.match(/environment: production/g)).toHaveLength(2);
    expect(workflow).toContain("github.actor_id == '126446430'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toMatch(/\[\[ "\$DISPATCH_SHA" == "\$GITHUB_SHA"/);
    expect(workflow).toContain("main-ci.ndjson");
    expect(workflow).toContain("Recheck exact owner approval, current main, and legacy CI immediately before execution");
    expect(workflow).toContain("RECOVER_UNIFIED_V4_FROM_PERSISTED_SOURCES_PROFILE_1_AT_3968154f965597843b6a2c429fff178c0f1ac54c");
    expect(workflow).toContain("needs.rehearse.result == 'success'");
  });

  it("requires the exact audited legacy SHA, 65-schema manifest, and derived-only entrypoint", () => {
    expect(workflow).toContain("3968154f965597843b6a2c429fff178c0f1ac54c");
    expect(workflow).toContain("291b9c95924e196d66f9cdd555535b2e5a2b5990");
    expect(workflow).toContain("4fa84cb62262986d5f0c58d3c76db2ba52b5500e");
    expect(workflow).toContain("a4153cad028db966759935cb997b15ac3c6f1670dfc9ebd8a114f6b9520746a7");
    expect(workflow).toContain("node /app/dist/production-v4-recovery-evidence.mjs");
    expect(workflow).not.toMatch(/docker run[^\n]*migrate deploy[^\n]*bodycast-db-prod/);
    expect(workflow).not.toContain("docker compose up");
    expect(workflow).not.toContain("production-traffic-cutover");
    expect(host).toContain("node /app/dist/production-v4-recovery-evidence.mjs");
    expect(image).toContain("/app/dist/production-full-history-recalculate.mjs");
    expect(image).toContain("--derived-v4-recovery");
    expect(host).not.toContain("migrate deploy");
    expect(host).not.toContain("docker compose");
  });

  it("requires a restore rehearsal, serializes on the shared production lock, and makes attempts terminal", () => {
    expect(workflow).toContain("Restore backup and rehearse exact image against isolated 65-schema PostgreSQL");
    expect(workflow).toContain("PRODUCTION_BACKUP_ENCRYPTION_KEY");
    expect(workflow).toContain("BACKUP_FILE: ${{ runner.temp }}/bodycast-v4-artifact/production-backup.pgdump.enc");
    expect(workflow).toContain("migrationLedgerDigest(before.migrationRows) !== ledger");
    expect(host).toContain("bodycast-production-release.lock");
    expect(host).toContain("flock -n 9");
    expect(host).toContain('state: "started"');
    expect(host).toContain("terminal-failed");
    expect(host).toContain("recovery-failed-no-retry");
    expect(host).toContain("production-container-identity-changed-during-recovery");
    expect(host).toContain("schema-changed-during-recovery");
    expect(host).toContain('after.lifecycle?.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"');
    expect(host).toContain("after.lifecycle?.unifiedPublicationBlockedFromDate !== null");
    expect(evidence).toContain('isolationLevel: "RepeatableRead"');
  });

  it("never replaces the serving app and targets only the known production checkout", () => {
    expect(host).toContain('[[ "${BODYCAST_DEPLOY_PATH:-}" == "/srv/bodycast" ]]');
    expect(host).toContain("docker run --rm --network \"$network\"");
    expect(host).not.toContain("docker stop");
    expect(host).not.toContain("docker restart");
    expect(host).not.toContain("docker compose");
    expect(host).not.toContain("prisma migrate");
    expect(host).toContain("serverAddress");
    expect(host).toContain("serverPort !== 5432");
    expect(evidence).toContain("persistedDayDates");
    expect(evidence).toContain("coveredDayDates");
    expect(workflow).not.toMatch(/^\s+run:.*docker (compose )?(up|restart|stop)/m);
  });
});
