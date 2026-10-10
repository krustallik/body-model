#!/usr/bin/env bash
# Hash every public table row and sequence state without sending row contents to
# GitHub logs. In production, psql output is streamed only through the VPS pipe
# into sha256sum; only the final digest leaves the host.
set -Eeuo pipefail

mode="${1:-}"
if [[ "$mode" == "--test-url" ]]; then
  [[ "$#" -eq 1 && -n "${BODYCAST_TEST_DATABASE_URL:-}" ]] || {
    echo "An isolated test PostgreSQL URL is required." >&2; exit 2;
  }
  node --input-type=module - "$BODYCAST_TEST_DATABASE_URL" <<'NODE'
const url = new URL(process.argv[2]);
const database = decodeURIComponent(url.pathname.slice(1));
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  || !url.password || url.search || url.hash
  || !(database === "bodycast_restore" || database.endsWith("_test") || /^bodycast_cutback_live_[a-f0-9]{10}$/.test(database))) {
  throw new Error("Data fingerprint accepts only an isolated loopback *_test/bodycast_restore database.");
}
NODE
  psql_args=("$BODYCAST_TEST_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1)
  run_psql() { psql "${psql_args[@]}" "$@"; }
elif [[ "$mode" == "--production-container" ]]; then
  [[ "$#" -eq 2 && "$2" == "bodycast-db-prod" ]] || {
    echo "Only the fixed production PostgreSQL container is supported." >&2; exit 2;
  }
  db_container="$2"
  run_psql() {
    docker exec "$db_container" sh -c \
      'exec psql --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=bodycast "$@"' \
      _ "$@"
  }
else
  echo "Usage: production-db-data-fingerprint.sh --test-url|--production-container bodycast-db-prod" >&2
  exit 2
fi

tables="$(run_psql --command "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename;")"
[[ -n "$tables" ]] || { echo "Public database table inventory is unavailable." >&2; exit 1; }
{
  printf 'bodycast-logical-data-fingerprint-v1\n'
  while IFS= read -r table; do
    [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
      echo "Public database contains a table name outside the reviewed identifier contract." >&2; exit 1;
    }
    printf 'table:%s\n' "$table"
    run_psql --command "COPY (SELECT row_to_json(row_value)::text FROM public.\"${table}\" AS row_value ORDER BY row_to_json(row_value)::text) TO STDOUT;"
    printf '\n'
  done <<< "$tables"
  printf 'sequence-state\n'
  run_psql --command "COPY (SELECT schemaname || '.' || sequencename || ':' || COALESCE(last_value::text, 'null') FROM pg_catalog.pg_sequences WHERE schemaname='public' ORDER BY sequencename) TO STDOUT;"
} | sha256sum | awk '{print $1}'
