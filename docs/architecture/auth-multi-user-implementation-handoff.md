# BodyCast Auth / Multi-User Finalization Handoff

Updated: 2026-10-28

## Goal and hard boundaries

Complete final auth/multi-user QA, obtain independent audit PASS on the exact final tree, push directly to `origin/main` by fast-forward, and verify exact-SHA CI. The task is **not** a new implementation from scratch. Architecture and product decisions are in [`auth-multi-user-plan.md`](auth-multi-user-plan.md).

**Production must remain untouched.** Do not deploy, access production credentials or DB, run production DDL/migrations/backfills/restores, bootstrap User 1/Profile 1, enable public signup, change VPS/Caddy/workers, or dispatch a production workflow. Do not use real Brevo credentials for OTP tests. No force push, CI bypass, author spoofing, or AI attribution.

## Git / worktree state

- Repository: `krustallik/body-model`; `origin` is `https://github.com/krustallik/body-model.git`.
- Active checkout: `C:\Users\wowan\.codex\worktrees\auth-multi-user-implementation\physiology-active-energy-integration`.
- The last audited-and-pushed commit is `e6b2adee6c9070df6892221ce8f44145c788e176`, tree `073a19b7b256a8246812c0672f314481237b10e2`, parent `9e809126271a1cae7b0d9c70e071f109efda6dbb`. `origin/main` was verified at this commit after push.
- That exact tree received independent Audit **PASS** from `/root/independent_auth_final_audit`; audit artifact SHA-256 `1f4430cfac529235c6acea2ce3a6e0b1b4b03cfb4dc7e6bef5b5dd5e087e579b` (39,783 bytes). This PASS does not cover the current uncommitted patch below.
- The checkout is detached. Local branch `main` is checked out in `D:\body-model\.worktrees\bodycast-imported-vps-release` at older `0f93f37`; do not modify that or any other occupied worktree. Push from this detached checkout only after a fresh fetch and exact-tree audit.
- Current pending changes since `e6b2ade`: `.github/workflows/production-migration-safety-ci.yml`, a new `tests/auth-routes.test.ts`, and this handoff. The implementation/test workflow changes are one narrow correction cycle; no production state was accessed.
- An old task attachment reported 212 tracked plus 34 untracked files without an immutable path manifest. That historical snapshot cannot be reconciled path-by-path to the current checkout. No files were deleted to reconcile the count.

## Pending patch and evidence

### Migration rehearsal fix

Exact-SHA safety run `40738814214` failed in “Rehearse the exact Auth manifest from the pinned 74-migration baseline.” The DB identity preflight correctly requires database name `bodycast`; the fingerprint helper correctly refuses that name and only permits isolated loopback `*_test` / `bodycast_restore` databases. The error was:

```text
Data fingerprint accepts only an isolated loopback *_test/bodycast_restore database.
```

The pending workflow patch keeps the identity gate on the ephemeral CI database named `bodycast`, creates `bodycast_restore` as its disposable PostgreSQL template clone, and fingerprints that clone. It does not change the helper allowlist, DB identity assertion, or production code. Validate this on the next safety workflow run before accepting the fix.

### Auth route regressions

Exact-SHA BodyCast CI run `40738814458` failed the combined unit-coverage merge at **84.75% lines/statements vs 85%**. The same 84.75% failure occurred on base `9e80912` in run `40726534812`, so it predates the pending patch. Downloaded shard reports confirmed that new auth endpoints were unexecuted in the unit coverage suite: registration start/resend, login, password reset, password change, and Better Auth catch-all were at zero unit coverage.

The pending `tests/auth-routes.test.ts` uses the existing Vitest setup and mocks only external auth/database/email boundaries. Its six tests cover:

- rejecting login before email verification and normalizing a verified login;
- server-generated signup password and renewed mailbox proof for a pending account;
- identical public password-reset responses for unknown and registered email;
- authenticated/profile-provisioned password-change OTP;
- body-size bounds on direct Better Auth forwarding;
- deriving API-key ownership from the session and rejecting caller-supplied profile scope.

Targeted result: **6/6 passed**. Focused V8 coverage now executes 192 auth/API-key route statements that were previously at zero in unit coverage: login 47/58, password-change request 22/24, Better Auth catch-all 16/16, reset request 30/30, registration start 54/60, and API keys 23/43. Local `npm run typecheck` and full `npm run lint` passed after adding the tests. This should lift the combined unit coverage above the existing 85% threshold; the exact CI run must confirm it. Do not lower the threshold or remove auth routes from coverage.

