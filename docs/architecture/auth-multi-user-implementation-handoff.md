# BodyCast Auth / Multi-User Implementation Handoff

Updated: 2026-10-28

## Status and scope

**Pending independent audit of the exact final tree.** After audit PASS, the authorized path is a normal commit and fast-forward push to `origin/main`, followed by successful exact-SHA CI. There is no PR in this task.

**Production is explicitly out of scope and must remain unchanged.** Do not deploy, run production Prisma migrations/DDL/backfill/restore, bootstrap User 1/Profile 1, activate public registration, alter production workers, touch Caddy/VPS, or operate production credentials. Production deployment remains `workflow_dispatch` only and requires separate authorization.

Architecture and product contract: [`auth-multi-user-plan.md`](auth-multi-user-plan.md). This handoff records observed repository and test state, not a substitute for auditing it.

## Git state and preservation

- Repository: `krustallik/body-model`.
- Current worktree: `C:\Users\wowan\.codex\worktrees\auth-multi-user-implementation\physiology-active-energy-integration` (detached HEAD; keep this checkout and its changes intact).
- `HEAD` and freshly fetched `origin/main`: `dc772ef29b4900a70c0a8fc07e3c35d868ec298a` (`Implement multi-user authentication and profile isolation`).
- Baseline: `0f93f37dd6a4208cfc74331a0fb4c063c542c6bd`; it is an ancestor of HEAD. The local `main` branch is checked out in a different worktree at this baseline; do not switch, reset, or edit that worktree. The authorized push can be made from a new commit in this detached worktree with a normal fast-forward refspec.
- The base-to-HEAD implementation commit changes 260 files (+8,591/-2,108), including the architecture plan and three additive migration files. Current schema contains 77 migration directories.
- This worktree additionally has 41 tracked modified implementation/test-support files, this handoff document, and one new helper, `tests/helpers/mock-verified-profile-auth.ts`. The extra code fix is limited to registration response normalization; other changes update CI/test preparation and auth-aware test fixtures.
- The previous handoff recorded 214 tracked and 35 untracked files, but not the names of those untracked files or an immutable tree ID. Current HEAD contains the auth implementation and a broader 260-file base-to-HEAD diff, so the previous uncommitted feature work appears integrated. Exact file-for-file reconciliation of the old 35 untracked paths cannot be proven from that handoff; do not claim it.
- All other worktrees are occupied. Do not modify them. In particular, `D:\body-model\.worktrees\bodycast-imported-vps-release` owns local `main` at the baseline.

### Extra worktree diff

The 41 tracked implementation/test-support changes, excluding this handoff document, are:

```text
.github/workflows/ci.yml
.github/workflows/production-migration-safety-ci.yml
Dockerfile
scripts/ci/production-v4-fence-evidence-postgres-smoke.mjs
scripts/production-db-preflight.sql
scripts/production-empty-install-ledger.mjs
scripts/unified-v4-traffic-check.ts
src/app/api/registration/resend/route.ts
src/app/api/registration/start/route.ts
tests/dashboard-route.test.ts
tests/days-route.test.ts
tests/deploy-script-ordering.test.ts
tests/forecast-action-route.test.ts
tests/health-sync-authoritative-muscle-once.test.ts
tests/health-sync-refresh-worker.test.ts
tests/integration/auth-multiuser.integration.test.ts
tests/model-episode-repository.test.ts
tests/model-episode-routes.test.ts
tests/model-forecast-routes.test.ts
tests/model-recovery-routes.test.ts
tests/production-empty-install-ledger.test.mjs
tests/production-migration-v5.test.mjs
tests/production-v4-derived-recovery.test.mjs
tests/sleep-repository.test.ts
tests/sleep-route.test.ts
tests/stepper-create-operation-route.test.ts
tests/stepper-diagnostic-route.test.ts
tests/stepper-reconciliation-routes.test.ts
tests/stepper-workout-diagnostic-route.test.ts
tests/stepper-workout-routes.test.ts
tests/training-accounting-routes.test.ts
tests/training-day-fact-currentness.test.ts
tests/training-exercises-routes.test.ts
tests/training-match-routes.test.ts
tests/training-program-routes.test.ts
tests/training-retrospective-routes.test.ts
tests/training-retrospective.test.ts
tests/unified-experimental-physiology-source-loader.test.ts
tests/work-activity-route.test.ts
tests/work-interval-repository.test.ts
tests/work-interval-route.test.ts
```

