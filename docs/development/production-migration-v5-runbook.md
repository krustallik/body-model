# Production migration V5 runbook

This runbook describes the owner-authorized manual release path for the six-migration `active-energy-unified-v2` release. A merge or green CI does not deploy this incompatible-schema release. Every production workflow requires a `main` dispatch for the exact current SHA, green CI for that SHA, trusted owner identity `126446430`, and its explicit confirmation input.

## Compatibility decision

The old app at base `e84a627864fe86097596b921d4a2b27dd0f5798e` generates Prisma upserts using `profileId_date` for both `ExperimentalSkeletalMuscleDeltaShadow` and `ExperimentalCessationDetrainingShadow`. The Relative Muscle migrations drop those unique indexes and replace them with episode-aware `(profileId, modelEpisodeId, date) NULLS NOT DISTINCT` uniqueness. The old app therefore cannot safely run against the migrated schema. This release uses a maintenance cutover; it does not add a compatibility index or change episode semantics.

Before DDL, the preflight workflow must:

1. Publish the exact 503 maintenance route and confirm the public endpoint serves it.
2. Disable automatic restart, stop and remove the old app container. An exited container is insufficient because it could be restarted against the incompatible schema.
3. Confirm no other client container remains on `bodycast-backend-prod`, PostgreSQL has no published port and is attached only to that internal network, and `gymbeam-caddy` validates the maintenance route. Unknown containers, external DB routes, NAT/proxy ambiguity, missing evidence, or a still-present app container fail closed.
4. Keep Caddy maintenance enabled until the exact authorized release SHA is healthy, V3 postflight passes, V4 activation/replay is explicitly completed, and V4 currentness/coverage checks pass.

The preflight SQL records the named `bodycast-production-preflight` observer PID and every other PostgreSQL client backend without relying on `client_addr` for identity. Any other client blocks, including a backend with an empty/unknown application name. Host topology evidence is captured from Docker/Caddy and included in the preflight report. The report, restore rehearsal, artifact digests, writer drain, and exact release identity are bound into the Ed25519 owner authorization. Immediately before DDL, the fixed SSH migration script rechecks canonical main, committed migration bytes, live database identity, backup freshness, and PostgreSQL client inventory. Reconnected or unclassified clients block DDL.

The currently reviewed production topology contract is the local Compose stack in `docker-compose.prod.yml`: `bodycast-db-prod` is reachable only on the internal `bodycast-backend-prod` network; the app uses that network and `gymbeam-internal`; Caddy is `gymbeam-caddy`; and the host route is `bodycast.caddy`. A different topology, database proxy, published port, or NAT path is unsupported by this evidence contract and must remain blocked until its client identity and drain proof are reviewed and implemented. Do not waive the topology check or treat `pg_stat_activity.client_addr` as sufficient evidence.

## Migration set and exact bytes

`active-energy-unified-v2` authorizes exactly these six pending migrations:

| Migration | Git-blob SHA-256 |
| --- | --- |
| `20261002100000_active_energy_canonical_resolution` | `45711a527d809775a5ce66d3d9e529954158dcb65ed0065f70a0f948a4693a0b` |
| `20261002150000_add_production_publication_generation` | `9f1e38182dc3ec2449da5297786b603d8c0370498ed68db97059f640220bbbd7` |
| `20261003120000_add_episode_aware_unified_experimental_physiology_v2` | `0bb495d988ead0c1729f8e657b85f85bc4c20673fdedd5b61a7644cb0dcaf9b6` |
| `20261005120000_episode_relative_muscle_core` | `afef76464e4e77e6fd13a6ed6f8b04a6972d98229e3c5fc12a7e7dd8e3fd6588` |
| `20261006110000_relative_muscle_legacy_identity` | `56d8a64d4c966428835a96058783d01c4eac5984f8ed51928d26b13d6290208e` |
| `20261006130000_unified_v4_glycogen_water_rollout` | `9e50a8f33ec93e5f7d74681a611bd7272038f7e5e25563054f4a4dbb093b5408` |

The two Stage 02 strength-accounting migrations are prerequisites and must already be recorded once with their reviewed checksums. No extra, missing, failed, duplicate, rolled-back, or checksum-mismatched history is accepted. Preflight requires the old Relative Muscle indexes with their reviewed definitions. Postflight verifies the two dropped indexes are absent, both legacy tables retain `modelEpisodeId` and `isStale`, and the composite ModelEpisode uniqueness, episode/profile foreign keys, episode/stale/date indexes, and final NULLS NOT DISTINCT indexes match the reviewed signatures. Blob checks use exact committed bytes; LF/CRLF normalization is forbidden. Prisma’s stored checksum is checked separately against the pinned `prisma@6.19.3` behavior.

## Owner-authorized execution and order

