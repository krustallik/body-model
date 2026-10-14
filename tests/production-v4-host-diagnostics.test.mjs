import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeV4HostFailureDiagnostics } from "../scripts/production-v4-recovery.mjs";

const activationWorkflow = readFileSync(new URL("../.github/workflows/activate-unified-v4-production.yml", import.meta.url), "utf8");
const cutoverScript = readFileSync(new URL("../scripts/production-traffic-cutover.sh", import.meta.url), "utf8");
const backupHostScript = readFileSync(new URL("../scripts/production-v4-post-ddl-backup-host.sh", import.meta.url), "utf8");

describe("sanitized V4 host failure diagnostics", () => {
  it("reports one allowlisted host phase and omits unrelated private stderr", () => {
    const summary = summarizeV4HostFailureDiagnostics([
      "private path /srv/bodycast/.git/sensitive.log",
      "BODYCAST_V4_BACKUP_FAILURE phase=snapshot-before-migration-postflight status=1",
      "DATABASE_URL=must-not-be-printed",
    ].join("\n"));

    expect(summary).toBe("backup=snapshot-before-migration-postflight/exit-1");
    expect(summary).not.toContain("private");
    expect(summary).not.toContain("DATABASE_URL");
  });

  it("combines the nested host gate with its remote command boundary", () => {
    expect(summarizeV4HostFailureDiagnostics([
      "BODYCAST_V4_BACKUP_FAILURE phase=pg-dump status=1",
      "BODYCAST_V4_REMOTE_FAILURE phase=backup-host status=1",
    ].join("\n"))).toBe("backup=pg-dump/exit-1 remote=backup-host/exit-1");
  });

  it("reports recovery failure using only the fixed cleanup phase", () => {
    expect(summarizeV4HostFailureDiagnostics("BODYCAST_V4_BACKUP_RECOVERY_FAILURE phase=app-restart status=1"))
      .toBe("recovery=app-restart/exit-1");
  });

  it("distinguishes cutover gates before entering the backup host script", () => {
    expect(summarizeV4HostFailureDiagnostics("BODYCAST_V4_CUTOVER_FAILURE phase=release-lock status=1"))
      .toBe("cutover=release-lock/exit-1");
    const cutoverPhases = [...cutoverScript.matchAll(/bodycast_v4_cutover_phase="([a-z-]+)"/g)].map((match) => match[1]);
    for (const phase of cutoverPhases) {
      expect(summarizeV4HostFailureDiagnostics(`BODYCAST_V4_CUTOVER_FAILURE phase=${phase} status=1`)).not.toMatch(/diagnostic=ambiguous/);
    }
  });

  it("keeps emitted phase codes allowlisted and the private log out of GitHub output", () => {
    const hostPhases = [...backupHostScript.matchAll(/bodycast_v4_failure_phase="([a-z-]+)"/g)].map((match) => match[1]);
    for (const label of ["before", "after", "boundary"]) {
      for (const suffix of [
        "database", "client-compatibility", "fingerprints", "writer-and-target", "database-preflight",
        "migration-postflight", "lifecycle", "snapshot-build", "schema-validation", "final-route-integrity",
      ]) hostPhases.push(`snapshot-${label}-${suffix}`);
    }
    hostPhases.push("snapshot-output", "backup-evidence-output");
    const cutoverPhases = [...cutoverScript.matchAll(/bodycast_v4_cutover_phase="([a-z-]+)"/g)].map((match) => match[1]);
    const remotePhases = [...activationWorkflow.matchAll(/BODYCAST_V4_REMOTE_PHASE=([a-z-]+)/g)].map((match) => match[1]);
    for (const phase of hostPhases) {
      expect(summarizeV4HostFailureDiagnostics(`BODYCAST_V4_BACKUP_FAILURE phase=${phase} status=1`)).not.toMatch(/diagnostic=ambiguous/);
    }
    for (const phase of remotePhases) {
      expect(summarizeV4HostFailureDiagnostics(`BODYCAST_V4_REMOTE_FAILURE phase=${phase} status=1`)).not.toMatch(/diagnostic=ambiguous/);
    }
    for (const phase of cutoverPhases) {
      expect(summarizeV4HostFailureDiagnostics(`BODYCAST_V4_CUTOVER_FAILURE phase=${phase} status=1`)).not.toMatch(/diagnostic=ambiguous/);
    }
    expect(activationWorkflow).toContain("umask 077");
    expect(activationWorkflow).toContain("install -m 600 /dev/null");
    expect(activationWorkflow).toContain("summarizeV4HostFailureDiagnostics");
    expect(activationWorkflow).not.toContain('cat "$RUNNER_TEMP/v4-post-ddl-host-stderr.log"');
    expect(backupHostScript).toContain('capture_snapshot before > "$tmp/snapshot-values-before.txt"');
    expect(backupHostScript).toContain('capture_snapshot after > "$tmp/snapshot-values-after.txt"');
    expect(backupHostScript).not.toContain('before_lines="$(capture_snapshot before)"');
    expect(backupHostScript).not.toContain('after_lines="$(capture_snapshot after)"');
  });

  it.each([
    "",
    "BODYCAST_V4_BACKUP_FAILURE phase=unknown-gate status=1",
    "BODYCAST_V4_BACKUP_FAILURE phase=pg-dump status=256",
    "BODYCAST_V4_BACKUP_FAILURE phase=pg-dump status=1 extra=secret",
    "BODYCAST_V4_BACKUP_FAILURE phase=pg-dump status=1\nBODYCAST_V4_BACKUP_FAILURE phase=app-stop status=1",
  ])("fails closed to a generic diagnostic for missing, malformed, or ambiguous markers", (log) => {
    expect(summarizeV4HostFailureDiagnostics(log)).toMatch(/^(?:diagnostic=unavailable|diagnostic=ambiguous)$/);
    expect(summarizeV4HostFailureDiagnostics(log)).not.toContain("secret");
  });
});