The additional untracked file is `tests/helpers/mock-verified-profile-auth.ts`.

## CI failure evidence and local corrections

At `dc772ef`, both main-push workflows were actually red:

- BodyCast CI/CD run `40705109743` failed. The production image build imported auth configuration during Next route collection but Dockerfile provided only `DATABASE_URL`; required `IOS_SHORTCUT_API_KEY` (and the auth build configuration) was absent. The run also showed auth-aware route tests still using pre-tenant mocks, and PostgreSQL jobs attempted the current 77-migration tree on an empty database even though the transition migration requires existing Profile 1.
- Production migration safety CI run `40705109523` failed. Its Auth rehearsal reached migration `20261027120000_auth_multiuser` on an empty database and PostgreSQL raised `auth multi-user transition requires existing Profile 1`. The recovery rehearsal hit the same transition precondition.
- In that same safety run, the 65-migration historical V4 smoke generated a Prisma client from the newer schema and attempted a `HealthSyncAudit.profileId` query against the old schema, where that column does not exist (`P2022`). The CI-only fixture was changed to insert/delete its synthetic retention row with SQL, while retaining fingerprint assertions.

The current extra diff addresses those concrete failures:

1. Docker image build gets synthetic build-only auth env values; these are not deployment secrets and are used only to allow Next build-time route collection.
2. CI PostgreSQL test/rehearsal databases apply the exact pinned 74-migration baseline, insert one synthetic Profile 1, then apply the 3 additive transition migrations. Raw-source tables remain empty and are verified. The production empty-install/schema verifier only permits Profile 1 in `--test` mode and still requires a loopback `*_test` DB; production modes still require zero profiles for empty install or exact migration ledger for schema postflight.
3. Unit mocks now supply a verified Profile 1 principal to routes and services that correctly require authenticated tenant context. No production auth check is relaxed.
4. The unified traffic CLI consistently threads its already-validated `profileId`; the owner-authorized migration-free path remains restricted to Profile 1 and keeps identity/fingerprint/currentness checks.
5. SQL identifier quoting in DB preflight is corrected for PostgreSQL's case-sensitive JSON record fields. The CI-only HealthSyncAudit fixture uses direct SQL because this smoke validates legacy DB evidence without relying on the newer Prisma model; it deletes only its isolated fixture row.
6. The first independent review of tree `f646239fbbca3f757a785cc8d58c34cc6d620317` found one P2: `/registration/start` and `/registration/resend` returned different status codes for the configured owner email while signup/bootstrap were disabled. Both routes now gate bootstrap mode before the public-signup-disabled response: all addresses receive the same generic response per mode, while only the exact owner address can enter the separately enabled bootstrap flow. An isolated PostgreSQL integration regression covers both endpoints for disabled and bootstrap-on cases and confirms an unrelated address does not create a User.

The P2 correction is implementation-complete and its isolated regression passes. The corrected tree still requires a fresh independent audit and has not been validated by GitHub exact-SHA CI. The prior red runs are not evidence that this worktree is green.

## QA evidence

### Unit and integration

- All 31 changed unit-test files passed when run one file per Vitest process with `--maxWorkers=1`: **423 passed, 1 skipped**.
- Separately targeted route/release regressions previously passed: 63/63.
- Full Health Sync isolated PostgreSQL integration previously passed: 32/32 on `bodycast_training_postcommit_fresh_test`.
- Auth/multi-user isolated PostgreSQL integration passed after the enumeration fix: **5/5** on `bodycast_training_postcommit_test`, including the new owner/unrelated response-equivalence regression.
- Both allowlisted local test DBs reported all 77 migrations applied. `prisma validate` passed; migration diff against the current schema was empty. No production DB or external database was used.
- The full local unit run previously reported 4,113 passed, 37 skipped, 17 timeouts, and 6 Vitest worker RPC errors. The 17 timeouts were confined to three slow release-harness test files; rerunning those files serially passed 59 tests with 2 skipped. This points to worker contention, not an observed assertion regression. No timeout, skip, or suppression was added.
- After the enumeration fix, `npm run typecheck`, whole-repo ESLint (0 errors / 0 warnings), targeted lint for both registration routes and the integration file, and `npm run build` passed. Build used synthetic auth values and an unreachable loopback test DB. The Docker build fix itself still needs exact-SHA CI.

