# BodyCast Auth / Multi-User — Implementation Handoff

Updated: 2026-10-28 (Europe/Bratislava)

## Current status

**READY FOR INDEPENDENT RE-AUDIT** after two evidence-backed P2 fixes. The local implementation remains uncommitted; this task explicitly authorizes independent audit, followed by direct fast-forward push to `main` and exact-SHA CI only after audit PASS. Production deployment and all production changes remain forbidden.

The governing request is `C:\Users\wowan\.codex\attachments\48c5dcf5-0f52-48eb-9702-faaea334075a\Вставлений текст.txt`. The architecture decisions and acceptance criteria are in `docs/architecture/auth-multi-user-plan.md`.

Do not bootstrap a production user, enable public signup in production, run production DDL/backfill/restore, or deploy. Do not open a PR. Internal reviewers are not independent audit. The owner explicitly authorizes only the post-audit direct main push and exact-SHA required CI; verify workflows cannot trigger production deployment before pushing.

## Workspace and exact snapshot

- Worktree: `C:\Users\wowan\.codex\worktrees\auth-multi-user-implementation\physiology-active-energy-integration`
- Base `HEAD`: `0f93f37dd6a4208cfc74331a0fb4c063c542c6bd` (detached; unchanged).
- Local diff at this handoff snapshot: **214 tracked files changed, 35 untracked files; tracked diff +3,604 / -2,028 lines**. Untracked lines are excluded. The independent audit prompt also receives the immutable tree ID.
- All implementation work remains uncommitted in this worktree. Preserve it; do not reset, switch branches, rewrite history, or remove files.
- `git -c core.whitespace=cr-at-eol diff --check` passes. Git prints only the existing LF-to-CRLF advisory for `prisma/schema.prisma`.

## Implemented scope

The diff includes Better Auth 1.7.14 integration; open registration using the approved two-OTP sequence; verified login/session and password lifecycle; Brevo transactional email; Profile provisioning and the gated Profile 1 bootstrap rehearsal; per-Profile API keys; server-derived tenant identity; profile scoping across Health, Workout, Strength, Stepper, model/energy, Forecast/Goal, repositories, routes and workers; ownership constraints/composite relations; additive Prisma migrations; auth UI and focused unit/integration coverage.

One final copy correction was made in `src/app/auth-flow.tsx`: generic enumeration-safe responses now say BodyCast will *try* to send a code, rather than promise delivery. The post-verification password step tells the user to enter the second code when it arrives and request another if it does not.

## Internal review evidence

- Auth reviewer rechecked the prior `/0` trusted-proxy finding: `src/lib/env.ts` rejects zero-length IPv4/IPv6 CIDRs, and `tests/env.test.ts` covers `0.0.0.0/0` and `::/0`. Reviewer found no related blocker.
- Tenant-isolation reviewer rechecked the prior application-reader coverage finding: the two-profile integration uses V7 `readDay()` and the Unified source loader, with profile-specific outputs. Reviewer found no related blocker.
- Those are critical **internal** reviews only. No independent audit PASS is claimed.
- The first independent audit returned **FIXES REQUIRED** with two P2 findings: History day deletion left Health sample rows attached to a `RESTRICT` composite FK, and password-login throttling used a global email bucket that allowed cross-IP lockout. Fixes now detach only optional Health sample pointers inside the existing day-delete transaction and scope the login email bucket by client IP. Targeted DB regressions cover surviving source observations and successful login from another IP after attacker attempts. This corrected tree requires a fresh independent audit.

## Validation completed

### Isolated PostgreSQL only

- Cluster: localhost `127.0.0.1:55435`, role `bodycast_test_runner`; allowlisted DBs: `bodycast_training_postcommit_test` and `bodycast_training_postcommit_fresh_test`.
- No production database, VPS, Docker, Caddy, release workflow, or production secret was used.
- Auth schema migration: `prisma/migrations/20261027120000_auth_multiuser/migration.sql`; tenant constraint migration: `prisma/migrations/20261028120000_scope_profile_constraints/migration.sql`.
- Both isolated databases were migrated locally through the current 77 migrations; `prisma validate` and schema diff passed. The auth/multi-user migration and Profile 1 binding were rehearsed only on isolated DBs.
- A custom-format test DB dump was restored into the allowlisted fresh DB. Dump SHA-256: `63634901A02C779768F9B7C72DD68684B02B68B3236CC4F15EFC0C1A62F391A9`. The rehearsal included one rolled-back failed migration attempt in the restored ledger; do not describe it as exactly 76 ledger rows.
- The former schema-to-database mismatch on the composite `HealthSyncSnapshot` FK is resolved. The FK now matches Prisma's `ON DELETE RESTRICT`; the application day-delete transaction detaches only the optional `dailyHealthDataId` pointer before deleting the daily projection, preserving immutable snapshot payload and provenance. A targeted PostgreSQL integration verifies this contract and cross-profile FK rejection.

