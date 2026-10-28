# BodyCast Auth / Multi-User Finalization Handoff

Updated: 2026-10-28

## Final status

- The Auth/multi-user implementation and release-tooling source revision audited is `e5769a1334edac8eb1dfb2e418bd86d7eeaee27a`, tree `8a1a15dc783fbb8c34029a3a64401d2d5cc05fe8`. At that source audit, detached `HEAD` and fetched `origin/main` matched. The handoff was refreshed in a separate documentation-only commit and pushed; no source, schema, migration, or test files changed in that refresh.
- Independent audit: **PASS** on source tree `8a1a15dc783fbb8c34029a3a64401d2d5cc05fe8` from `/root/independent_auth_final_audit`; patch SHA-256 `588ee7d9cb583e8cccff2d0f4390d47628b8bb25fdc23f854cfbabed65970c75`. The auditor verified the tree with staged `git write-tree`; no temporary Git index was used. No P0/P1/P2 findings on that source tree. The audit did not run tests or production operations.
- BodyCast CI/CD run [40744790083](https://github.com/krustallik/body-model/actions/runs/40744790083): **success** on exact SHA `e5769a1`; unit shards/coverage, quality, Auth PostgreSQL integration, PostgreSQL shards, build, and container checks passed.
- Production migration safety workflow [40744789978](https://github.com/krustallik/body-model/actions/runs/40744789978): **failure overall**. The Auth manifest rehearsal passed. The separate legacy V4 recovery image rehearsal failed with `Persisted source, audit preservation, publication fence, or lifecycle binding changed after exact-image rehearsal; recovery stopped before derived writes`; the aggregate backup/restore smoke consequently failed. The same V4 fixture failure is present on prior base runs `40726534567`, `40738814214`, and `40743322274`. No gate was disabled.
- A subsequent documentation-only main commit `4b943f75d7acf556af7d31f45acf1ddf3d5c9032` also received successful exact-SHA BodyCast CI run [40746696826](https://github.com/krustallik/body-model/actions/runs/40746696826). Its safety run [40746696955](https://github.com/krustallik/body-model/actions/runs/40746696955) reproduced the same isolated legacy V4 fixture failure; the Auth migration-tooling job passed again.
- GitHub main protection reports **no required status checks enabled** (the endpoint returns 404). The successful BodyCast CI run is the green exact-SHA application CI; the safety workflow failure remains a disclosed residual, not a required status context.
- Production status: **NOT DEPLOYED / NOT CHANGED**. This auth/multi-user finalization performed no production write, migration, DDL, data operation, credential operation, workflow dispatch, or deploy. The push-triggered workflows are isolated CI; deploy/migration/recovery workflows are manual-dispatch.

## Scope and final source delta

The product work is the public-registration, email OTP, session/password lifecycle, Profile 1 preservation, and tenant-isolation implementation documented in [`auth-multi-user-plan.md`](auth-multi-user-plan.md), plus its tests and migration safeguards. This handoff records final QA; it does not authorize activation or production migration.

Since the prior audited baseline `e6b2adee6c9070df6892221ce8f44145c788e176`, Git reports six changed paths (five modified, one added):

- `.github/workflows/production-migration-safety-ci.yml`
- `docs/architecture/auth-multi-user-implementation-handoff.md`
- `scripts/production-migration-manifests.mjs`
- `scripts/production-migration-preflight.mjs`
- `tests/auth-routes.test.ts` (new)
- `tests/production-migration-v5.test.mjs`

The delta is 378 insertions and 60 deletions. The latest commit itself changes three paths: the handoff, migration manifest, and focused migration test (32 insertions, 11 deletions). No unrelated files were edited in the finalization checkout.

The earlier pasted status of “38 modified files + 1 untracked helper” and a still older “212 tracked + 34 untracked” did not include immutable path manifests. They cannot be reconciled path-by-path to the current tree. Current evidence shows the auth implementation and migration work are tracked on `origin/main`; there is no untracked file or missing local delta in this checkout. No files were deleted to reconcile historical counts. A local `main` branch exists in another worktree (`D:\body-model\.worktrees\bodycast-imported-vps-release`, at `0f93f37` when inspected); this task used the detached auth checkout and did not modify that worktree or the other enumerated worktrees.

The last postflight fix records the seven exact objects renamed by migration `20261027120000_auth_multiuser` as absent after migration: two FK names and five PostgreSQL-truncated Unified V2 index names. It also keeps postflight signature checks fail-closed and maps the renamed Auth target signatures. Regression coverage asserts those precise expected absences; it does not relax unrelated object or schema checks.

## Independent audit

The auditor verified the exact source tree `8a1a15dc783fbb8c34029a3a64401d2d5cc05fe8` with staged `git write-tree`; no temporary Git index was used. It found no P0/P1/P2 source findings. Tests and browser QA were not independently rerun by the auditor. A later doc-only review found P2 inaccuracies in the handoff’s index/hash provenance; those were corrected and the corrected handoff was independently confirmed on exact tree `0e27a290f6bc3b7c28d4d82b91cdb640480a70e1` before the documentation-only push.

## Verification evidence

All database integration and rehearsal tests used isolated local/CI PostgreSQL databases. No test targeted production PostgreSQL.

- Latest targeted migration regression: `npx vitest run tests/production-migration-v5.test.mjs` — **91 passed, 1 skipped**.
- Auth/API route regression: **6/6 passed**; earlier focused auth-route coverage exercised registration start/resend, login, password reset/change, Better Auth forwarding, and API-key profile scoping.
- `npm run lint`: passed with no warnings/errors. `git diff --check` on the refreshed handoff reports no whitespace errors; Git notes only that LF will normalize to CRLF on a future checkout.
- Earlier isolated evidence recorded in this thread: Auth/multi-user PostgreSQL integration **5/5**, HealthSync integration **32/32**, Auth HTTP/Health auth/profile-client ownership **10/10**, V7 persistence **9/9**, Stepper idempotency **2/2**, and Training route tests **14/14**. Prisma validation, typecheck, isolated migration status, schema diff, and production build passed on the implementation baseline. Latest exact-SHA CI re-ran the build, unit shards, Auth PostgreSQL integration, and broader PostgreSQL jobs successfully.
- The initial local full-unit report had 17 timeouts and 6 worker RPC errors. Those failures were not reproduced in the latest exact-SHA CI unit shards, which passed; a local resource-only root cause was not independently proven.
- Browser UI QA is **not passed**. Playwright 1.63 and the existing `qa:capture-fullsite-preview` script are available, but its expected app/isolated DB ports 3001/55434 (and default app port 3000) were not listening. Computer Use/local preview startup was previously blocked by execution policy; no blocked operation was repeated and no policy was bypassed. SSR/API and route tests do not count as browser verification.
- The Auth migration rehearsal uses the pinned 74-migration baseline and reaches the expected 77-migration schema; its exact job passed in safety run `40744789978`. The safety workflow’s distinct legacy 65-schema V4 failure remains open and must not be reported as a green workflow.

## Security and tenant-boundary review scope

The independent plan/code audit covered Better Auth and OTP routes, direct-route bypasses, signup/profile provisioning recovery, password reset/change and session revocation, User 1/Profile 1 preservation, profile-scoped API keys, nested IDs and ownership, Health/Workout/Strength/Stepper, V7/Unified/Energy, workers, provenance, caches/publication, migration compatibility, HealthSyncAudit retention, and raw-data integrity. Product decisions and staged rollout requirements are in `auth-multi-user-plan.md`; public signup remains unactivated in production.

## Workflow and release constraints

- `.github/workflows/ci.yml` runs on main push and pull requests; it does not deploy or hold production credentials.
- `.github/workflows/production-migration-safety-ci.yml` runs on main push and on scoped pull-request changes; all jobs use isolated CI resources.
- Production deployment, migrations, recovery, and ownership bootstrap workflows are manual-dispatch and were not dispatched.
- No branch-protection status contexts are configured. Do not reinterpret the non-required V4 fixture failure as success; disclose it. Do not bypass it if a future change makes the V4 rehearsal relevant or required.
- Any future production DDL/migration, User 1 bootstrap, public signup activation, backfill, or deployment requires separate explicit authorization and its own exact-SHA safety gates. This handoff grants none.

## Continuation

Code and the auth-specific CI gates are complete on `e5769a1334edac8eb1dfb2e418bd86d7eeaee27a`; no source changes are pending. If continuing this task, first preserve the production boundary, then decide whether the known non-Auth legacy V4 recovery fixture failure is in scope. Do not claim full safety-workflow success until that job itself passes. Browser QA remains an explicit limitation.
