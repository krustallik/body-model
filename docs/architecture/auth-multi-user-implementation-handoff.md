# BodyCast Auth / Multi-User Finalization Handoff

Updated: 2026-10-28

## Goal and hard boundaries

Complete final QA, independent audit of the exact final source tree, direct fast-forward push to `origin/main`, and successful exact-SHA CI. No PR is intended.

**Production is explicitly out of scope and must remain unchanged.** Do not deploy, run production Prisma migrations/DDL/backfill/restore, bootstrap User 1/Profile 1, activate signup, alter production workers, touch VPS/Caddy, or operate production credentials. A push must not trigger a production operation.

Architecture/product contract: [`auth-multi-user-plan.md`](auth-multi-user-plan.md).

## Actual Git state and preservation

- Repository: `krustallik/body-model`.
- Active worktree: `C:\Users\wowan\.codex\worktrees\auth-multi-user-implementation\physiology-active-energy-integration` (detached; preserve it).
- `HEAD == origin/main == e9e205de1ce17efab89ebbb67eef9f9381fdf458`, tree `8c2a660821feb38e518c3aee603365216883c029`. `e9e205d` is a child of `dc772ef`; the auth/multi-user implementation and registration enumeration fix are already committed on main.
- The preceding independent audit PASS on tree `8c2a660821feb38e518c3aee603365216883c029` applies to the current main baseline only. It does not cover this uncommitted patch.
- Historical counts refer to distinct snapshots: the task attachment reports 212 tracked plus 34 untracked files; the prior committed handoff records an earlier 214-plus-35 snapshot and a later 41 modified tracked files plus `tests/helpers/mock-verified-profile-auth.ts`. The current Git history contains the implementation in `0f93f37..dc772ef` (260 changed files) and the registration/CI follow-up in `dc772ef..e9e205d` (43 changed files); the helper is tracked in current main. There is no old path manifest or immutable tree for the 212/34 or 214/35 snapshots, so those counts cannot be reconciled path by path. Current follow-up diff is 11 implementation/CI/test files plus this handoff (12 files total); no untracked paths are present.
- This worktree currently has no source branch. The `main` branch is checked out in `D:\body-model\.worktrees\bodycast-imported-vps-release` at `0f93f37dd6a4208cfc74331a0fb4c063c542c6bd`; do not modify that worktree. Other listed worktrees are occupied; do not touch them. A commit made here can be pushed as a fast-forward from the detached checkout.

## Current follow-up diff

The 11 tracked implementation/CI/test files changed against `origin/main` are:

```text
.github/workflows/ci.yml
.github/workflows/production-migration-safety-ci.yml
Dockerfile
scripts/ci/production-v4-fence-evidence-postgres-smoke.mjs
src/modules/training/training.repository.ts
tests/integration/exercise-catalog-stable-key.integration.test.ts
tests/integration/exercise-muscle-mapping-snapshot.integration.test.ts
tests/integration/physiology-v7-shadow.integration.test.ts
tests/integration/training-history-stage01.integration.test.ts
tests/integration/work-interval.integration.test.ts
tests/integration/workout-activity-v6.integration.test.ts
```

This diff corrects concrete failures from the red main-push runs `40718432273` and `40718432319` on `e9e205d`:

1. Docker build auth/database environment was scoped only to Prisma generation. Docker now exports synthetic build-only values for both generation and `next build`; no deploy secret is used.
2. The Auth PostgreSQL job tried all 77 migrations on an empty database even though migration `20261027120000_auth_multiuser` requires legacy Profile 1. It now applies the pinned 74-migration baseline, inserts one synthetic Profile 1, then applies the three transition migrations.
3. The safety workflow's `CREATE DATABASE` used `psql` without a password-bearing connection string. It now uses a separate isolated test-admin URL to connect to the service's `bodycast` database; the target Auth rehearsal database URL remains distinct. No auth is disabled or bypassed.
4. `TrainingRepository.createProgramWithVersion` passed scalar `profileId` inside a checked nested Prisma create. It now connects the nested exercise catalog using its `(profileId,id)` key and connects the profile relation; cross-profile FK protection remains enforced.
5. Auth integration now runs in a dedicated postcommit test database. Generic integration shards exclude it. Test routes that now require a verified principal use isolated auth/session setup or the existing verified-principal fixture. Synthetic Profile fixtures satisfy the new ownership FKs, and two suites assert an allowlisted isolated `*_test` database before touching fixtures.
6. The historical V4 smoke now preserves bounded, redacted container stderr so a failed isolated rehearsal exposes its actual cause without printing its database URL.