### Tests and build

- Focused unit command covering auth, env, profile ownership, Health sync, model recovery/diagnostics and Training routes: **13 files, 205 tests passed** (latest recorded selection; supersedes a stale 209 count elsewhere in the earlier handoff).
- Isolated auth/multi-user PostgreSQL integration: **5/5 passed**. Includes registration/OTP, tenant isolation through Health/Workout/Strength/Stepper/V7/Unified, IDOR/composite-FK checks, API-key ownership, password/session revocation, concurrent Training generations, Profile 1 bootstrap rehearsal and HealthSyncAudit size bound.
- Health sync integration: one full run had 30 passed and 2 test-fixture expectation failures; both of those exact tests later passed in a targeted rerun (2/2). The entire file was not rerun after the final fixture changes.
- Full Health sync PostgreSQL integration after the delete-path fix: **32/32 passed** against the allowlisted local `bodycast_training_postcommit_fresh_test` database. The snapshot-retention case was rerun with the final immutable-payload assertion: **1/1 passed**.
- Auth/multi-user PostgreSQL integration after the HealthSyncSnapshot cross-profile FK assertion: **5/5 passed** against the allowlisted local `bodycast_training_postcommit_test` database. A synthetic local-only password string was supplied solely to satisfy the test guard; local PostgreSQL accepts the test role and no production credential was used.
- Daily repository unit regression after the audit fix: **25/25 passed**.
- Isolated PostgreSQL durable-source-retention Test D after the audit fix: **1/1 passed**. It exercised `DailyMetricRepository.delete()` with linked Health metric, heart-rate, and resting-heart-rate samples; each source row, acquisition timestamp and provenance remained while only its optional daily-row pointer was detached.
- Isolated PostgreSQL auth/multi-user regression after the audit fix: **1/1 passed**. Eleven wrong-password attempts from one client IP did not block valid login from a second IP.
- Both allowlisted local PostgreSQL databases report **77 migrations up to date**. `prisma validate` passed and `migrate diff` reported no schema difference for both databases. The new HealthSyncSnapshot FK migration checksum matches the already rehearsed local migration ledger; existing migration files were left unchanged.
- `npm run typecheck`: passed after the audit fixes.
- ESLint on all changed implementation and targeted test files: passed with no warnings after the audit fixes.
- `npx eslint . --format json`: **0 errors, 0 warnings**; the prior 28 warnings were inspected and cleared without global suppression.
- `npm run build`: passed using synthetic local-only environment values and a `DATABASE_URL` at `127.0.0.1:1`; it could not reach production or either isolated test DB.
- Workflow trigger audit: pushes to `main` run CI and migration-safety CI. `.github/workflows/deploy-production.yml` is triggered only by `workflow_dispatch`; no workflow in this repository dispatches production deployment on a main push. The stale CI header comment implying automatic deployment was corrected.
- Full unit suite was not run; earlier broad run was stopped because it includes slow fake deployment-script cases.

### Browser QA limitation

Real-browser visual/interaction QA was not completed. Prior local Next server starts through `exec_command` were rejected by execution policy (`CreateProcess: Rejected ... blocked by policy`); no policy bypass was attempted. A current loopback check found ports 3000, 3001, and 3005 closed. The available Chrome window was unrelated YouTube; the in-app production BodyCast URL was not opened. Route-handler/component tests and production build passed, but they are not a substitute for browser QA. Report this precise limitation; do not claim browser PASS.

## Continue from here

1. Keep this exact worktree/diff intact; compute and report an immutable Git tree ID using a temporary index without changing the real index.
2. A separate independent Audit agent reviews the complete final tree, auth/tenant/security boundaries, migrations, and evidence. Require its own PASS; no internal review counts as independent.
3. Resolve evidence-based P0/P1/P2 findings, rerun affected checks, and repeat audit for any changed tree.
4. After PASS, refetch `origin/main`, ensure it is still the same base and a fast-forward is possible, commit neutrally, and push directly to `main`. Verify the exact pushed-SHA CI and migration-safety CI conclusions. Never deploy or trigger production workflows.

## Production requirements still outside this task

Production signup remains disabled until configuration and controlled activation are separately authorized. Required production configuration includes a strong `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, explicit trusted proxy CIDRs, the chosen legacy Shortcut transition state, and Brevo API/sender configuration for public signup. Production schema changes/backfill and User 1 owner-email binding each require separate exact-binding owner authorization; production deployment requires its own authorization. No production credentials or owner email are stored in this handoff.
