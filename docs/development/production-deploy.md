# Production deployment operations

## Architecture (CURRENT)

- Controller: GitHub Actions only (`BodyCast production deploy`).
- Host: VPS over SSH (`appleboy/ssh-action`).
- Runtime: Docker Compose (`docker-compose.prod.yml`) — `app` + Postgres.
- Edge: Caddy (`gymbeam-caddy`) reverse proxy to `bodycast-app-prod:3000`.
- Ordinary release script: `scripts/deploy.sh` (exact `DEPLOY_SHA`, **no migrate**).
- Schema preflight: `scripts/deploy-preflight-schema.sh` (existing DB health inspection and `prisma migrate status` only; Compose dependency startup disabled).
- Separate migrate script: `scripts/deploy-migrate.sh` (requires `CONFIRM_PRODUCTION_MIGRATE=migrate`; **not** wired to automatic deploy).
- Production migration readiness: manual `Production migration preflight and encrypted backup` workflow; inspection and backup only, never migration.

Ordinary deploy never starts, creates, recreates, or restarts PostgreSQL. It inspects the
existing DB and runs read-only schema compatibility checks. The Prisma status container uses
`docker compose run --no-deps`; the app replacement also uses `up --no-deps`. If the existing
DB is unavailable or incompatible, deployment stops without changing DB schema or data.

There are no Vercel/Netlify auto-deploy hooks for this app.

## Automatic deploy policy

1. Push/merge to `main` runs `BodyCast CI/CD`.
2. On **successful** main **push** CI, `workflow_run` starts production deploy.
3. Gate requires:
   - source repository match;
   - workflow name `BodyCast CI/CD`;
   - conclusion `success`;
   - event `push`;
   - branch `main`;
   - CI `head_sha` equals current `origin/main` tip (rejects stale runs).
4. The server checks out that exact SHA and repeats the current-main freshness fence.
5. Before maintenance, deploy checks marker state, the existing DB, read-only schema compatibility,
   and Unified V4 currentness, then builds and validates the exact candidate.
6. Deploy publishes a fixed maintenance route and confirms the public HTTPS endpoint returns the
   exact attempt-marked 503 with `Cache-Control: no-store` and no redirect. The old app is not
   stopped or replaced until this confirmation succeeds.
7. Under maintenance, deploy captures the prior container/SHA/immutable image identity, stops and
   removes the app container, then starts only the exact candidate app with `--no-deps`. It checks
   candidate readiness, local health, SHA/image identity, DB compatibility, marker state, Unified
   V4 currentness, route validity, and current-main freshness before serving.
8. The atomic live serving-route replacement is `SERVING_COMMIT`. Caddy reload and public
   `https://$APP_HOST/api/health` verification happen after commit and are observational; their
   failure never triggers rollback or removes the candidate.

Failure before maintenance confirmation leaves the prior app running. Failure after confirmation
and before `SERVING_COMMIT` leaves traffic in maintenance. The exact prior image is pinned for
operator recovery, but automatic prior-app restoration is disabled because the deploy does not
prove the prior runtime configuration can be reproduced. An unverified candidate is stopped only
when its same-attempt SHA, image, and container identity are known; otherwise maintenance remains
active for operator intervention. Availability is secondary to correctness during this short
single-user maintenance window.

Ordinary deploy never runs `prisma migrate deploy`, historical replay, backfill, recovery, or model
activation. Production migrations remain a separate controlled procedure with backup and explicit
authorization; app rollback does not roll back database changes.

PR CI success never deploys. Feature pushes without PR never deploy.

## High-risk operations (separate authorization)

Not performed by automatic deploy:

- `prisma migrate deploy` / `migrate reset`
- historical replay / ModelEpisode regeneration
- selection-v1 activation / visibility migration
- physiology model version switch

Default remains `bodycast-physiology-v7` until separately authorized.

## Stage 02 production migration preflight

The manual workflow `.github/workflows/production-migration-preflight.yml` is the required
readiness procedure for the two pending Stage 02 migrations. Dispatch it from `main` with the
current full main SHA and the confirmation phrase `inspect-backup-restore`. It also requires a
successful `BodyCast CI/CD` main-push run for that exact SHA. The production GitHub Environment
must contain the existing `SSH_HOST`, `SSH_USER`, `SSH_PORT`, and `SSH_PRIVATE_KEY` secrets plus:

- `SSH_HOST_FINGERPRINT`: the production host's verified `SHA256:` OpenSSH fingerprint. Obtain
  and verify this through the trusted host administration channel; the workflow rejects an
  unpinned host and writes only scanned key records whose individual fingerprints exactly match
  this pin. Unmatched scanned keys are never placed in `known_hosts`.
