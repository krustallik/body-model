#!/usr/bin/env bash
# Verify the GitHub Actions OIDC release attestation on the VPS and bind it to
# one exact serving SHA/run. The JWT itself is never logged or passed in argv.
set -Eeuo pipefail

bodycast_prepare_migration_free_attestation() {
  local release_sha="${1:-}" run_id="${2:-}" run_attempt="${3:-}" token_file="${BODYCAST_MIGRATION_FREE_OIDC_TOKEN_FILE:-}"
  local work_dir="" git_dir="" used_jti_directory="" result="" jti_digest="" receipt_file="" receipt_payload=""
  [[ "$release_sha" =~ ^[a-f0-9]{40}$ && "$run_id" =~ ^[1-9][0-9]*$ && "$run_attempt" =~ ^[1-9][0-9]*$ ]] || {
    echo "Migration-free serving requires an exact SHA and workflow run identity." >&2
    return 1
  }
  [[ "$token_file" == /run/bodycast-migration-free-oidc.* && -f "$token_file" && ! -L "$token_file" \
    && "$(stat -c '%u' "$token_file")" == "$(id -u)" && "$(stat -c '%a' "$token_file")" == "600" ]] || {
    echo "Migration-free serving requires the protected OIDC token received over the pinned GitHub Actions SSH channel." >&2
    return 1
  }
  git_dir="$(git rev-parse --absolute-git-dir)"
  [[ -d "$git_dir" && ! -L "$git_dir" ]] || return 1
  used_jti_directory="$git_dir/bodycast-production-used-attestations"
  [[ ! -e "$used_jti_directory" && ! -L "$used_jti_directory" ]] || {
    [[ -d "$used_jti_directory" && ! -L "$used_jti_directory" \
      && "$(stat -c '%u' "$used_jti_directory")" == "$(id -u)" ]] || {
      echo "Migration-free replay-guard directory is unsafe or owned by another host user." >&2
      return 1
    }
  }
  install -d -m 700 "$used_jti_directory"
  chmod 700 "$used_jti_directory"
  work_dir="/run/bodycast-migration-free-verify.${run_id}.${run_attempt}"
  [[ ! -e "$work_dir" && ! -L "$work_dir" ]] || {
    echo "Migration-free attestation workspace already exists for this workflow attempt." >&2
    return 1
  }
  install -d -m 700 "$work_dir"
  if ! cp -- "$token_file" "$work_dir/token"; then
    rm -rf -- "$work_dir"
    return 1
  fi
  chmod 400 "$work_dir/token"
  if ! curl --silent --show-error --fail --location --proto '=https' --tlsv1.2 --max-time 15 \
    'https://token.actions.githubusercontent.com/.well-known/jwks' --output "$work_dir/jwks.json"; then
    rm -rf -- "$work_dir"
    echo "GitHub OIDC signing keys could not be verified from the official issuer." >&2
    return 1
  fi
  chmod 400 "$work_dir/jwks.json"
  if ! result="$(docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.prod.yml" --profile tools run \
    --rm --no-deps --user 0:0 -v "$work_dir:/run/bodycast-deploy-attestation:ro" \
    -v "$used_jti_directory:/run/bodycast-release-state/used-jti:rw" --entrypoint node migrate \
    /app/scripts/production-deploy-attestation.mjs --token-file /run/bodycast-deploy-attestation/token \
    --jwks-file /run/bodycast-deploy-attestation/jwks.json --release-sha "$release_sha" \
    --run-id "$run_id" --run-attempt "$run_attempt" --consume \
    --used-jti-directory /run/bodycast-release-state/used-jti)"; then
    rm -rf -- "$work_dir"
    echo "Migration-free serving is blocked by the owner/workflow attestation or one-use replay gate." >&2
    return 1
  fi
  rm -rf -- "$work_dir"
  [[ "$result" == BODYCAST_PRODUCTION_DEPLOY_ATTESTATION=* ]] \
    && [[ "$result" == *"\"releaseSha\":\"$release_sha\""* ]] \
    && [[ "$result" == *"\"runId\":\"$run_id\""* ]] \
    && [[ "$result" == *"\"runAttempt\":\"$run_attempt\""* ]] || {
      echo "Verified migration-free attestation receipt did not match this release run." >&2
      return 1
    }
  jti_digest="$(printf '%s\n' "$result" | sed -n 's/.*"jtiDigest":"\([a-f0-9]\{64\}\)".*/\1/p')"
  [[ "$jti_digest" =~ ^[a-f0-9]{64}$ ]] || return 1
  receipt_file="/run/bodycast-migration-free-receipt.${run_id}.${run_attempt}"
  [[ ! -e "$receipt_file" && ! -L "$receipt_file" ]] || {
    echo "Migration-free attestation receipt already exists for this workflow attempt." >&2
    return 1
  }
  install -m 600 /dev/null "$receipt_file"
  receipt_payload="schema=1\nrelease_sha=$release_sha\nrun_id=$run_id\nrun_attempt=$run_attempt\njti_digest=$jti_digest"
  if ! printf '%b\n' "$receipt_payload" > "$receipt_file"; then
    rm -f -- "$receipt_file"
    return 1
  fi
  export BODYCAST_MIGRATION_FREE_ATTESTATION_RECEIPT_FILE="$receipt_file"
  rm -f -- "$token_file"
  echo "Owner OIDC attestation verified for the exact SHA/run and consumed once; the receipt is held only for this locked release." >&2
}

bodycast_assert_migration_free_attestation_receipt() {
  local release_sha="${1:-}" run_id="${2:-}" run_attempt="${3:-}" receipt_file="${BODYCAST_MIGRATION_FREE_ATTESTATION_RECEIPT_FILE:-}"
  local expected="" actual
  [[ "$release_sha" =~ ^[a-f0-9]{40}$ && "$run_id" =~ ^[1-9][0-9]*$ && "$run_attempt" =~ ^[1-9][0-9]*$ \
    && "$receipt_file" == /run/bodycast-migration-free-receipt.* && -f "$receipt_file" && ! -L "$receipt_file" \
    && "$(stat -c '%u' "$receipt_file")" == "$(id -u)" && "$(stat -c '%a' "$receipt_file")" == "600" ]] || {
      echo "Migration-free cutover requires the protected one-use owner attestation receipt." >&2
      return 1
    }
  printf -v expected 'schema=1\nrelease_sha=%s\nrun_id=%s\nrun_attempt=%s' "$release_sha" "$run_id" "$run_attempt"
  actual="$(cat -- "$receipt_file")"
  [[ "$actual" == "$expected"* ]] || {
    echo "Migration-free cutover attestation receipt does not match this exact SHA/run." >&2
    return 1
  }
}