The CI-only migration order and DB credentials have been inspected statically. The hosted PostgreSQL/Docker workflows must still prove the full sequence on exact SHA.

## QA performed on isolated/local resources

- Integration command on `bodycast_training_postcommit_fresh_test` (local isolated PostgreSQL, no production connection): **7 files, 50 tests passed**: Auth multi-user, Training History Stage 01, exercise muscle snapshots, Workout activity v6, Work Intervals, stable exercise catalog keys, and V7 shadow.
- Targeted unit: `tests/training-program-routes.test.ts` **14/14 passed**.
- `npm run typecheck`: passed.
- ESLint on all changed TS/MJS source and integration files: passed with no output/errors.
- `npm run build` with synthetic auth values and an unreachable loopback test database: passed; Next 16.3.6 compiled and generated all routes.
- Python PyYAML parsed both changed workflows successfully.
- Local test PostgreSQL had the expected 77-migration schema before this run. Docker is unavailable on this Windows host, so the image and exact workflow migration rehearsal remain dependent on GitHub CI.
- No production DB, VPS, external endpoint, or production credential was accessed.

### Earlier suite and browser evidence

- The prior full local unit run on the previous tree reported 4,113 passed, 37 skipped, 17 timeouts, and 6 Vitest worker RPC errors. A serial rerun of the three slow release-harness files passed 59 tests with 2 skipped, which supports runner contention for those files; the full-suite run did not produce a clean pass, and its per-test timeout/RPC log was not preserved in the handoff, so the cause of all 17 timeouts is not proven. The current follow-up does not change unit tests or runner timeout/suppression settings. No timeout increase, skip, or suppression was added.
- Earlier local Playwright QA verified `/register`, `/login`, and `/forgot-password` render and a mocked registration OTP UI transition. It did not prove real email delivery or browser-issued production sessions. Computer Use had been blocked by policy and was not retried. Browser QA was not repeated in this final follow-up.

## Security, schema, and workflow boundaries

- The committed Auth implementation has an independent PASS on its exact main tree. Review this follow-up diff separately for tenant writes, fixtures, migrations and CI behavior.
- Three Auth migrations are additive; do not run or modify production migrations. CI rehearsal must use only ephemeral PostgreSQL services.
- OTP/session/profile ownership, Profile 1 preservation, composite tenant FKs, and HealthSyncAudit retention semantics are unchanged by this follow-up.
- Before push, confirm workflow triggers: `.github/workflows/ci.yml` and `.github/workflows/production-migration-safety-ci.yml` run on `main` pushes and use isolated CI resources. Production deploy, migration, and recovery workflows are explicit `workflow_dispatch`; push must not run them.
- No force push, required-check bypass, or simulated CI result. Use the configured real Git author identity.

## Current status and remaining steps

- Targeted local checks: passed as listed above.
- New exact-SHA GitHub CI: not run yet; previous `e9e205d` runs are red and do not validate this diff.
- Independent audit: the final task report is the source of truth for exact-tree identity and verdict; an older baseline audit does not cover this follow-up.
- Exact-SHA CI: require BodyCast CI/CD and Production migration safety CI to succeed on the commit containing this tree; the red runs on `e9e205d` do not validate this follow-up.
- Push: perform only as a normal fast-forward after exact-tree audit PASS and a fresh unchanged-base check. The final task report records whether it completed.
- Production: **NOT DEPLOYED / NOT TOUCHED**.

For any continuation, fetch `origin/main` again, confirm workflow triggers remain non-production, then commit and direct fast-forward push only after independent PASS on the exact tree. Require both CI workflows to pass on that exact SHA. For any red result, root-cause, fix narrowly, rerun affected checks, and re-audit before another push. Never deploy.
