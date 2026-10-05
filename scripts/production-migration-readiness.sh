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
