# Production deployment operations

## Architecture (CURRENT)

- Controller: GitHub Actions only (`BodyCast production deploy`).
- Host: VPS over SSH (`appleboy/ssh-action`).
- Runtime: Docker Compose (`docker-compose.prod.yml`) — `app` + Postgres.
- Edge: Caddy (`gymbeam-caddy`) reverse proxy to `bodycast-app-prod:3000`.
- Ordinary release script: `scripts/deploy.sh` (exact `DEPLOY_SHA`, **no migrate**).
- Schema preflight: `scripts/deploy-preflight-schema.sh` (`prisma migrate status` only).
- Separate migrate script: `scripts/deploy-migrate.sh` (requires `CONFIRM_PRODUCTION_MIGRATE=migrate`; **not** wired to automatic deploy).
- Production migration readiness: manual `Production migration preflight and encrypted backup` workflow; inspection and backup only, never migration.

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
4. Deploy checks out that exact SHA on the server.
5. Schema preflight runs **before** app cutover. If production schema has pending migrations, deploy **blocks** (exit 2) and leaves the running app container unchanged. Ordinary deploy never runs `prisma migrate deploy`.
6. Only after preflight succeeds does deploy build/recreate the app container.
7. Health: container readiness + `https://$APP_HOST/api/health`.

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
  unpinned or mismatched host key.
- `PRODUCTION_BACKUP_ENCRYPTION_KEY`: canonical base64 for a randomly generated 32-byte key.
  Store it only as a protected production-environment secret and separately in the approved
  owner-controlled secret vault. Never put it in the repository, workflow input, logs, or backup
  artifact.

The workflow opens only read-only PostgreSQL transactions for live inspection, checks the
production DB/container identity, migration rows and partial Stage 02 objects, approximate row
counts and relation sizes, long transactions, and relevant locks. It only proceeds when the
pending migration set is exactly `20260929170000_training_load_accounting_v1` and
`20260929190000_persist_strength_accounting_v1`, with no failed/incomplete rows or pre-existing
objects from those migrations. It then streams `pg_dump --format=custom` over the verified SSH
connection into an AES-256-GCM envelope without writing a plaintext dump on production or the
runner. The encrypted artifact is uploaded to the repository's GitHub Actions artifact storage
for 90 days, then decrypted only as a stream into the workflow-owned disposable PostgreSQL 17
service. The restore check compares migration-history rows to the live preflight report and
reads the restored `StrengthDiarySession` and `ExerciseCatalog` tables. The job never invokes
`prisma migrate deploy`, DDL, DML, a production backfill, or a manual migration-table edit.

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
