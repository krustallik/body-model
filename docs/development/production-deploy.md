# Production release operations

BodyCast production release uses manual owner-authorized GitHub Actions jobs and the existing
fixed production scripts over pinned SSH. A successful merge and `BodyCast CI/CD` run do not
start a production deploy. The dispatch must come from `main`, use its exact current SHA, pass the
green exact-SHA CI gate, and be initiated by the pinned owner GitHub ID `126446430`; the workflow
also checks GitHub's triggering actor so a rerun by another account is rejected.

## Release components

- `.github/workflows/production-migration-preflight.yml` enters maintenance, stops the old app,
  inspects production read-only, encrypts a database backup, and rehearses its restore and the
  reviewed migration set on disposable PostgreSQL.
- `.github/workflows/production-migrate.yml` verifies the exact signed owner authorization,
  current SHA, six-migration manifest and hashes, database identity, backup/restore evidence, and
  writer drain before invoking `scripts/deploy-migrate.sh` over SSH.
- `.github/workflows/deploy-production.yml` deploys only the exact migrated SHA in non-serving
  mode. It is manual and is not triggered by merge or CI.
- `.github/workflows/activate-unified-v4-production.yml` checks V3, performs the separately
  confirmed Unified V4 activation/replay, verifies V4 currentness/coverage, and then serves the
  exact SHA.
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

The old release is incompatible with the reviewed six-migration schema. The automatic
post-merge deployment path is therefore disabled for this release. The candidate is not started
until the controlled migration succeeds and the `schema-applied` marker is present. Keep traffic
on the maintenance route from before backup/preflight through V3 and V4 readiness.

## Owner-authorized release order

1. Merge the audited PR. Wait for successful `BodyCast CI/CD` on the exact current `main` SHA.
2. Dispatch **Production migration preflight and encrypted backup** from `main` for that SHA,
   manifest `active-energy-unified-v2`, with confirmation `maintenance-backup-restore`. The job
   confirms the public maintenance response, disables restart and stops/removes the old app,
   checks the existing DB and writer topology, creates the encrypted backup, then restores it and
   rehearses the exact migrations only on the disposable PostgreSQL service. Review the report,
   encrypted artifact, key availability, and restore result.
3. Dispatch **Manual production migration** from `main` for the same SHA and manifest with
   `MIGRATE_PRODUCTION`. The owner-only signing job binds the exact pending set and evidence. The
   execution job repeats current-main, signature, hash, DB identity, backup freshness, and writer
   drain checks. It writes the durable `ddl-started` marker immediately before its single Prisma
   migration attempt. Read-only postflight must pass before the marker advances to
   `schema-applied`.
4. Dispatch **Manual production app deploy** for the same SHA, confirm `deploy`, and require
   non-serving mode. The app starts behind maintenance only after the migration marker matches
   that SHA and the app passes health and image/SHA checks. The marker advances to `app-ready`.
5. Dispatch **Owner-authorized Unified V4 activation and traffic serve** for the same current-main
   SHA with `ACTIVATE_UNIFIED_V4_AND_SERVE`. The job verifies V3 postflight, explicitly activates
   and replays Unified V4, checks currentness/coverage, and opens traffic only when the exact app
   and rollout gates pass.

Do not manually run Prisma commands or `docker compose up` as a substitute for these fixed
workflows. The migration workflow is the only production DDL path. The V4 workflow is the only
release path that activates/replays V4 or changes the final serving route.

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

See [the V5 migration runbook](production-migration-v5-runbook.md) for the exact six SQL hashes,
database checks, and recovery details.
