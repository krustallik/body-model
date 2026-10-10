#!/usr/bin/env bash
set -Eeuo pipefail

REAL_DOCKER="$(command -v docker)"
source "$PROMOTION_HELPER"
source "$LIFECYCLE_HELPER"

admin_sql() {
  local sql="$1"
  if [[ "$sql" == "ALTER DATABASE $STAGE_DB RENAME TO $LIVE_DB;" ]]; then return 1; fi
  if [[ "$FAIL_RESTORE" == "1" && "$sql" == "ALTER DATABASE $FAILED_DB RENAME TO $LIVE_DB;" ]]; then return 1; fi
  "$REAL_DOCKER" run --rm --network host --env "PGPASSWORD=$PGPASSWORD" "$POSTGRES_IMAGE" psql \
    --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --host "$PGHOST" --port "$PGPORT" \
    --username "$PGUSER" --dbname postgres --command "$sql"
}

# Lifecycle calls are instrumented separately from the actual disposable DB
# client so this test can prove no app/Compose restart was attempted.
docker() {
  printf 'called\n' >> "$LIFECYCLE_DOCKER_CALLS"
  "$REAL_DOCKER" "$@"
}
compose() {
  printf 'called\n' >> "$LIFECYCLE_DOCKER_CALLS"
  return 1
}
expected_previous_app_label() { printf 'unknown'; }

stage_db="$STAGE_DB"
database_swapped=false
stage_created=true
CUTBACK_PRESERVE_STAGING=false
app_started=false
route_committed=false
APP_CONTAINER=bodycast-app-prod
PREVIOUS_IMAGE_ID=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
app_started_container_id=""
BODYCAST_RELEASE_MARKER_PATH="$MARKER_PATH"
TMP_DIR=""

cleanup_cutback() {
  local status=$?
  trap - ERR EXIT
  set +e
  bodycast_cutback_failure_cleanup "$status"
  exit $?
}
trap cleanup_cutback EXIT

if bodycast_cutback_promote_databases "$STAGE_DB" "$FAILED_DB" "$LIVE_DB"; then
  exit 0
else
  promotion_status=$?
  if [[ "$promotion_status" == "2" ]]; then
    CUTBACK_PRESERVE_STAGING=true
    exit 42
  fi
  exit 41
fi
