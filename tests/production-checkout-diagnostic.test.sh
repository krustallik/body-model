#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
INSPECTOR="$REPO_ROOT/scripts/production-checkout-diagnostic.sh"
IS_LINUX=0
if [[ "$(uname -s)" == Linux ]]; then IS_LINUX=1; fi
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bodycast-checkout-diagnostic.XXXXXX")"
trap 'rm -rf -- "$FIXTURE_ROOT"' EXIT

TEST_REPO="$FIXTURE_ROOT/repo"
mkdir -p "$TEST_REPO"
git -C "$TEST_REPO" init --quiet
git -C "$TEST_REPO" config user.name 'BodyCast diagnostic test'
git -C "$TEST_REPO" config user.email 'diagnostic-test@example.invalid'
printf 'tracked baseline\n' > "$TEST_REPO/tracked.txt"
git -C "$TEST_REPO" add tracked.txt
git -C "$TEST_REPO" commit --quiet -m 'fixture baseline'

assert_field() {
  local report="$1" field="$2" expected="$3" actual
  actual="$(printf '%s\n' "$report" | awk -F= -v wanted="$field" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }')"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected %s=%s, got %s\n' "$field" "$expected" "${actual:-<missing>}" >&2
    exit 1
  fi
}

run_inspector() {
  local path="$1"
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    DEPLOY_PATH_B64="$(printf '%s' "$path" | base64 -w0)" bash "$INSPECTOR"
}

INDEX_BEFORE="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
CLEAN_REPORT="$(run_inspector "$TEST_REPO")"
INDEX_AFTER="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
[[ "$INDEX_BEFORE" == "$INDEX_AFTER" ]] || { echo 'Read-only status inspection changed the Git index.' >&2; exit 1; }
assert_field "$CLEAN_REPORT" diagnostic_status complete
if [[ "$IS_LINUX" == 1 ]]; then
  assert_field "$CLEAN_REPORT" deploy_path_literal_matches_git_root yes
  assert_field "$CLEAN_REPORT" deploy_path_canonical_matches_git_root yes
fi
assert_field "$CLEAN_REPORT" checkout_clean_as_existing_guard yes
assert_field "$CLEAN_REPORT" status_exit_code 0
assert_field "$CLEAN_REPORT" tracked_unstaged_path_count 0
assert_field "$CLEAN_REPORT" tracked_staged_path_count 0
assert_field "$CLEAN_REPORT" untracked_path_count 0

TRAILING_REPORT="$(run_inspector "$TEST_REPO/")"
assert_field "$TRAILING_REPORT" deploy_path_has_trailing_slash yes
if [[ "$IS_LINUX" == 1 ]]; then
  assert_field "$TRAILING_REPORT" deploy_path_literal_matches_git_root no
  assert_field "$TRAILING_REPORT" deploy_path_canonical_matches_git_root yes
fi
assert_field "$TRAILING_REPORT" checkout_clean_as_existing_guard yes

if [[ "$IS_LINUX" == 1 ]] && ln -s "$TEST_REPO" "$FIXTURE_ROOT/repo-link" 2>/dev/null; then
  SYMLINK_REPORT="$(run_inspector "$FIXTURE_ROOT/repo-link")"
  assert_field "$SYMLINK_REPORT" deploy_path_is_symlink yes
  assert_field "$SYMLINK_REPORT" deploy_path_has_symlink_component yes
  assert_field "$SYMLINK_REPORT" deploy_path_canonical_matches_git_root yes
fi

printf 'tracked changed\n' > "$TEST_REPO/tracked.txt"
printf 'untracked\n' > "$TEST_REPO/untracked.txt"
INDEX_BEFORE_DIRTY="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
DIRTY_REPORT="$(run_inspector "$TEST_REPO")"
INDEX_AFTER_DIRTY="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
[[ "$INDEX_BEFORE_DIRTY" == "$INDEX_AFTER_DIRTY" ]] || { echo 'Dirty status inspection changed the Git index.' >&2; exit 1; }
assert_field "$DIRTY_REPORT" checkout_clean_as_existing_guard no
assert_field "$DIRTY_REPORT" tracked_unstaged_path_count 1
assert_field "$DIRTY_REPORT" tracked_staged_path_count 0
assert_field "$DIRTY_REPORT" untracked_path_count 1
assert_field "$DIRTY_REPORT" tracked_unstaged_path_sample tracked.txt
assert_field "$DIRTY_REPORT" untracked_path_sample untracked.txt

git -C "$TEST_REPO" add tracked.txt
printf 'secret-like name\n' > "$TEST_REPO/.env.production"
INDEX_BEFORE_STAGED="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
STAGED_REPORT="$(run_inspector "$TEST_REPO")"
INDEX_AFTER_STAGED="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
[[ "$INDEX_BEFORE_STAGED" == "$INDEX_AFTER_STAGED" ]] || { echo 'Staged status inspection changed the Git index.' >&2; exit 1; }
assert_field "$STAGED_REPORT" checkout_clean_as_existing_guard no
assert_field "$STAGED_REPORT" tracked_staged_path_count 1
assert_field "$STAGED_REPORT" untracked_path_count 2
assert_field "$STAGED_REPORT" tracked_staged_path_sample tracked.txt
UNTRACKED_SAMPLE="$(printf '%s\n' "$STAGED_REPORT" | awk -F= '$1 == "untracked_path_sample" { sub(/^[^=]*=/, ""); print; exit }')"
[[ "$UNTRACKED_SAMPLE" == *'untracked.txt'* && "$UNTRACKED_SAMPLE" == *'[redacted]'* ]] || {
  echo 'Expected safe untracked path and redaction marker in diagnostic sample.' >&2; exit 1;
}
if [[ "$STAGED_REPORT" == *'.env.production'* ]]; then
  echo 'Sensitive-looking filename was not redacted from diagnostic output.' >&2
  exit 1
fi

echo 'Production checkout diagnostic fixture passed.'