1. Review canonical `main`, exact release SHA, successful CI for that SHA, and the six hashes above.
2. Dispatch **Production migration preflight and encrypted backup** from `main` with that SHA, manifest `active-energy-unified-v2`, and confirmation `maintenance-backup-restore`. The workflow publishes and confirms maintenance, stops/removes the old app, checks read-only DB identity/history/schema/locks and writer topology, creates an encrypted backup, then restores it and rehearses the migrations only on isolated disposable PostgreSQL. Review the report, restore result, artifact, and digests before continuing.
3. Dispatch **Manual production migration** from `main` with the same SHA and manifest and confirmation `MIGRATE_PRODUCTION`. The owner-only signing job binds the exact pending set, source identity, preflight, backup, restore rehearsal, and writer-drain evidence. The execution job rechecks canonical `main`, clean exact checkout, all six committed SQL blobs, migrator image bytes, backup freshness, live DB identity and writer drain. The durable `ddl-started` marker is written immediately before the single Prisma container invocation. It records possible schema uncertainty; it does not prove Prisma started or PostgreSQL received DDL. From this boundary, keep the app stopped and traffic in maintenance until the exact compatible release succeeds or a separately verified pre-DDL restore completes.
4. Prisma runs once with PostgreSQL `lock_timeout=5000`; the script blocks rerunning while the marker exists. Failure leaves the app stopped, Caddy in maintenance, and the marker at `ddl-started`. After success, read-only postflight must match the disposable restore before the marker advances to `schema-applied`.
5. Dispatch **Manual production app deploy** from `main` with the same SHA, confirmation `deploy`, and non-serving mode enabled. The candidate starts only behind maintenance and only when the marker matches its exact SHA and state. Health and immutable image/SHA identity must pass before the marker advances to `app-ready`.
6. Dispatch **Owner-authorized Unified V4 activation and traffic serve** for the same exact current-main SHA with `ACTIVATE_UNIFIED_V4_AND_SERVE`. The workflow checks V3 postflight, explicitly activates/replays V4, checks currentness and coverage, then changes the serving route only if every gate passes.

Ordinary API/container startup and app deploy do not run Prisma migrations or V4 activation/replay. Merge and green CI do not auto-deploy. An active marker blocks an old/mismatched SHA, serving deployment, or migration retry. Do not run `docker compose up app` manually while the marker exists; use the exact-SHA non-serving workflow after the migration has completed.

## Failure and recovery rules

- **Before the marker exists:** migration execution has not crossed its irreversible boundary and this attempt has not spawned Prisma. The schema remains at the prior release. Resolve the preflight/authorization issue; if returning to service, use the reviewed maintenance procedure to restart the prior exact app SHA only after confirming the old schema remains intact. Keep maintenance when writer state is uncertain and never reuse stale writer evidence.
- **After `ddl-started` is written but before or around Prisma spawn:** treat the schema as potentially changed, even if the container did not start, the process exited immediately, or logs show no DDL. Keep the marker, keep the app stopped, and keep Caddy on 503. Process exit, a missing Prisma log, or an operator belief that DDL did not run is not grounds to clear the marker or deploy the old SHA. Diagnose the failure; do not retry migrations in place without a separately reviewed recovery decision.
- **During or after DDL:** treat the database as potentially partially migrated. Keep the marker, app stopped, and Caddy on 503. Preserve the failed database and logs for diagnosis. Do not restart the old image and do not retry migrations in place.
- **After DDL, before the compatible app is healthy:** keep `schema-applied`/`ddl-started` marker and maintenance. Retry only the exact-SHA non-serving app deployment after diagnosing startup; do not repeat Prisma migration. The marker prevents deployment of the prior binary.
- **After the new app starts, before V4 replay:** keep `app-ready` and maintenance. Fix/complete only the explicit V3/V4 rollout path. Forecast V2 traffic remains blocked while currentness or coverage is missing.
- **During V4 replay:** leave Caddy on 503 and preserve the app/marker and database evidence. Resume only through the explicit replay tooling after examining its idempotency/currentness report; do not clear the marker or reopen traffic on partial output.
- **Restore/cutback after the marker:** the only route back to the prior binary is the separately reviewed pre-DDL restore path. Do not point it at the migrated/failed database. Decrypt the exact pre-DDL backup, restore it into a fresh isolated PostgreSQL instance, and verify database identity, migration history, schema inventory, data readability, and equality with the signed pre-DDL source report. Keep the failed database intact. The DBA/release owner must approve the cutback and record the restore verification; only then may the operator explicitly clear the persistent marker and point the prior exact app SHA at the verified restored schema. The marker is not cleared automatically on process failure or based on an inference that DDL did not run. The backup/restore smoke tests exercise encryption, integrity rejection, restore readability, and schema/history equality; production restore is not automated by this release tooling.

## Validation and environment separation

Configure and review GitHub environment protection before using the workflows. The tooling does not read or change environment settings or secrets.

| Environment | Workflow purpose | Secret names |
| --- | --- | --- |
| `production` | Maintenance topology, preflight, backup, restore rehearsal | `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_HOST_FINGERPRINT`, `DEPLOY_PATH`, `APP_HOST`, `CADDY_ROUTES_PATH`, `PRODUCTION_BACKUP_ENCRYPTION_KEY` |
| `production-migration-authorization` | Sign authorization only | `PRODUCTION_MIGRATION_SIGNING_KEY_ID`, `PRODUCTION_MIGRATION_ED25519_PRIVATE_KEY` |
| `production` | Final protected execution | `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_HOST_FINGERPRINT`, `DEPLOY_PATH`, `APP_HOST`, `CADDY_ROUTES_PATH` |

The signing key exists only in `production-migration-authorization`; SSH and backup credentials exist only in `production`. The execution job never receives the signing private key, and the signing job never receives production SSH/DB/backup secrets.

Safety CI verifies all six manifest hashes, exact pending sets, migration artifact bytes, Relative Muscle schema signatures, populated legacy-row migration, old `profileId_date` client rejection after migration, writer reconnect/unknown-client/topology blockers, Prisma lock timeout and target identity, plus encrypted backup/restore safety on isolated PostgreSQL. Use only local/CI databases with explicit test identities. Never point these scripts at production except through the separately authorized workflows described above.