- `PRODUCTION_BACKUP_ENCRYPTION_KEY`: canonical base64 for a randomly generated 32-byte key.
  Store it only as a protected production-environment secret and separately in the approved
  owner-controlled secret vault. Never put it in the repository, workflow input, logs, or backup
  artifact.

The workflow opens only read-only PostgreSQL transactions for live inspection, checks the
production DB/container identity, migration rows and partial Stage 02 objects, approximate row
counts and relation sizes, long transactions, and every granted or awaiting relation lock on
existing tables altered by the Stage 02 migrations. Those `ALTER TABLE` statements require
`ACCESS EXCLUSIVE`, which conflicts with every other relation lock mode. The preflight excludes
its own backend and blocks even a short lock rather than filtering only for long transactions or
already-blocked sessions. It only proceeds when the
pending migration set is exactly `20260929170000_training_load_accounting_v1` and
`20260929190000_persist_strength_accounting_v1`, with no failed/incomplete rows or pre-existing
objects from those migrations. It then streams `pg_dump --format=custom` over the verified SSH
connection into an AES-256-GCM envelope without writing a plaintext dump on production or the
runner. The encrypted artifact is uploaded to the repository's GitHub Actions artifact storage
for 90 days, then decrypted only as a stream into the workflow-owned disposable PostgreSQL 17
service. The restore check compares migration-history rows to the live preflight report and
reads the restored `StrengthDiarySession` and `ExerciseCatalog` tables. The job never invokes
`prisma migrate deploy`, DDL, DML, a production backfill, or a manual migration-table edit.

The disposable service image is pinned to OCI index digest
`postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.
This is the Docker Official Image `postgres:17-alpine` index digest listed on [Docker Hub](https://hub.docker.com/_/postgres/tags?name=17-alpine)
and mapped by [docker-library/official-images](https://github.com/docker-library/official-images/blob/master/library/postgres)
to the official Postgres source build (`17.11-alpine3.24`, source commit
`2603e26e245e558218728ee14e0a42dcb020dc7f`). To update the pin, submit a separate reviewed
change that resolves the new full OCI index digest from Docker Hub, verifies its tag and
architecture manifests against the official-images mapping and source commit, and records that
provenance beside the pin. Never refresh the workflow image from a mutable tag automatically.

Download and preserve the encrypted artifact in the already-approved owner-controlled backup
archive before its artifact retention expires. The decryption key must be available from the
separate secret vault during recovery. A green workflow means the migration is ready for a
separate owner authorization; it does not authorize or execute a migration.

If the workflow finds an incomplete migration row, unexpected pending migration, any Stage 02
object already present while the migration is pending, an unreadable table, or a long transaction
or relevant lock, stop. Preserve the run output and backup artifact. Because these SQL files do
not have explicit transaction wrappers, inspect `_prisma_migrations.logs` and the exact columns,
tables, enum labels, indexes, constraints, and foreign keys from the failed migration before
planning recovery. Do not blindly rerun `prisma migrate deploy`, delete or rewrite
`_prisma_migrations` rows, or manually drop/create migration objects. Recovery requires a
reviewed, state-specific DBA plan after the backup is verified.

The Prisma model currently omits a schema-level default for
`StrengthSessionAccountingOperation.status`, while the existing SQL migration defaults it to
`PENDING`. Current application writes explicitly set `PENDING`, `COMPLETED`, or `RETRYABLE`, so
the mismatch is recorded as a nonblocking follow-up and this tooling does not rewrite migration
history to resolve it. A future schema/default change must be reviewed separately.

The Prisma model also declares `@@unique([id, currentSnapshotRevision])`, which has no matching
standalone unique index in the Stage 02 SQL. The `id` primary key already guarantees uniqueness
of that pair, and the current-snapshot foreign key is backed by the separate unique
`(sessionId, snapshotRevision)` key on the snapshot table. Prisma Client's pair lookup therefore
retains the same single-row guarantee; this is redundant schema metadata rather than a migration
correctness defect. Keep it as a nonblocking schema-drift follow-up; do not edit the applied
migration.

The preflight is a point-in-time observation, not a lock reservation. Rerun it immediately before
any separately authorized migration and stop if new long transactions, locks, or schema changes
appear.

After a green preflight and explicit owner authorization, the exact migration command on the
production host is:

```bash
CONFIRM_PRODUCTION_MIGRATE=migrate scripts/deploy-migrate.sh
```

Do not run that command as part of the readiness workflow or automatic application deployment.
