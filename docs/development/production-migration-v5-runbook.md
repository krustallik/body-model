# Production migration V5 runbook

This runbook describes the guarded, manual Prisma migration release path. It does not authorize or run a production preflight, backup, migration, or deployment by itself.

## Safety model

- Only repository `krustallik/body-model`, branch `main`, and its freshly fetched canonical `main` tip are accepted. `origin/main` is checked too, but is not the sole authority.
- A closed manifest names the exact Active Energy migration set. The previously applied Stage 02 migrations have their own reviewed Git-blob checksums and must already be recorded as successful. Extra, missing, duplicate, failed, rolled-back, or checksum-mismatched migration history blocks release for manual review; tooling never edits `_prisma_migrations`.
- Manifest SHA-256 is calculated from raw committed Git blob bytes at the exact release SHA. On the execution host and inside the migrator image, every migration file must byte-match that blob. No LF/CRLF normalization is allowed.
- Prisma's stored `_prisma_migrations.checksum` is verified separately by the pinned `prisma@6.19.3` isolated PostgreSQL fixture.
- The preflight workflow reads production state, captures an encrypted backup, restores it to a disposable PostgreSQL service, verifies migration history/schema/readability, and rehearses the exact target migrations there. Its `migrate deploy` command points only to the disposable restored database. It never runs production DDL.
- Preflight admission and migration execution share the top-level, non-cancelling `bodycast-production-migration` GitHub concurrency group. A preflight request is admitted when GitHub supplies its trusted `run_started_at`; queued/pending requests without that timestamp do not supersede an authorization. Among matching admitted runs, the newest admission wins, including failed, cancelled, or in-progress attempts. The exact preflight run ID, attempt, and admission timestamp are signed into the authorization and bound into the one-time OIDC audience.
- The protected DDL launcher verifies a short-lived GitHub OIDC JWT against GitHub's public signing keys and binds its repository, production workflow/ref/SHA, run ID/attempt, signed authorization, latest admitted preflight, and one-time host challenge. It independently reads the current run status from GitHub; caller-supplied `migration-run.json` metadata is not accepted. No execution private key is created or transferred, and the production host receives no signing secret. The launcher reselects the latest admitted preflight before it probes the final Prisma `DATABASE_URL`. That identity probe is the final awaited external operation before synchronous Prisma spawn; a changed target blocks before DDL.
- The production-migration-authorization environment signs a canonical Ed25519 envelope. The production execution environment receives no signing private key. The remote execution fetches canonical `main`, checks the exact release checkout, computes a fresh read-only production report, verifies the signed claims and guard receipt, then invokes Prisma and postflight in one remote process.
- The backup snapshot start is recorded by the production host immediately before `pg_dump`. The authorization and the actual Prisma launcher both enforce the 60-minute snapshot-to-DDL limit. Prisma receives PostgreSQL `lock_timeout=5000`; migration execution is not retried automatically.
- Production postflight compares migration history and the reviewed schema inventory/signatures with the schema digest produced by migration rehearsal on the restored backup.

## GitHub environment separation

Configure and review environment protection before using these workflows. This implementation does not read or change GitHub environment settings or secrets.

| Environment | Workflow job | Secret names used |
| --- | --- | --- |
| `production` | Preflight/backup/restore | `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_HOST_FINGERPRINT`, `PRODUCTION_BACKUP_ENCRYPTION_KEY` |
| `production-migration-authorization` | Sign authorization only | `PRODUCTION_MIGRATION_SIGNING_KEY_ID`, `PRODUCTION_MIGRATION_ED25519_PRIVATE_KEY` |
| `production` | Final execution | `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_HOST_FINGERPRINT`, `DEPLOY_PATH` |

Before release, an environment administrator should verify repository/org/environment secret scopes, required reviewers, self-review policy, admin bypass, and deployment branch restrictions. The signing key must exist only in `production-migration-authorization`; SSH and backup credentials must exist only in `production`. The signing job must not receive production SSH/DB/backup secrets, and the execution job must not receive the signing private key.

## Signing key provisioning and rotation

The checked-in [`production-migration-verification-keys.json`](../../scripts/production-migration-verification-keys.json) is the public-key trust list. It intentionally contains no accepted keys until an owner provisions one through a reviewed repository change. The release workflow fails closed while the list is empty.

Generate an Ed25519 key pair using the organization's approved secret-management process. Add only the public key PEM and a unique `keyId` with status `active` to the reviewed allowlist, then configure the matching key ID and private key PEM as secrets in `production-migration-authorization`. Never commit, upload as an artifact, or place the private key in `production`, the repository, a runner cache, or the execution host. For rotation, add the new public key and provision its matching authorization-environment secret, verify the new key, then mark/remove the retired public key; revoked/removed keys fail closed.

## Operator sequence

1. Review the release diff and exact manifest migration hashes. Confirm canonical `main` and required CI are green.
2. Dispatch **Production migration preflight and encrypted backup** from `main` with the exact release SHA, manifest ID, and `inspect-backup-restore` confirmation. Inspect its summary and immutable evidence/backup artifact IDs and digests. A failed, cancelled, or still-running newer attempt means the prior successful preflight cannot be used.
3. After reviewing the evidence, dispatch **Manual production migration** from `main` with the same SHA and manifest and type `MIGRATE_PRODUCTION`. The protected authorization environment creates an Ed25519 authorization only if current main, latest preflight attempt, artifacts, restore, and signed claims still match.
4. The protected execution job streams only the small signed context to the production host. The encrypted backup remains a separate artifact and is not sent to the execution job. The remote guard checks canonical `main`, clean exact checkout, Git-blob and execution-file bytes, live database identity, complete pending set, locks, stage objects, signed workflow identity, receipt freshness, and snapshot age before DDL.
5. Review the job summary and postflight result. Any mismatch, lock timeout, expired backup, stale workflow evidence, or schema/history drift blocks or fails the run; do not retry automatically. Investigate and create a new preflight attempt as appropriate.

## Local validation

The safety CI workflow runs the V5 unit matrix, legacy backup/restore safety tests, the shell contract tests, migrator image byte verification, and a pinned Prisma/PostgreSQL checksum plus lock-timeout integration fixture against disposable local PostgreSQL. The local fixture refuses a non-loopback database URL and creates/drops its own temporary schema. Never point the fixture or restore rehearsal at production.

The five reviewed SHA-256 values are maintained in `scripts/production-migration-manifests.mjs` and are checked from Git blobs by the preflight and execution integrity gates. Changing a migration requires a new reviewed manifest/checksum and appropriate release review; do not update an existing reviewed hash to silence a failed check.