### Browser QA alternative

Computer Use was not retried. The permitted local Playwright route worked by selecting an already-installed Chromium headless shell (Playwright's bundled expected binary was absent). A local Next dev server used synthetic auth values and `DATABASE_URL` at loopback port 1; no production endpoint or credential was used.

Headless browser verified `/register`, `/login`, and `/forgot-password` render. On registration, mocked local requests progressed through `/api/registration/start`, `/api/auth/email-otp/verify-email`, and `/api/registration/password-reset/request`, and the UI displayed the next OTP step. This proves the UI state flow only; OTP/email delivery and real session issuance are covered by isolated integration tests, not by this mocked browser run. The server was stopped afterward.

## Security and data boundaries for auditor

Audit the full base-to-HEAD implementation plus this worktree diff and untracked helper. Pay particular attention to the approved architecture plan and these boundaries:

- Better Auth is pinned to 1.7.14; public endpoints/wrappers, disabled HTTP paths, direct `auth.api` calls, OTP purpose/expiry/attempt/resend semantics, session revocation, and enumeration handling must match the plan.
- Unverified users must have no usable session or private access. Signup requires the two-purpose OTP sequence and a verified Profile provisioner; no OTP JIT signup.
- User 1/Profile 1 preservation and profile sequence allocation must not alter legacy payloads. New verified users receive independent empty profiles.
- All personal APIs/repositories/workers use authenticated or explicit tenant context; test nested IDs, API-key ownership and legacy key retirement, unique keys, foreign keys, caches, SSR and publication readers.
- Three migrations are additive and intended for a separate, explicitly authorized production transition. Verify no migration file changed after initial addition and no CI step targets production.
- `HealthSyncAudit` alone keeps the approved 30-day retention; primary Health/Training/Garmin/Workout/Strength inputs and provenance remain strictly protected.
- No production credentials, DB, VPS or runtime traffic have been used or changed in this task.

## Trigger and push policy evidence

Checked all workflow trigger headers in `.github/workflows`: only `ci.yml` and `production-migration-safety-ci.yml` run on push to `main`. `deploy-production.yml` and all production migration/recovery workflows are `workflow_dispatch` only; a push cannot deploy, migrate or mutate production. GitHub ruleset `BodyCast main protection` is active and forbids deletion/non-fast-forward; there are no bypass actors. The API reports no required status check rules, so do not describe checks as repository-enforced; nevertheless the task requires both exact-SHA main-push CI workflows to finish successfully before reporting completion. No force push or policy bypass is allowed.

## Remaining steps

1. Compute the exact final Git tree (including the untracked mock) using a temporary index, without changing the real index.
2. Obtain a separate independent Audit agent PASS on that immutable tree; the previous audit correctly returned FIXES REQUIRED for the P2 above and does not count as PASS. Internal review does not count. If P0/P1/P2 findings arise, fix only evidence-backed items, rerun affected tests, update this handoff and request a new audit of the new tree.
3. After PASS, fetch `origin/main` again and confirm it is still `dc772ef...` or a safe ancestor. Do not alter the other worktree's `main`. Commit the audited tree neutrally with real configured Git identity and normal fast-forward push `HEAD:refs/heads/main`; stop on rejection.
4. Follow the two actual main-push workflow runs for that exact pushed SHA until complete. Require success from BodyCast CI/CD and Production migration safety tooling CI. For red results, diagnose and correct; re-audit any changed tree before another push.
5. Do not dispatch deployment or make any other production change, even after CI success.

## Acceptance status

- Independent audit: **not yet performed on current tree**.
- Final exact-SHA CI: **pending**; current `dc772ef` runs are red as described above.
- Push of current fixes: **not yet performed**.
- Production: **NOT DEPLOYED / NOT TOUCHED**.
