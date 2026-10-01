#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/production-migration-readiness.sh"
source "$ROOT/scripts/production-migration-summary.sh"
grep -Fq '"Prisma migrate status" "$STATUS_LOG" "$STATUS_STDERR" /dev/null docker compose' "$ROOT/.github/workflows/production-migrate.yml"
grep -Fq '"build read-only migration status image" "$STEP_STDOUT" "$STEP_STDERR" /dev/null docker compose' "$ROOT/.github/workflows/production-migrate.yml"
grep -Fq 'run --interactive=false -T --rm --entrypoint npx migrate prisma migrate status' "$ROOT/.github/workflows/production-migrate.yml"
! grep -Fq -- '--no-tty' "$ROOT/.github/workflows/production-migrate.yml"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/read-stdin-and-fail" <<'COMMAND'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' 'synthetic child diagnostic' >&2
exit 7
COMMAND
chmod +x "$TMP/read-stdin-and-fail"

if bodycast_capture_subcommand "synthetic stdin-consuming child" "$TMP/child.out" "$TMP/child.err" /dev/null "$TMP/read-stdin-and-fail" > "$TMP/child.diagnostics" 2>&1; then
  echo "Expected synthetic child to fail." >&2
  exit 1
else
  CHILD_STATUS=$?
fi
[[ "$CHILD_STATUS" == "7" ]]
grep -Fq 'Production readiness subcommand: synthetic stdin-consuming child (exit code 7)' "$TMP/child.diagnostics"
grep -Fq 'synthetic child diagnostic' "$TMP/child.diagnostics"

if bash -s -- "$ROOT" "$TMP" > "$TMP/bash-s-stdin.log" 2>&1 <<'REMOTE'
set -Eeuo pipefail
source "$1/scripts/production-migration-readiness.sh"
if bodycast_capture_subcommand "child cannot consume bash -s program" "$2/nested.out" "$2/nested.err" /dev/null "$2/read-stdin-and-fail"; then
  CHILD_STATUS=0
else
  CHILD_STATUS=$?
fi
test "$CHILD_STATUS" -eq 7
printf '%s\n' 'SCRIPT_CONTINUED'
REMOTE
then
  :
else
  echo "The nested bash -s stdin isolation check failed." >&2
  cat "$TMP/bash-s-stdin.log" >&2
  exit 1
fi
grep -Fq 'SCRIPT_CONTINUED' "$TMP/bash-s-stdin.log"

cat > "$TMP/prisma-status.out" <<'STATUS'
Following migration(s) have not yet been applied:
20260929170000_training_load_accounting_v1
20260929190000_persist_strength_accounting_v1
STATUS
: > "$TMP/prisma-status.err"
bodycast_validate_expected_pending_prisma_status 1 "$TMP/prisma-status.out" "$TMP/prisma-status.err" > "$TMP/prisma-accepted.log"
grep -Fq 'Accepted Prisma exit code 1' "$TMP/prisma-accepted.log"

if bodycast_validate_expected_pending_prisma_status 2 "$TMP/prisma-status.out" "$TMP/prisma-status.err" 2> "$TMP/prisma-exit-two.log"; then
  echo "Expected Prisma exit code 2 to fail readiness." >&2
  exit 1
fi
grep -Fq 'must exit 0 or its documented pending-state code 1' "$TMP/prisma-exit-two.log"

printf '%s\n' 'P1000: cannot connect to postgresql://bodycast:db-secret@db.example/bodycast PASSWORD=separate-secret' > "$TMP/prisma-status.err"
if bodycast_validate_expected_pending_prisma_status 1 "$TMP/prisma-status.out" "$TMP/prisma-status.err" 2> "$TMP/prisma-rejected.log"; then
  echo "Expected Prisma engine error to fail readiness." >&2
  exit 1
fi
grep -Fq 'Prisma migrate status validation (exit code 1)' "$TMP/prisma-rejected.log"
grep -Fq 'postgresql://[REDACTED]' "$TMP/prisma-rejected.log"
! grep -Fq 'db-secret' "$TMP/prisma-rejected.log"
! grep -Fq 'separate-secret' "$TMP/prisma-rejected.log"

cat >> "$TMP/prisma-status.out" <<'STATUS'
20261001000000_unexpected_migration
STATUS
: > "$TMP/prisma-status.err"
if bodycast_validate_expected_pending_prisma_status 1 "$TMP/prisma-status.out" "$TMP/prisma-status.err" 2> "$TMP/prisma-extra-pending.log"; then
  echo "Expected an additional pending migration to fail readiness." >&2
  exit 1
fi
grep -Fq 'did not exactly match the authorized Stage 02 pair' "$TMP/prisma-extra-pending.log"

if [[ -n "${BODYCAST_TEST_DATABASE_URL:-}" ]]; then
  PRISMA_FIXTURE="$TMP/prisma-status"
  mkdir -p "$PRISMA_FIXTURE/migrations/20261001000000_gate_pending"
  cat > "$PRISMA_FIXTURE/schema.prisma" <<'SCHEMA'
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
generator client {
  provider = "prisma-client-js"
}
SCHEMA
  printf '%s\n' 'CREATE TABLE "ReleaseGateSmoke" ("id" TEXT PRIMARY KEY);' > "$PRISMA_FIXTURE/migrations/20261001000000_gate_pending/migration.sql"
  if DATABASE_URL="$BODYCAST_TEST_DATABASE_URL" "$ROOT/node_modules/.bin/prisma" migrate status --schema "$PRISMA_FIXTURE/schema.prisma" > "$TMP/prisma-real.out" 2> "$TMP/prisma-real.err"; then
    PRISMA_STATUS=0
  else
    PRISMA_STATUS=$?
  fi
  [[ "$PRISMA_STATUS" == "1" ]]
  grep -Fq '20261001000000_gate_pending' "$TMP/prisma-real.out"
  ! grep -Eq 'P[0-9]{4}|Error:' "$TMP/prisma-real.out" "$TMP/prisma-real.err"
  printf '%s\n' 'Disposable PostgreSQL confirmed Prisma migrate status exits 1 for a pending migration.'
fi

ARTIFACT_PROBE='bodycast-artifact-command-probe'
cat > "$TMP/$ARTIFACT_PROBE" <<'COMMAND'
#!/usr/bin/env bash
printf '%s\n' 'executed' > "$SUMMARY_PROBE_MARKER"
COMMAND
chmod +x "$TMP/$ARTIFACT_PROBE"
export PATH="$TMP:$PATH"
export SUMMARY_PROBE_MARKER="$TMP/artifact-command-was-executed"
SUMMARY_FILE="$TMP/summary.md"
bodycast_append_encrypted_backup_summary "$SUMMARY_FILE" "$ARTIFACT_PROBE" 12345
bodycast_append_production_readiness_summary "$SUMMARY_FILE" 0123456789012345678901234567890123456789 "$ARTIFACT_PROBE" https://github.com/example/artifact 12345
test ! -e "$SUMMARY_PROBE_MARKER"
EXPECTED_BACKUP_LINE='- artifact: `'"$ARTIFACT_PROBE"'`'
EXPECTED_FINAL_LINE='- backup artifact: [`'"$ARTIFACT_PROBE"'`](https://github.com/example/artifact)'
grep -Fq -- "$EXPECTED_BACKUP_LINE" "$SUMMARY_FILE"
grep -Fq -- "$EXPECTED_FINAL_LINE" "$SUMMARY_FILE"

printf '%s\n' 'Production migration release-tooling shell regressions passed.'
