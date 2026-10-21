# Production release operations

Automatic serving deployment is paused while the imported-data V4 recovery is pending. The deploy
workflow exposes exact-current-main owner dispatches for non-serving deploy, first install, and
serving after a completed no-app V4 recovery. Recovered serving keeps maintenance active until the
existing PostgreSQL currentness fence commits the exact route. Manual deployment checks GitHub's
triggering actor against owner ID `126446430`.

## Release components

- `.github/workflows/production-migration-preflight.yml` enters maintenance, stops the old app,
  inspects production read-only, encrypts a database backup, and rehearses its restore and the
  reviewed migration set on disposable PostgreSQL.
- `.github/workflows/production-migrate.yml` verifies the exact signed owner authorization,
  current SHA, selected exact migration manifest and hashes, database identity, backup/restore evidence, and
  writer drain before invoking `scripts/deploy-migrate.sh` over SSH.
- `.github/workflows/deploy-production.yml` has no CI-completion trigger. Manual dispatches require
  successful CI for the exact current-main SHA; recovered-V4 serving has a distinct confirmation
  and never applies Prisma migrations.
- Unified V4 activation/replay was a one-time rollout operation. Its workflow dispatch has been
  removed; guarded cutover and recovery helpers remain available to the retained release paths.
- `scripts/deploy.sh`, `scripts/deploy-migrate.sh`, `scripts/production-traffic-cutover.sh`, and
  their fixed helpers implement the host operations. The SSH workflow sends fixed script
  invocations and validated values; it does not expose a general remote command interface.

Docker socket access is root-equivalent. Keep the SSH private key and production secrets only in
the protected GitHub `production` environment, pin the host's verified SSH fingerprint, and
restrict the release SSH account to the reviewed host. The workflows do not install services,
change GitHub environment settings, or expose secret values in summaries.

## Database and serving boundaries

Ordinary application deployment never starts, creates, recreates, or restarts PostgreSQL and
never changes schema or data. It inspects the existing healthy database and runs read-only Prisma
compatibility checks. Compose commands use `run --no-deps` for tooling and `up --no-deps` for the
app only. A missing or incompatible database blocks the app deployment.

The ordinary deployment path never runs migrations. Read-only compatibility checks block it when
the database is unavailable, the schema is incompatible, or migrations are pending. For an
approved schema cutover, the separate migration flow runs first; its exact-SHA marker keeps the new
app non-serving until V3/V4 readiness. Keep traffic on maintenance from before backup/preflight
through V3 and V4 readiness.

## First install on the verified empty VPS

The owner-only `fresh_empty_install` mode in `.github/workflows/deploy-production.yml` is a separate,
one-time path for `bodycast.ihorhub.eu` on the new VPS at `169.58.239.149`. It requires the exact
current-main SHA and its successful CI, confirmation `initialize-empty-bodycast-db`, that exact app
hostname resolving to the VPS, a clean checkout, no prior `.env`, no BodyCast app/database container or Compose
container, no PostgreSQL volume, no install marker, and a healthy existing Caddy on
`gymbeam-internal`. It does not change Gymbeam services or the old server.

The fixed host script creates a root-only runtime `.env`, starts only PostgreSQL, confirms the
public schema has no tables, applies the exact checked-out Prisma migration tree once, and verifies
every migration name/checksum/state plus empty Profile, Health, Workout, Training, Work, and model
source tables. Only then does it call the existing exact-SHA deploy script to start the app and
publish its route. The ordinary deploy path remains migration-free. A durable one-shot marker blocks
reruns after any attempt; failures preserve the database and marker for read-only diagnosis. Do not
reset the database or retry blindly.

This first launch has no profile or model history, so Unified V4 is **not initialized** and is not
reported as current. The app shell and profile setup are served; V4-dependent outputs remain
unavailable until real profile/source inputs are entered and the normal model initialization and
currentness checks pass. This path is not a replacement for migration/recovery of an existing
database.

If the exact candidate SHA is already healthy and serving with the fixed route and current V4, the
workflow still runs the schema/V4 checks (including building the local migrator tooling image), then
skips app replacement and route changes. This keeps repeated successful CI events idempotent without
claiming the Docker image cache is read-only.

## Owner-authorized release order

A. For the imported-data database, run the owner-authorized derived-only V4 recovery in
   `maintenance-no-app-74` mode. It requires exact current-main CI, the approved recovery image,
   encrypted backup, isolated restore/rehearsal, disk headroom, current source binding, and a
   fresh root-only terminal marker. It does not run Prisma migrations or start an app.
B. Verify the recovery marker, 74-row migration ledger, schema digest, raw-source fingerprint,
   complete V4 coverage, synchronized generations, zero publication fences, and V4 epoch 1.
C. Dispatch `deploy-production.yml` with `serve_recovered_v4=true`,
   `non_serving_deploy=false`, `fresh_empty_install=false`, exact current-main `commit_sha`, and
   confirmation `serve-after-current-v4-recovery`. The workflow first starts the exact app behind
   confirmed maintenance, then calls `production-traffic-cutover.sh serve`. That path rechecks the
   completed recovery marker and 74 successful migration rows, verifies current raw/schema evidence,
   and holds the existing `(927001, profileId)` PostgreSQL currentness fence through route publication,
   reload, and health probe.
D. Run production health, API, UI, V4, Training, Health, and historical-integrity smoke checks.

For a later schema change, use the separate migration preflight, encrypted backup and isolated
restore/DDL rehearsal, exact signed DDL authorization, migration workflow, schema postflight, and
non-serving app deploy. Do not rerun that path for an already-current 74-migration imported database.

An unknown or partial Training DDL result stops the sequence: keep maintenance active and do not
retry Prisma, apply manual SQL, or automatically roll back. Do not run Prisma commands or
`docker compose up` manually as a substitute for the reviewed release paths.

## Backup and failure handling

`PRODUCTION_BACKUP_ENCRYPTION_KEY` must be the canonical base64 encoding of a random 32-byte key,
available in the protected production environment and in the owner-controlled recovery vault. It
must never appear in repository files, workflow inputs, logs, or plaintext artifacts. The
preflight streams the production `pg_dump` directly into an AES-256-GCM encrypted artifact and
proves decryption, restore readability, schema/history identity, and migration rehearsal against
the isolated PostgreSQL service before authorizing DDL.

The `ddl-started` marker is the irreversible boundary. Before it exists, the migration process
has not begun and the database schema remains at the prior release. Once it exists, assume the
schema may have changed even if Prisma did not visibly start. Keep maintenance active, do not
restart the old app, do not clear the marker automatically, and do not retry migration in place.
Preserve the failed database. Returning to the old app requires the separately reviewed restore
procedure to restore and verify the exact pre-DDL backup into a clean database; app rollback does
not roll back database changes. Without verified restore, leave maintenance active for operator
intervention.

Any failed backup, unavailable key, failed isolated restore, unexpected migration history,
unknown writer, stale SHA, failed signature, partial migration, unhealthy app, or missing V3/V4
currentness/coverage fails closed. Preserve the exact run evidence and stop for an owner-reviewed
recovery decision. Production operations remain separately authorized and are never performed by
CI or ordinary app startup.

See [the V5 migration runbook](production-migration-v5-runbook.md) for the exact SQL hashes for each
supported manifest (including the current nine-migration Training set),
database checks, and recovery details.
