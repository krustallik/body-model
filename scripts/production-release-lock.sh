#!/usr/bin/env bash
# Serialize the fixed production deploy, migration, and traffic entrypoints.
set -Eeuo pipefail

bodycast_acquire_production_release_lock() {
  local git_dir
  git_dir="$(git rev-parse --absolute-git-dir)"
  [[ -d "$git_dir" && ! -L "$git_dir" ]] || {
    echo "Production Git metadata directory is unavailable or ambiguous." >&2
    return 1
  }
  # A small fixed host wrapper may acquire the global lock before checking out
  # the exact current-main tooling. Its child script inherits FD 9 and proves
  # that it still references this lock before reusing it.
  if [[ "${BODYCAST_PRODUCTION_RELEASE_LOCK_HELD:-0}" == "1" ]]; then
    [[ "$(readlink "/proc/$$/fd/9" 2>/dev/null || true)" == "$git_dir/bodycast-production-release.lock" ]] \
      && flock -n 9 || {
        echo "Inherited production release lock is missing, different, or contended." >&2
        return 1
      }
    return 0
  fi
  command -v flock >/dev/null 2>&1 || {
    echo "flock is unavailable; production release operations cannot be serialized." >&2
    return 1
  }
  exec 9>"$git_dir/bodycast-production-release.lock"
  flock -n 9 || {
    echo "Another production deploy, migration, or traffic operation is active." >&2
    return 1
  }
}
