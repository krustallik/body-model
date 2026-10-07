# Production migration V5 runbook

This runbook describes the guarded manual migration path for the six-migration `active-energy-unified-v2` release. It does not authorize or run production maintenance, backup, migration, application deployment, V4 activation/replay, or traffic cutover by itself. Each production action still requires the separately protected workflow/operator authorization.

## Compatibility decision

The old app at base `e84a627864fe86097596b921d4a2b27dd0f5798e` generates Prisma upserts using `profileId_date` for both `ExperimentalSkeletalMuscleDeltaShadow` and `ExperimentalCessationDetrainingShadow`. The Relative Muscle migrations drop those unique indexes and replace them with episode-aware `(profileId, modelEpisodeId, date) NULLS NOT DISTINCT` uniqueness. The old app therefore cannot safely run against the migrated schema. This release uses a maintenance cutover; it does not add a compatibility index or change episode semantics.

Before DDL, the operator must:

1. Switch the BodyCast Caddy route to the exact 503 maintenance response with `APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh maintenance`.
2. The maintenance command disables automatic restart, stops the old app, and removes its container. Verify `bodycast-app-prod` is absent; an exited container is insufficient because it could be manually restarted against the incompatible schema.
3. Confirm no other client container remains on `bodycast-backend-prod`, PostgreSQL has no published port and is attached only to that internal network, and `gymbeam-caddy` validates the maintenance route. Unknown containers, external DB routes, NAT/proxy ambiguity, missing evidence, or a still-present app container fail closed.
4. Keep Caddy maintenance enabled until the exact authorized release SHA is healthy, V3 postflight passes, V4 activation/replay is explicitly completed, and V4 currentness/coverage checks pass.

The preflight SQL records the named `bodycast-production-preflight` observer PID and every other PostgreSQL client backend without relying on `client_addr` for identity. Any other client blocks, including a backend with an empty/unknown application name. Host topology evidence is captured from Docker/Caddy and included in the preflight report. Both report and topology digests enter the Ed25519 signed authorization. The host re-reads the report and topology after the OIDC challenge; the Prisma DDL launcher performs a final PostgreSQL backend inventory immediately before spawning `prisma migrate deploy`. Reconnected or unclassified clients block DDL.

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

## Protected execution and order

1. Review canonical `main`, exact release SHA, successful required CI, and all six hashes above.
2. Put traffic into maintenance, disable restart, stop and remove the old app container as described above. Keep the marker/worktree path intact. A failed topology or drain check means stop; do not continue to preflight authorization.
3. Dispatch **Production migration preflight and encrypted backup** from `main` with the exact SHA, manifest `active-energy-unified-v2`, and `inspect-backup-restore`. The workflow checks the maintenance/topology precondition, read-only database identity/history/schema/locks, and zero other PostgreSQL client backends; it then creates an encrypted backup and restores/rehearses it only on the isolated disposable PostgreSQL service. Review the exact report, restore result, backup artifact, and digests.
4. Dispatch **Manual production migration** from `main` with the same SHA and manifest. The protected authorization workflow signs the exact pending set, source identity, preflight, backup, restore rehearsal, writer-drain, and topology digests. The host rechecks canonical `main`, clean exact checkout, all six committed SQL blobs, migrator image bytes, live PostgreSQL drain, and maintenance topology. After the challenge-bound OIDC round trip it performs a second live drain/topology read and final guard. A persistent marker is written as `ddl-started` before DDL, so failures after that point cannot fall through into an ordinary deployment or old-app restart.
5. Prisma runs once with PostgreSQL `lock_timeout=5000`; no retry runs automatically. A failed command leaves the app stopped, Caddy in maintenance, and the marker at `ddl-started`. After DDL succeeds, V3 postflight schema/history verification must match the disposable restore. Only then does the marker advance to `schema-applied`.
6. Deploy the same exact release SHA with the protected **non-serving deployment** option. The marker requires an exact SHA match and prevents serving mode. The new app must become healthy while Caddy stays on 503. On success, the marker advances to `app-ready`; failed startup leaves maintenance active and the prior binary stopped.
7. With the exact new app healthy behind the still-active 503 route, run `APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh v3-postflight`. It verifies and publishes the V3 epoch-0 checkpoint while traffic remains in maintenance. Then, with separate owner authorization, run Unified V4 activation/replay using the exact release’s migrator image. Forecast V2 remains blocked until activation/replay finishes and `unified-v4-traffic-check` confirms currentness and coverage for the required profile. These are separate production actions; migration and app startup do not run them automatically.
8. Run the exact-SHA `production-traffic-cutover.sh serve` path. It rechecks the marker against the running app’s `org.bodycast.release-sha` label, V3 postflight, V4 currentness/coverage, and health before changing Caddy to `reverse_proxy`. If the route/health check fails, it restores 503, disables restart, stops the app, and keeps the marker. Only a successful health check clears the one-time cutover marker and reopens ordinary traffic.

