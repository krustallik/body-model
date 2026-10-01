#!/usr/bin/env bash
# Shared fail-closed diagnostics for the manual production migration gate.

bodycast_sanitize_readiness_output() {
  sed -E \
    -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED]#Ig' \
    -e 's#("?[A-Za-z_]*(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|ENCRYPTION_KEY|DATABASE_URL|CONNECTION_STRING)[A-Za-z_]*"?[[:space:]]*[:=][[:space:]]*"?)[^",}[:space:]]+#\1[REDACTED]#Ig'
}

bodycast_report_readiness_failure() {
  local step_name="$1"
  local exit_code="$2"
  local stdout_file="$3"
  local stderr_file="$4"
  local reason="$5"

  printf 'Production readiness diagnostic: %s (exit code %s)\n' "$step_name" "$exit_code" >&2
  if [[ -n "$reason" ]]; then printf 'Reason: %s\n' "$reason" >&2; fi
  printf '%s\n' 'Sanitized stdout:' >&2
  if [[ -s "$stdout_file" ]]; then bodycast_sanitize_readiness_output < "$stdout_file" >&2; else printf '%s\n' '(empty)' >&2; fi
  printf '%s\n' 'Sanitized stderr:' >&2
  if [[ -s "$stderr_file" ]]; then bodycast_sanitize_readiness_output < "$stderr_file" >&2; else printf '%s\n' '(empty)' >&2; fi
}

bodycast_capture_subcommand() {
  local step_name="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local stdin_file="$4"
  shift 4

  local exit_code
  if "$@" < "$stdin_file" > "$stdout_file" 2> "$stderr_file"; then
    exit_code=0
  else
    exit_code=$?
  fi

  printf 'Production readiness subcommand: %s (exit code %s)\n' "$step_name" "$exit_code"
  if (( exit_code == 0 )); then
    bodycast_sanitize_readiness_output < "$stdout_file"
    bodycast_sanitize_readiness_output < "$stderr_file" >&2
  else
    bodycast_report_readiness_failure "$step_name" "$exit_code" "$stdout_file" "$stderr_file" ""
  fi
  return "$exit_code"
}

bodycast_validate_expected_pending_prisma_status() {
  local exit_code="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local combined_file
  local actual_file
  local expected_file
  combined_file="$(mktemp)"
  actual_file="$(mktemp)"
  expected_file="$(mktemp)"
  cat "$stdout_file" "$stderr_file" > "$combined_file"

  local reason=""
  if (( exit_code != 0 && exit_code != 1 )); then
    reason="Prisma migrate status must exit 0 or its documented pending-state code 1."
  elif ! grep -Eqi 'Following migration|have not yet been applied' "$combined_file"; then
    reason="Prisma output did not identify a pending migration state."
  elif grep -Eqi 'failed migration|migration.*failed|drift detected|P[0-9]{4}' "$combined_file"; then
    reason="Prisma reported a failed migration, drift, or engine error."
  else
    if grep -Eo '20[0-9]{12}_[[:alnum:]_]+' "$combined_file" | sort -u > "$actual_file"; then :; fi
    printf '%s\n' \
      '20260929170000_training_load_accounting_v1' \
      '20260929190000_persist_strength_accounting_v1' > "$expected_file"
    if ! cmp -s "$actual_file" "$expected_file"; then
      reason="Prisma pending migration identifiers did not exactly match the authorized Stage 02 pair."
    fi
  fi

  if [[ -n "$reason" ]]; then
    bodycast_report_readiness_failure "Prisma migrate status validation" "$exit_code" "$stdout_file" "$stderr_file" "$reason"
    rm -f "$combined_file" "$actual_file" "$expected_file"
    return 1
  fi

  if (( exit_code == 1 )); then
    printf '%s\n' 'Accepted Prisma exit code 1 only after validating the exact expected pending pair and rejecting failed/drift/error output.'
  else
    printf '%s\n' 'Prisma status output and exit code 0 matched the exact expected pending pair.'
  fi
  rm -f "$combined_file" "$actual_file" "$expected_file"
}
