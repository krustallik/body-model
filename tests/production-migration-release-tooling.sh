#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/production-migration-readiness.sh"
source "$ROOT/scripts/production-migration-summary.sh"

DEPLOY="$ROOT/scripts/deploy-migrate.sh"
WRAPPER="$ROOT/scripts/run-prisma-migrate-with-lock-timeout.mjs"
PREFLIGHT="$ROOT/.github/workflows/production-migration-preflight.yml"
MIGRATE="$ROOT/.github/workflows/production-migrate.yml"
grep -Fq 'fetch --no-tags --prune bodycast-canonical' "$DEPLOY"
grep -Fq -- '--before-ddl' "$DEPLOY"
grep -Fq -- '--after-ddl' "$DEPLOY"
grep -Fq 'BODYCAST_FINAL_GUARD_RECEIPT' "$DEPLOY"
grep -Fq 'execution-attestation.json' "$DEPLOY"
grep -Fq 'execution-key-certificate.json' "$DEPLOY"
grep -Fq 'BODYCAST_EXECUTION_KEY_CERTIFICATE' "$DEPLOY"
grep -Fq 'BODYCAST_DDL_ATTESTATION_NONCE_DIR' "$DEPLOY"
grep -Fq 'BODYCAST_EXECUTION_ATTESTATION_HANDOFF' "$DEPLOY"
grep -Fq 'BODYCAST_DDL_EXECUTION_CHALLENGE' "$DEPLOY"
grep -Fq 'verifyFinalGuardReceipt' "$WRAPPER"
grep -Fq 'verifyExecutionAttestation' "$WRAPPER"
grep -Fq 'assertPrismaTargetMatchesSignedIdentity' "$WRAPPER"
grep -Fq 'readLatestApplicablePreflightForDdl' "$WRAPPER"
grep -Fq 'delegationCertificate: delegation' "$WRAPPER"
grep -Fq 'withPrismaLockTimeout(databaseUrl, 5000)' "$WRAPPER"
! grep -Fq 'BODYCAST_FINAL_GUARD_READY' "$DEPLOY" "$WRAPPER"
! grep -Fq 'CONFIRM_PRODUCTION_MIGRATE' "$DEPLOY" "$WRAPPER"
grep -Fq 'environment: production-migration-authorization' "$MIGRATE"
grep -Fq 'npx prisma migrate deploy --schema prisma/schema.prisma' "$PREFLIGHT"
grep -Fq 'DATABASE_URL: postgresql://bodycast_restore:' "$PREFLIGHT"
grep -Fq 'production migration: NOT EXECUTED' "$PREFLIGHT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/read-stdin-and-fail" <<'COMMAND'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' 'synthetic child diagnostic' 'P1000: postgresql://bodycast:db-secret@db.example/bodycast PASSWORD=separate-secret' >&2
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
grep -Fq 'postgresql://[REDACTED]' "$TMP/child.diagnostics"
! grep -Fq 'db-secret' "$TMP/child.diagnostics"
! grep -Fq 'separate-secret' "$TMP/child.diagnostics"

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
