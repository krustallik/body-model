#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve the canonical branch from origin on every call. Do not treat FETCH_HEAD
# or a caller-supplied commit fetch as evidence that a candidate is still main.
bodycast_assert_current_main_sha() {
  local candidate_sha="${1:-}"
  local canonical_main_sha

  [[ "$candidate_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "A full candidate SHA is required for the current-main freshness check." >&2
    return 1
  }

  if ! git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main; then
    echo "Unable to refresh canonical origin/main; refusing the release." >&2
    return 1
  fi
  if ! canonical_main_sha="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')"; then
    echo "Unable to resolve the fetched canonical origin/main commit." >&2
    return 1
  fi
  [[ "$canonical_main_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "The fetched canonical origin/main ref is not a full commit SHA." >&2
    return 1
  }
  [[ "$candidate_sha" == "$canonical_main_sha" ]] || {
    echo "Refusing stale release SHA ${candidate_sha}; canonical origin/main is ${canonical_main_sha}." >&2
    return 1
  }
}
