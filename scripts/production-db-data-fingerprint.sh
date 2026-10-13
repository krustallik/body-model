#!/usr/bin/env bash
# Hash every public table row and sequence state without sending row contents to
# GitHub logs. In production, psql output is streamed only through the VPS pipe
# into sha256sum; only the final digest leaves the host.
set -Eeuo pipefail

mode="${1:-}"
fingerprint_mode="full"
if [[ "$mode" == "--test-url" ]]; then
  [[ ( "$#" -eq 1 || ( "$#" -eq 2 && "$2" == "--v4-replay-inputs" ) ) && -n "${BODYCAST_TEST_DATABASE_URL:-}" ]] || {
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
  fingerprint_mode="full"
  if [[ "${2:-}" == "--v4-replay-inputs" ]]; then
    fingerprint_mode="v4-replay-inputs"
    node --input-type=module - "$BODYCAST_TEST_DATABASE_URL" <<'NODE'
const url = new URL(process.argv[2]);
if (decodeURIComponent(url.pathname.slice(1)) !== "bodycast_restore") {
  throw new Error("V4 replay input fingerprint is restricted to the isolated bodycast_restore database.");
}
NODE
  fi
  psql_args=("$BODYCAST_TEST_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1)
  run_psql() { psql "${psql_args[@]}" "$@"; }
elif [[ "$mode" == "--production-container" ]]; then
  [[ ( "$#" -eq 2 || ( "$#" -eq 3 && "$3" == "--v4-replay-inputs" ) ) && "$2" == "bodycast-db-prod" ]] || {
    echo "Only the fixed production PostgreSQL container and reviewed V4 source projection are supported." >&2; exit 2;
  }
  db_container="$2"
  if [[ "${3:-}" == "--v4-replay-inputs" ]]; then fingerprint_mode="v4-replay-inputs"; fi
  run_psql() {
    docker exec "$db_container" sh -c \
      'exec psql --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=bodycast "$@"' \
      _ "$@"
  }
else
  echo "Usage: production-db-data-fingerprint.sh --test-url [--v4-replay-inputs]|--production-container bodycast-db-prod" >&2
  exit 2
fi

tables="$(run_psql --command "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename;")"
[[ -n "$tables" ]] || { echo "Public database table inventory is unavailable." >&2; exit 1; }
if [[ "$fingerprint_mode" == "v4-replay-inputs" ]]; then
  for derived in PhysiologyV7Lifecycle UnifiedExperimentalPhysiologyStateV2 ExperimentalTransientExerciseWaterShadow; do
    grep -Fqx "$derived" <<< "$tables" || {
      echo "V4 replay input fingerprint is missing a reviewed derived output table." >&2; exit 1;
    }
  done
fi
{
  if [[ "$fingerprint_mode" == "v4-replay-inputs" ]]; then
    printf 'bodycast-v4-replay-source-fingerprint-v1\n'
    printf 'excluded-derived-tables:ExperimentalTransientExerciseWaterShadow,PhysiologyV7Lifecycle,UnifiedExperimentalPhysiologyStateV2\n'
  else
    printf 'bodycast-logical-data-fingerprint-v1\n'
  fi
  while IFS= read -r table; do
    [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
      echo "Public database contains a table name outside the reviewed identifier contract." >&2; exit 1;
    }
    if [[ "$fingerprint_mode" == "v4-replay-inputs" && ( "$table" == "PhysiologyV7Lifecycle" \
      || "$table" == "UnifiedExperimentalPhysiologyStateV2" || "$table" == "ExperimentalTransientExerciseWaterShadow" ) ]]; then
      continue
    fi
    printf 'table:%s\n' "$table"
    run_psql --command "COPY (SELECT row_to_json(row_value)::text FROM public.\"${table}\" AS row_value ORDER BY row_to_json(row_value)::text) TO STDOUT;"
    printf '\n'
  done <<< "$tables"
  printf 'sequence-state\n'
  if [[ "$fingerprint_mode" == "v4-replay-inputs" ]]; then
    run_psql --command "COPY (SELECT s.schemaname || '.' || s.sequencename || ':' || COALESCE(s.last_value::text, 'null')
      FROM pg_catalog.pg_sequences s
      WHERE s.schemaname='public' AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class seq
        JOIN pg_catalog.pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
        JOIN pg_catalog.pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = seq.oid
          AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a','i')
        JOIN pg_catalog.pg_class owner_table ON owner_table.oid = dep.refobjid
        JOIN pg_catalog.pg_namespace owner_ns ON owner_ns.oid = owner_table.relnamespace
        WHERE seq_ns.nspname = s.schemaname AND seq.relname = s.sequencename
          AND owner_ns.nspname = 'public' AND owner_table.relname IN (
            'PhysiologyV7Lifecycle', 'UnifiedExperimentalPhysiologyStateV2', 'ExperimentalTransientExerciseWaterShadow'
          )
      ) ORDER BY s.sequencename) TO STDOUT;"
  else
    run_psql --command "COPY (SELECT schemaname || '.' || sequencename || ':' || COALESCE(last_value::text, 'null') FROM pg_catalog.pg_sequences WHERE schemaname='public' ORDER BY sequencename) TO STDOUT;"
  fi
} | sha256sum | awk '{print $1}'
