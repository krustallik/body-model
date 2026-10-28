# BodyCast Auth / Multi-User Finalization Handoff

Updated: 2026-10-28

## Scope and hard boundaries

The active task is final QA, independent audit of the exact final source tree, direct fast-forward push to `origin/main`, and exact-SHA CI. **Production must remain untouched.** Do not deploy, access production credentials/data, run production DDL/migrations/backfills/restores, bootstrap User 1/Profile 1, enable public signup, or change VPS/Caddy/workers. No production workflow may be started.

Product and security contract: [`auth-multi-user-plan.md`](auth-multi-user-plan.md).

## Verified Git and worktree state

- Repository: `krustallik/body-model`, remote `origin` is `https://github.com/krustallik/body-model.git`.
- Active worktree: `C:\Users\wowan\.codex\worktrees\auth-multi-user-implementation\physiology-active-energy-integration`.
- Active checkout is detached at `9e809126271a1cae7b0d9c70e071f109efda6dbb`; fetched `origin/main` is the same commit. No local branch is checked out here.
- The local `main` branch is checked out in `D:\body-model\.worktrees\bodycast-imported-vps-release` at older commit `0f93f37dd6a4208cfc74331a0fb4c063c542c6bd`. Do not edit that or any other occupied worktree. The active detached checkout is based on current `origin/main` and is suitable for a normal fast-forward push after audit.
- Current source diff before this handoff update: 9 tracked files, 77 insertions / 38 deletions; no untracked files. The task attachment reported 212 tracked plus 34 untracked files, but supplied no immutable path manifest. Those historical counts cannot be reconciled path-by-path with the actual current tree. No current files were removed to reconcile the discrepancy.
- Auth/multi-user implementation is already committed in main history (`dc772ef` and follow-ups through `9e80912`). Existing PASS reports on earlier trees do not audit the current follow-up.

## Current follow-up diff

The 9 implementation/CI/test files against `origin/main` are:

```text
.github/workflows/production-migration-safety-ci.yml
src/modules/training/training.repository.ts
tests/integration/health-sync.integration.test.ts
tests/integration/model-episode.integration.test.ts
tests/integration/physiology-v7-persistence.integration.test.ts
tests/integration/physiology-v7-runtime.integration.test.ts
tests/integration/resistance-training-exposure-history.integration.test.ts
tests/integration/stepper-create-idempotency.integration.test.ts
tests/integration/training-http-400-reproduction.integration.test.ts
```

Changes are targeted to observed CI/integration failures:

1. The auth migration rehearsal now reuses the workflow's isolated PostgreSQL service database (`bodycast`) instead of creating a second database name that the production-identity preflight correctly rejected. The service is ephemeral to the CI job; authentication and DB-identity assertions remain enabled.
2. `TrainingRepository.createProgramWithVersion` now uses Prisma relation connects for the profile-scoped exercise catalog and profile inside a checked nested create. Composite profile ownership constraints remain in force.
3. Integration fixtures that now require verified authentication install the existing verified-profile mock.
4. Health-sync boundary-journal coverage uses an isolated synthetic Profile instead of mutating Profile 1's queues/lifecycle/publication blocks; test-owned records are cleaned up.
5. V7 persistence tests create only their synthetic fixture Profiles and remove those created by the suite. Two teardown paths clear the TrainingProgram current-version pointer before deleting referenced versions.
6. Stepper idempotency uses a synthetic Profile/date and cleans up test-owned lifecycle and DailyHealthData.

No Prisma schema or migration file is changed by this follow-up.

## Local verification evidence

All PostgreSQL runs below used local isolated `*_test` databases only; production was not accessed.

