#!/usr/bin/env bash
set -Eeuo pipefail

readonly image="docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"
readonly network="bodycast-backend-prod"
readonly container="bodycast-db-prod"
readonly password='bodycast:ci\only'
readonly scratch="$(mktemp -d)"
network_created=0
container_created=0

cleanup() {
  if (( container_created )); then docker rm --force "$container" >/dev/null 2>&1 || true; fi
  if (( network_created )); then docker network rm "$network" >/dev/null 2>&1 || true; fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT

if docker network inspect "$network" >/dev/null 2>&1; then
  echo "Refusing to reuse an unexpected Docker network named $network." >&2
  exit 1
fi
if docker inspect "$container" >/dev/null 2>&1; then
  echo "Refusing to reuse an unexpected Docker container named $container." >&2
  exit 1
fi

docker network create --internal "$network" >/dev/null
network_created=1
docker run --detach --network "$network" --name "$container" \
  --env POSTGRES_DB=bodycast --env POSTGRES_USER=bodycast --env "POSTGRES_PASSWORD=$password" \
  "$image" >/dev/null
container_created=1
expected_image_id="$(docker image inspect --format '{{.Id}}' "$image")"

ready=0
for _ in {1..60}; do
  if docker exec "$container" pg_isready --quiet --username=bodycast --dbname=bodycast; then
    ready=1
    break
  fi
  sleep 1
done
if (( ! ready )); then
  echo "Disposable PostgreSQL did not become ready." >&2
  exit 1
fi

server_ip="$(docker inspect --format '{{ with index .NetworkSettings.Networks "bodycast-backend-prod" }}{{.IPAddress}}{{end}}' "$container")"
[[ "$server_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Disposable PostgreSQL did not receive the expected Docker network address." >&2
  exit 1
}

if docker exec "$container" psql --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --host "$server_ip" --username=bodycast --dbname=bodycast --command 'SELECT 1' \
  >"$scratch/missing-password.log" 2>&1; then
  echo "The original TCP identity command unexpectedly connected without a password." >&2
  exit 1
fi
if ! grep -Fq 'fe_sendauth: no password supplied' "$scratch/missing-password.log"; then
  echo "The original TCP command failed for a reason other than the reported missing-password error." >&2
  exit 1
fi

source scripts/production-db-identity.sh
identity="$(bodycast_capture_production_db_identity "$container")"
IFS='|' read -r container_id image_id database database_oid cluster_id role server_version server_address server_port <<< "$identity"
[[ "$container_id" =~ ^[a-f0-9]{64}$ && "$image_id" == "$expected_image_id" \
  && "$database" == bodycast && "$database_oid" =~ ^[1-9][0-9]*$ \
  && "$cluster_id" =~ ^[1-9][0-9]*$ && "$role" == bodycast \
  && "$server_version" == 17.* && "$server_address" == "$server_ip" && "$server_port" == 5432 ]] || {
  echo "Protected PostgreSQL identity authentication returned an unexpected endpoint." >&2
  exit 1
}
if docker exec "$container" bash -c 'compgen -G "/tmp/bodycast-production-db-identity.*" >/dev/null'; then
  echo "The protected PostgreSQL passfile was not removed after the identity query." >&2
  exit 1
fi

echo "Missing-password TCP failure reproduced; protected read-only PostgreSQL identity authentication passed."
