import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8").replace(/\r\n/g, "\n");
const deployGate = readFileSync(resolve("scripts/ci/production-deploy-gate.ts"), "utf8").replace(/\r\n/g, "\n");
const deploy = readFileSync(resolve("scripts/deploy.sh"), "utf8").replace(/\r\n/g, "\n");
const cutover = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8").replace(/\r\n/g, "\n");
const recoveredRelease = readFileSync(resolve("scripts/production-v4-recovered-release.sh"), "utf8").replace(/\r\n/g, "\n");
const recovery = readFileSync(resolve("scripts/production-v4-derived-recovery.mjs"), "utf8").replace(/\r\n/g, "\n");

describe("recovered V4 serving release contract", () => {
  it("requires a distinct owner dispatch and exact current-main CI before selecting recovered-V4 mode", () => {
    expect(workflow).toContain("serve_recovered_v4:");
    expect(workflow).toContain('CONFIRMATION" == "serve-after-current-v4-recovery"');
    expect(workflow).toContain('"$NON_SERVING" == "false"');
    expect(workflow).toContain('recoveredV4Serve: process.env.SERVE_RECOVERED_V4 === "true"');
    expect(workflow).toContain("CI_RUN_URL=\"$(CANDIDATE=\"$CANDIDATE\"");
    expect(deployGate).toContain('input.dispatchConfirm !== "serve-after-current-v4-recovery"');
    expect(deployGate).toContain('mode: freshEmptyInstall ? "fresh-empty-install" : recoveredV4Serve ? "recovered-v4-serving" : "non-serving"');
  });

  it("stages the exact app behind maintenance and invokes only the existing atomic Training serve path", () => {
    const deployCall = workflow.indexOf("BODYCAST_NON_SERVING_DEPLOY=1 BODYCAST_RECOVERED_V4_SERVE=1 bash scripts/deploy.sh");
    const cutoverCall = workflow.indexOf("BODYCAST_RECOVERED_V4_SERVE=1 bash scripts/production-traffic-cutover.sh serve");
    expect(deployCall).toBeGreaterThan(-1);
    expect(cutoverCall).toBeGreaterThan(deployCall);
    expect(workflow).toContain('"$SSH_HOST" == "169.58.239.149"');
    expect(workflow).toContain('"$APP_HOST" == "bodycast.ihorhub.eu"');
    expect(deploy).toContain('"$BODYCAST_RECOVERED_V4_SERVE" == "1" && "$BODYCAST_NON_SERVING_DEPLOY" != "1"');
    expect(deploy).toContain('bodycast_assert_completed_v4_recovery_for_release "$DEPLOY_SHA"');
    expect(deploy).toContain('the Training atomic V4 serve fence remains the only route to traffic');
    expect(cutover).toContain("--hold-currentness-fence");
    expect(cutover).toContain('publish_candidate_route "" "" "" "$staged_route" true "$fence_pid" true true');
    expect(cutover).toContain('if [[ "$require_absent_marker" == "true" ]]');
    expect(cutover).toContain('Exact recovered V4 release is serving under the atomic currentness fence; the terminal recovery marker is retained.');
  });

  it("binds serving to the completed recovery marker, current 74-row schema ledger, and unchanged schema/source evidence", () => {
    expect(recovery).toContain('marker.state !== "completed" || marker.result !== "current"');
    expect(recoveredRelease).toContain('--production-schema-postflight');
    expect(recoveredRelease).toContain('migration_count" == "74"');
    expect(recoveredRelease).toContain("bodycast_recovery_raw_fingerprint_from_marker_image");
    expect(recoveredRelease).toContain("sha256sum \"$archive\"");
    expect(recoveredRelease).toContain("/app/dist/production-v4-recovery-evidence.mjs");
    expect(recoveredRelease).toContain('git -C "$ROOT_DIR" rev-parse "$release_sha^"');
    expect(recoveredRelease).toContain('git -C "$ROOT_DIR" rev-list --count "$marker_workflow_sha..$release_sha"');
    expect(recovery).toContain("assertRecoveredV4ToolingOnlyDescendant");
    expect(recoveredRelease).toContain("production-v4-schema-digest.mjs");
    expect(recoveredRelease).toContain("unified-v4-traffic-check.mjs --profile-id 1");
    expect(recoveredRelease).not.toContain("prisma migrate deploy");
    expect(deploy).not.toContain("prisma migrate deploy");
  });
});