## Completed QA on isolated resources

All database tests used local isolated `*_test` PostgreSQL databases; no production database was used.

- HealthSync integration: **32/32 passed** on `bodycast_healthsync_20261028_test` (77 migrations).
- V7 persistence: **9/9 passed**.
- V7 runtime, resistance training, Training HTTP 400, five-exercise create and Stepper integration: **5 files / 9 tests passed**.
- Stepper idempotency: **2/2 passed**.
- Auth/multi-user integration: **5/5 passed**.
- Auth HTTP, Health auth and profile-client ownership: **10/10 passed**.
- Training program route tests: **14/14 passed**.
- `npm run typecheck`: passed. Full `npm run lint` (`eslint .`): passed with no warnings or errors.
- `npx prisma validate`: passed. Isolated migration status: 77 migrations, none pending. Database-to-`prisma/schema.prisma` diff was empty; repeated Prisma generation was deterministic and tracked schema/migrations remained unchanged.
- `npm run build` with synthetic auth values and loopback test DB: passed. Static SSR output included `/register`, `/login`, and `/forgot-password`.
- The composite HealthSyncSnapshot FK is represented in Prisma and the reviewed migration as `(profileId, dailyHealthDataId) -> DailyHealthData(profileId,id)`, `ON DELETE RESTRICT`; the isolated schema diff was empty.

### Known local limitations

- A combined 7-file ModelEpisode run on a reused test database passed 69/79; 10 failures saw a pre-existing currentness prerequisite because the DB already contained unrelated Profile/ModelEpisode/lifecycle/job/Unified rows. It was not a clean ModelEpisode suite pass. The fresh-database exact CI result is authoritative.
- Interactive browser QA was not passed: local preview process startup was denied by execution policy. SSR output and route tests are not a browser substitute. Do not route around that policy; if a permitted local preview becomes available, exercise registration/login/OTP/reset/change/profile/API-key flows. Otherwise report the limitation.

## Exact-SHA CI history / residual workflow failure

- BodyCast CI/CD `40738814458` on `e6b2ade` had quality, unit shards, PostgreSQL integration, auth PostgreSQL integration, build and container jobs pass; only `Unit coverage merge` failed at 84.75%, which made the final “Test and build” aggregate fail. The route test correction is intended to cover the uncovered new auth handlers and clear that gate.
- Production migration safety `40738814214` on `e6b2ade` failed the Auth rehearsal due to the DB-name mismatch described above. The pending patch addresses it.
- That same safety run failed “Exact legacy 65-schema V4 recovery tool image” with the existing generic fail-closed error: `Persisted source, audit preservation, publication fence, or lifecycle binding changed after exact-image rehearsal; recovery stopped before derived writes`. The identical failure existed on base run `40726534567` and older main runs. It is not caused by the auth patch and is not yet reproduced locally because Docker is unavailable on this host. Do not claim the safety workflow fully green unless the next exact-SHA run proves it. This is a known non-auth safety-CI residual, not permission to bypass the job.
- Only `.github/workflows/ci.yml` and `.github/workflows/production-migration-safety-ci.yml` trigger on main push. Production deploy, migration and recovery workflows are `workflow_dispatch` only. Push must not start production operations.
- GitHub branch-protection required-status API returned 404; no formal required contexts were exposed. Still require actual successful exact-SHA BodyCast CI/CD and report the safety workflow and every failed job honestly.

## Remaining sequence

1. Review current staged patch, run targeted auth route regression, full lint/typecheck, and confirm `git diff --check` with CRLF-aware Git config.
2. Update this handoff with the exact pending tree, then stage all intended files and record `git write-tree`.
3. Request an independent Audit agent PASS for that exact tree, including the prior auth implementation, architecture plan, changed auth rehearsal and new route tests. The old PASS above is not transferable. On findings, fix only evidence-backed issues, rerun affected checks, and re-audit the new tree.
4. After PASS, fetch `origin/main`; require it to remain at `e6b2ade`. Make a neutral technical commit and normal fast-forward push. No PR or branch is intended.
5. Wait for exact-commit `BodyCast CI/CD` and `Production migration safety tooling CI`. If a job fails, inspect exact logs, identify root cause and fix narrowly; never blind-retry or bypass a gate. Re-audit any changed tree before another push.
6. Final report must state exact audit, commit/tree, run IDs/results, tests/browser limits, residual V4 safety-job outcome, and **Production: NOT DEPLOYED / NOT TOUCHED**.
