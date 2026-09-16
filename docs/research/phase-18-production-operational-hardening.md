# Phase 18 — Production and operational hardening

## Production environment requirements

Production requires `NODE_ENV=production`, a PostgreSQL `DATABASE_URL`, and an
`IOS_SHORTCUT_API_KEY` of at least 16 characters. Startup validation rejects missing,
malformed, and documented placeholder credentials. Keep `.env` outside images and source
control; inject secrets through the deployment platform. URL-encode database passwords.
Never place secrets in `NEXT_PUBLIC_*` variables.

The production image runs as an unprivileged user. PostgreSQL is isolated on the internal
Docker network and is not published to the host. `/api/health` is a cheap process liveness
probe; `/api/readiness` performs only `SELECT 1` and returns 503 when PostgreSQL is unavailable.

## Authentication and security audit

The Apple Health ingestion API and `/api/v1/model/*` automation APIs use constant-time
`X-API-Key` verification. Browser-facing single-user routes retain the accepted local-app
trust boundary; exposing them directly to an untrusted network remains unsupported and a
reverse-proxy access policy is required. Inputs use strict Zod schemas and JSON bodies are
limited to 1 MiB. Prisma parameterized operations are used in application paths. Error
responses use stable codes and omit stack traces, SQL text, credentials, raw source payloads,
recovery particles, and forecast paths. The development-only forecast clock override is
disabled whenever `NODE_ENV=production`.

## Logging

The minimal logger emits one-line JSON with timestamp, level, event, and low-cardinality safe
metadata. Fields whose names indicate API keys, authorization, cookies, passwords, secrets,
payloads, particles, or paths are removed. Startup, health sync, diagnostics, Forecast, and
Goal Solver unexpected failures are logged by type only. Container stdout/stderr should be
collected with retention and alerting at the platform layer.

## Backup and restore

Create a custom-format backup without ownership or ACL data:

```powershell
npm run backup:postgres -- -Output .\backups\bodycast-2026-08-26.dump
```

Verify it by restoring into a uniquely named disposable database; the script checks completed
Prisma migrations and always drops the disposable database:

```powershell
npm run verify:postgres-restore -- -Backup .\backups\bodycast-2026-08-26.dump
```

If either command fails, retain the dump and command output, resolve storage/container issues,
and retry. Never restore over the active database. For disaster recovery, stop writes, restore
to a new database, run `prisma migrate status`, point a canary application at it, verify
readiness and representative records, then switch traffic. Encrypt backups, restrict access,
copy them off-host, define retention, and periodically repeat the disposable restore test.

## Migration safety

Build and test the exact release artifact, take and verify a backup, then run:

```text
npx prisma validate
npx prisma generate
npx prisma migrate status
npx prisma migrate deploy
```

Use `migrate deploy` only; never use `migrate dev`, `db push`, or destructive reset commands in
production. Run the separate `migrate` image as a one-shot deployment step before application
rollout. Phase 18 adds no schema migration.

## E2E strategy and performance

The PostgreSQL integration lifecycle covers profile/current observations → model state →
diagnostics → 30/90-day forecast → 30/90-day goal solve and a blocked/no-evidence path. Browser
smoke checks cover populated Forecast, Goal, Diagnostics, navigation, dark mode, a 390×844
viewport, loading/error states, console output, and native keyboard toggling of Diagnostics
`details`. Benchmarks retain accepted path counts and report runtime, transitions/evaluations,
and approximate memory; no numerical or scientific behavior is changed for speed.

Fresh Windows host measurements (Node 22.14.0) retained the established benchmark quality:

| Flow | Configuration | Runtime | Result |
| --- | ---: | ---: | --- |
| Forecast 30d | 512 paths | 210.5 ms | 512/512 valid, standard |
| Forecast 90d | 512 paths | 634.3 ms | 512/512 valid, standard |
| Forecast 30d | 2,048 paths | 1,566.6 ms | 2,048/2,048 valid, standard |
| Forecast 90d | 2,048 paths | 4,748.0 ms | 2,048/2,048 valid, standard |
| Goal solve 30d | search 128/final 512 | 759.9 ms | solved, 10 evaluations |
| Goal solve 90d | search 128/final 512 | 3,087.4 ms | solved, 14 evaluations |

The real PostgreSQL integration suite completed 27/27 tests in 6.46 s; its populated model
lifecycle includes recalculation, Diagnostics, Forecast, Goal Solver, Recovery, and read-only
assertions. No pathological behavior or invalid paths appeared. The 90-day 2,048-path Forecast
is the clearest latency hotspot; the operation gate bounds overlapping work without changing
path counts or numerical behavior.

The disposable backup was 50,767 bytes and restored successfully with all 13 completed Prisma
migrations present before the temporary database was dropped.

## Operational failure modes

- Database unavailable: liveness stays 200, readiness becomes 503, dependent APIs return safe
  failures; keep the instance out of traffic until readiness recovers.
- Duplicate expensive browser request: the per-process operation gate returns 429 with
  `Retry-After: 1`; clients may retry after the active operation completes.
- Invalid or oversized body: return 400 or 413 before expensive work.
- Bad secrets/configuration: process startup fails before serving traffic.
- Monte Carlo failure: return a stable 500 code and log only event/error type.
- Multi-replica deployments: the in-process overlap guard is replica-local; enforce concurrency
  and request timeouts at the reverse proxy until a shared job queue is introduced.

## Deployment checklist

1. Verify secrets and least-privilege database credentials.
2. Run tests, coverage, typecheck, lint, production build, and Prisma checks.
3. Create and disposable-restore a fresh encrypted backup.
4. Run `prisma migrate deploy` as a separate one-shot job.
5. Deploy the immutable image; verify `/api/health` and `/api/readiness`.
6. Run populated desktop/mobile smoke checks and inspect browser/server logs.
7. Confirm Forecast, Goal Planning, and Diagnostics produced no database writes.
8. Monitor 5xx, 429, readiness failures, latency, memory, disk, and backup age.

## Remaining risks

Browser-facing routes assume a trusted single-user deployment and require external access
control on a public network. The overlap gate is process-local and work already running cannot
be cancelled. Logs need an external collector and alert policy. Backup encryption, retention,
off-site replication, restore objectives, and proxy timeouts depend on the deployment platform.
