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
