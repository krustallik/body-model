import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashAvailable, createFixture, runFixture } from "./helpers/production-release-cutover-fixture";

describe("production database cutback final freshness fence", () => {
  it.skipIf(!bashAvailable)("rejects a main advance during final live DB identity check before the first rename", () => {
    const cutbackScript = readFileSync("scripts/production-database-cutback.sh", "utf8");
    const promotionHelper = readFileSync("scripts/production-database-cutback-promotion.sh", "utf8");
    const promotionInvocation = 'if bodycast_cutback_promote_databases "$stage_db" "$failed_db"; then';
    const firstPromotion = cutbackScript.indexOf(promotionInvocation);
    const finalIdentityGate = cutbackScript.lastIndexOf(
      'node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-live-identity',
      firstPromotion,
    );
    const finalLivePreflight = cutbackScript.lastIndexOf('APP_HOST=', finalIdentityGate);
    const freshnessFence = cutbackScript.indexOf(
      'bodycast_assert_current_main_sha "$CURRENT_MAIN_SHA"',
      finalIdentityGate,
    );
    const preflightSnippet = cutbackScript.slice(finalLivePreflight, finalIdentityGate);

    expect(finalLivePreflight).toBeGreaterThan(-1);
    expect(preflightSnippet).toContain('bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" > "$LIVE_REPORT"');
    expect(finalIdentityGate).toBeGreaterThan(finalLivePreflight);
    expect(freshnessFence).toBeGreaterThan(finalIdentityGate);
    expect(firstPromotion).toBeGreaterThan(freshnessFence);
    const afterFreshnessFence = cutbackScript
      .slice(freshnessFence + 'bodycast_assert_current_main_sha "$CURRENT_MAIN_SHA"'.length)
      .trimStart();
    expect(afterFreshnessFence).toMatch(/^if bodycast_cutback_promote_databases/);
    expect(promotionHelper.indexOf('admin_sql "ALTER DATABASE ${source_db} RENAME TO ${failed_db};"'))
      .toBeGreaterThanOrEqual(0);
    expect(promotionHelper.indexOf('admin_sql "ALTER DATABASE ${stage_db} RENAME TO ${source_db};"'))
      .toBeGreaterThanOrEqual(0);

    const fixture = createFixture();
    writeFileSync(path.join(fixture.repo, "scripts", "production-db-target.sh"), [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      'printf "%s\\n" final-live-db-identity-check >> "$EVENT_LOG"',
      '"$REAL_GIT" -C "$FIXTURE_REPO" push --quiet origin "$ADVANCE_SHA:refs/heads/main"',
      'printf "%s\\n" main-advanced-during-final-live-db-identity-check >> "$EVENT_LOG"',
      "cat <<'JSON'",
      '{"identity":{},"writerDrain":{"activeClientBackends":[],"topology":{"ready":true}}}',
      "JSON",
    ].join("\n"), { mode: 0o755 });
    writeFileSync(path.join(fixture.root, "bin", "node"), [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      'printf "%s\\n" live-identity-verifier >> "$EVENT_LOG"',
    ].join("\n"), { mode: 0o755 });
    writeFileSync(path.join(fixture.repo, "scripts", "production-database-cutback-promotion.sh"), promotionHelper);

    const exactCutbackGate = cutbackScript.slice(finalLivePreflight, firstPromotion);
    writeFileSync(path.join(fixture.repo, "scripts", "cutback-final-gate-fixture.sh"), [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      'ROOT_DIR="$FIXTURE_REPO"',
      'CURRENT_MAIN_SHA="$CANDIDATE_SHA"',
      'DB_CONTAINER="bodycast-db-prod"',
      'stage_db="bodycast_cutback_38022978032"',
      'failed_db="bodycast_failed_38022978032"',
      'CONTEXT_DIR="$FIXTURE_REPO/context"',
      'LIVE_REPORT="$FIXTURE_REPO/live-report.json"',
      'source "$ROOT_DIR/scripts/deploy-main-freshness.sh"',
      'source "$ROOT_DIR/scripts/production-database-cutback-promotion.sh"',
      'admin_sql() { printf "admin-sql:%s\\n" "$1" >> "$EVENT_LOG"; }',
      exactCutbackGate,
      'bodycast_cutback_promote_databases "$stage_db" "$failed_db"',
    ].join("\n"), { mode: 0o755 });

    const result = runFixture(fixture, "bash scripts/cutback-final-gate-fixture.sh");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing stale release SHA");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("final-live-db-identity-check");
    expect(events).toContain("main-advanced-during-final-live-db-identity-check");
    expect(events).toContain("live-identity-verifier");
    expect(events).toContain("canonical-main-fetch");
    expect(events).not.toContain("admin-sql:ALTER DATABASE bodycast RENAME TO bodycast_failed_");
  }, 30_000);
});
