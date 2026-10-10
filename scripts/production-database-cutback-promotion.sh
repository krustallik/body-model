#!/usr/bin/env bash
# Fixed database-name promotion primitive shared by production cutback and its
# disposable PostgreSQL orchestration smoke. admin_sql is supplied by the host
# script and always connects to the fixed postgres maintenance database.

bodycast_cutback_promote_databases() {
  local stage_db="$1" failed_db="$2" source_db="${3:-bodycast}"
  [[ "$stage_db" =~ ^bodycast_cutback_[1-9][0-9]*$ && "$failed_db" =~ ^bodycast_failed_[1-9][0-9]*$ ]] || {
    echo "Cutback promotion database names are outside the fixed namespace." >&2
    return 1
  }
  [[ "$source_db" == "bodycast" || "$source_db" =~ ^bodycast_cutback_live_[a-f0-9]{10}$ ]] || {
    echo "Cutback source database name is outside the fixed namespace." >&2
    return 1
  }
  if ! admin_sql "ALTER DATABASE ${source_db} RENAME TO ${failed_db};" >/dev/null; then
    echo "Could not retain the current live database under its failed-run name." >&2
    return 1
  fi
  if ! admin_sql "ALTER DATABASE ${stage_db} RENAME TO ${source_db};" >/dev/null; then
    if admin_sql "ALTER DATABASE ${failed_db} RENAME TO ${source_db};" >/dev/null 2>&1; then
      echo "Restored the original live database name after staging promotion failed." >&2
      return 1
    fi
    CUTBACK_PRESERVE_STAGING=true
    echo "Staging promotion and original-name restoration both failed; retained the failed live DB and verified staging DB." >&2
    return 2
  fi
  database_swapped=true
  stage_created=false
  return 0
}

bodycast_cutback_cleanup_unpromoted_stage() {
  local stage_db="$1"
  [[ "$stage_db" =~ ^bodycast_cutback_[1-9][0-9]*$ ]] || return 1
  if [[ "${database_swapped:-false}" == "false" && "${stage_created:-false}" == "true" \
    && "${CUTBACK_PRESERVE_STAGING:-false}" != "true" ]]; then
    admin_sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${stage_db}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
    admin_sql "DROP DATABASE IF EXISTS ${stage_db};" >/dev/null 2>&1 || true
    stage_created=false
  fi
}