- HealthSync integration: **32/32 passed** on `bodycast_healthsync_20261028_test` (77 migrations, current schema).
- V7 persistence: **9/9 passed** on `bodycast_training_postcommit_fresh_test`.
- Stepper idempotency: **2/2 passed** after fixing the fixture date to the Prisma `YYYY-MM-DD` contract.
- Additional V7 runtime, resistance training, Training HTTP 400, five-exercise create, and Stepper integration files: **5 files / 9 tests passed** on the isolated Training test database.
- Auth/multi-user integration: **5/5 passed**.
- Auth HTTP, Health auth, and profile-client ownership tests: **10/10 passed**.
- Training program route tests: **14/14 passed**.
- `npm run typecheck`: passed.
- Full `npm run lint` (`eslint .`): passed with no warnings or errors. The changed TypeScript source/integration files were also linted separately with no output/errors.
- `npx prisma validate`: passed. `prisma migrate status` on the isolated test DB found 77 migrations and no pending migrations. `prisma migrate diff` from that database to `prisma/schema.prisma` was empty. Repeated `prisma generate` produced the same generated schema hash; tracked schema and migration files remained unchanged.
- `npm run build`: passed with synthetic, non-production environment values and a loopback test DB. Static output contained `/register`, `/login`, and `/forgot-password` pages with their expected headings.
- Workflow YAML parsing passed for the changed workflow files.

### Known local-suite limitation

A combined 7-file run on the reused `bodycast_training_postcommit_fresh_test` database passed **69/79**. The 10 failures were ModelEpisode tests reporting a pre-existing currentness prerequisite (`Unified physiology requires a current production model generation`). Before the run, read-only counts showed this supposedly fresh DB already contained 8 Profiles, a ModelEpisode, V7 lifecycle, Training job, and Unified blocks. This is fixture-database contamination evidence, not a clean green ModelEpisode-suite result. The new exact-SHA GitHub run must adjudicate on its fresh job database; if it fails there, fix the actual failure and re-audit.

Browser QA is **not passed**. Launching a local preview process was rejected by the execution policy. Do not retry via a different process-launch route to bypass that policy. SSR output was inspected instead; it does not verify interactive OTP/password/profile/API-key flows. If a permitted already-running local browser/preview becomes available, exercise those flows; otherwise retain this coverage limitation explicitly.

## CI evidence and outstanding failures

- CI run `40726534812` on base SHA `9e809126271a1cae7b0d9c70e071f109efda6dbb` failed integration fixtures subsequently addressed in the current diff. Unit shards, quality, Docker/build and Next build succeeded on that run, but it does not validate the follow-up.
- Production migration safety run `40726534567` on the same base failed Auth DB identity preflight and the legacy V4 recovery smoke. The Auth rehearsal change above targets the first failure. The V4 smoke reported that persisted source/audit/fence/lifecycle state changed after rehearsal, stopping before derived writes. A possible mismatch between the pinned legacy V4 runtime inventory and current evidence projection was found by static inspection, but the precise mismatch was not reproduced locally because Docker was unavailable. Do not call it fixed or green unless a final exact-SHA run proves it.
- A request to GitHub's branch-protection required-status endpoint returned 404; no formal required status contexts were available from that endpoint. This is not permission to skip CI. Wait for actual successful final-SHA `BodyCast CI/CD` and `Production migration safety tooling CI` runs and report each conclusion truthfully.
- `.github/workflows/ci.yml` runs on `main` push and explicitly states that it has no production secrets or deploy behavior. `.github/workflows/production-migration-safety-ci.yml` also runs on `main` push and uses ephemeral CI PostgreSQL/Docker resources. Production deploy/recovery/migration workflows are explicit `workflow_dispatch`; do not dispatch them.

## Required next steps

1. Finish the current diff review and this handoff update; verify exact file list and `git diff --check`.
2. Stage the complete final tree and record its immutable tree ID (`git write-tree`). Ask the existing independent Audit agent to audit that exact tree and the plan, migrations/FKs, tenant isolation, test evidence, browser limitation, and workflow safety. Earlier PASS reports do not cover this tree.
3. On `FIXES REQUIRED`, address only evidenced findings, rerun affected regressions, and re-audit the new exact tree. Do not claim PASS from internal review.
4. Only after exact-tree independent PASS, fetch `origin/main` and confirm it is still `9e80912`. Make a neutral technical commit with configured Git identity, then normal fast-forward push from this detached checkout. No force push, PR, CI bypass, author spoofing, or AI attribution.
5. Wait for both main-push workflows to finish on the exact pushed SHA. If either fails, root-cause and make a narrow fix, re-run affected checks, and obtain a new audit for the changed tree before another push.
6. Final status may be `CODE/CI VERIFIED — PRODUCTION NOT DEPLOYED` only after audit PASS and successful exact-SHA CI. Report any browser or legacy V4 limitations. Production remains NOT DEPLOYED / NOT TOUCHED.
