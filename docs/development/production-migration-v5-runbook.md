# Production migration and release

This runbook describes the current owner-authorized release path. A merge or green CI does not run Prisma migrations or deploy to production.

## Required invariants

- Production DDL requires a separate owner confirmation bound to the exact release SHA and the digest of the pending migration set.
- The pending set is discovered from `prisma/migrations` at the exact release SHA and compared with successful `_prisma_migrations` history and checksums. Adding a migration does not require updating an ID allowlist.
- Before DDL, preflight confirms the live database identity and migration state, captures the current healthy app and any existing release marker, creates an encrypted backup, restores it to disposable PostgreSQL, and rehearses the discovered migrations there.
- Before DDL, the host holds the shared production release lock, confirms no competing writers, and rechecks database identity and the exact pending-set digest.
- An app container never runs migrations during startup. The app deployed after DDL must use the same SHA that was rehearsed and authorized.
- If the Auth app-ready marker is present, its exact observed bytes and the serving app identity must still match the fresh preflight before DDL. Do not edit or clear a marker manually.

## Release sequence

1. Dispatch from canonical `main` for its exact current SHA. Require successful CI for that SHA and the pinned owner identity.
2. Run a fresh read-only production preflight. It discovers all pending migration directories, validates applied history/checksums, and produces the pending-set digest included in the preflight evidence.
3. Confirm the current app is healthy, inspect the database and active writers, enter maintenance, and stop the old app only after its rollback image and runtime identity are captured.
4. Create and verify the encrypted live backup. Restore it in the isolated PostgreSQL service, apply the exact discovered migrations, and require postflight to report no pending migrations and a readable restored database.
5. Obtain the separate exact-binding owner DDL authorization. The production migration job rechecks the exact SHA, database target, backup, pending-set digest, marker, and writer drain immediately before writing the durable DDL marker and invoking Prisma.
6. Deploy the same SHA as a non-serving app, verify container readiness and application health, then open traffic through the normal cutover command. Verify HTTPS, API, Training, BodyMap, and worker health.

The preflight and migration workflows share a concurrency group; host-side mutation commands also acquire the production release lock. Neither is bypassed by a queued or failed GitHub run. The ordinary release path does not scan historical workflow runs or resume a stale capture. If a capture or marker blocks a run, inspect current host/database state and begin a new preflight with fresh evidence; never overwrite a prior backup or marker.

## Failure handling

- Before the durable `ddl-started` marker, no DDL was authorized by that migration attempt. Resolve the cause and generate fresh preflight/backup/rehearsal evidence before trying again.
- At or after `ddl-started`, treat the database as potentially changed. Leave maintenance and the marker in place, preserve the backup and logs, and do not blindly rerun Prisma or clear the marker.
- Recovery uses the existing owner-authorized cutback workflow only when its fresh evidence proves the backup, database identity, migration history, restored data, and prior app are compatible. Otherwise stop before any destructive database operation and inspect the current state.
- Production DDL, database replacement, and traffic activation are separate protected operations. CI success alone authorizes none of them.

## Targeted validation

For changes to the production migration path, run the relevant focused suites before release:

```sh
npm run test:unit -- tests/production-migration-v5.test.mjs tests/production-release-marker.test.mjs tests/production-release-entrypoints.test.ts tests/deploy-script-ordering.test.ts tests/production-previous-app-provenance.test.mjs tests/production-safety-tooling.test.mjs tests/production-database-cutback.test.mjs
```

The production migration safety workflow also checks the release scripts, isolated PostgreSQL migration smoke, database identity guards, and cutback path. Review the exact main SHA and successful required CI runs before dispatching production workflows.