Ordinary API startup, container startup, and automatic deploy do not run Prisma migrations or V4 activation/replay. An active marker blocks an old/mismatched SHA, serving deployment, or marker reuse. Do not run `docker compose up app` manually while the marker exists; use the exact-SHA protected non-serving deployment path.

## Failure and recovery rules

- **Before DDL / before `ddl-started`:** no schema incompatibility has been introduced. Keep maintenance if writer state is uncertain. Correct the preflight issue and create a new preflight/authorization attempt; never reuse stale writer evidence. If DDL is confirmed not to have started, an owner may redeploy the prior exact app SHA against the unchanged schema through the ordinary guarded deployment path.
- **During or after DDL / marker `ddl-started`:** treat the database as incompatible even if only some statements appear to have completed. Keep the app stopped and Caddy on 503. Preserve the failed database and logs for diagnosis. Do not restart the old image and do not retry migrations in place.
- **After DDL, before the compatible app is healthy:** keep `schema-applied`/`ddl-started` marker and maintenance. Retry only the exact authorized SHA after diagnosing the failed startup. The marker prevents automatic or normal deployment from starting the prior binary.
- **After the new app starts, before V4 replay:** keep `app-ready` and maintenance. Fix/complete only the explicit V3/V4 rollout path. Forecast V2 traffic remains blocked while currentness or coverage is missing.
- **During V4 replay:** leave Caddy on 503 and preserve the app/marker and database evidence. Resume only through the explicit replay tooling after examining its idempotency/currentness report; do not clear the marker or reopen traffic on partial output.
- **Restore/cutback after an incompatible DDL failure:** do not point the old binary at the migrated database. The tested recovery path is to decrypt the exact pre-DDL backup and restore it into a fresh isolated PostgreSQL instance, verify database identity, migration history, schema inventory and readability against the signed source report, then have the DBA/release owner explicitly choose a separately reviewed restore/cutback. Keep the failed database intact. Only after the restored database is independently verified and the app is pointed to that restored schema may an owner-approved compatible application be started. The backup/restore smoke tests exercise encryption, integrity rejection, restore readability, and schema/history equality; production restore is not automated by this release tooling.

## Validation and environment separation

Configure and review GitHub environment protection before using the workflows. The tooling does not read or change environment settings or secrets.

| Environment | Workflow purpose | Secret names |
| --- | --- | --- |
| `production` | Maintenance topology, preflight, backup, restore rehearsal | `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_HOST_FINGERPRINT`, `DEPLOY_PATH`, `APP_HOST`, `CADDY_ROUTES_PATH`, `PRODUCTION_BACKUP_ENCRYPTION_KEY` |
| `production-migration-authorization` | Sign authorization only | `PRODUCTION_MIGRATION_SIGNING_KEY_ID`, `PRODUCTION_MIGRATION_ED25519_PRIVATE_KEY` |
| `production` | Final protected execution | `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_HOST_FINGERPRINT`, `DEPLOY_PATH`, `APP_HOST`, `CADDY_ROUTES_PATH` |

The signing key exists only in `production-migration-authorization`; SSH and backup credentials exist only in `production`. The execution job never receives the signing private key, and the signing job never receives production SSH/DB/backup secrets.

Safety CI verifies all six manifest hashes, exact pending sets, migration artifact bytes, Relative Muscle schema signatures, populated legacy-row migration, old `profileId_date` client rejection after migration, writer reconnect/unknown-client/topology blockers, Prisma lock timeout and target identity, plus encrypted backup/restore safety on isolated PostgreSQL. Use only local/CI databases with explicit test identities. Never point these scripts at production except through the separately authorized workflows described above.
