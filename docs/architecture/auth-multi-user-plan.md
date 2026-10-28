# BodyCast authentication and multi-user transition plan

**Status:** `READY FOR INDEPENDENT PLAN RE-AUDIT`  
**Scope:** Architecture plan only. No implementation, Prisma migration, production change, deploy, or Git operation is authorized by this document.  
**Repository basis:** `origin/main` `0f93f37dd6a4208cfc74331a0fb4c063c542c6bd`.  
**Auth API basis:** Better Auth `v1.7.14` source. The repository currently uses Next.js `16.3.6` and Prisma `6.19`, and does not yet depend on Better Auth.

## 1. Decisions and constraints

- Public registration is open to all users. Invite-only is out of scope.
- Email ownership must be proven with a single-use OTP before a registration is complete, a Profile is created, or any session is issued.
- An unverified account cannot access private pages, APIs, server actions, sync keys, or personal data.
- Each verified user receives a new empty Profile. Never infer that a public registrant owns Profile 1 from matching email text.
- User 1 may be linked to existing Profile 1 only by the separate owner bootstrap described below.
- Preserve existing health, training, workout, provenance, and derived-history semantics. Do not synthesize onboarding values.
- HealthSyncAudit remains a system-only technical log with its approved 30-day retention, including `rawBody`. That policy does not apply to primary Health or Training data.
- Do not enable social sign-in, account linking, or user deletion in phase 1.
- Normal application deployment never applies Prisma migrations. Production DDL and ownership backfill each require separate exact authorization.

## 2. Pinned Better Auth behavior

Before implementation, pin `better-auth` to `1.7.14` and record the exact compatible Prisma adapter version in the lockfile. Better Auth's Prisma documentation says Prisma 6 can keep its existing Prisma Client setup. Do not implement against an unpinned `latest` API.

Relevant `v1.7.14` contracts:

- `signUpEmail` requires a password, writes a credential account, and can skip auto-sign-in with `autoSignIn: false` / `requireEmailVerification: true`.
- `verifyEmailOTP` atomically consumes an OTP, marks the User verified, awaits `emailVerification.afterEmailVerification`, then creates a session only if `autoSignInAfterVerification` is enabled. The Profile hook therefore can fail closed before a session is issued.
- `verifyEmailOTP` does not remove a credential set before verification.
- `signInEmailOTP` atomically consumes a sign-in OTP. For an existing unverified User it removes pre-proof accounts and sessions, verifies the User, then creates a session. For an unknown User it creates a verified User and session unless `disableSignUp: true`.
- `setPassword` is server-only, requires a session, and is intended for Users without an existing credential account; it does not replace an existing password. The standard email OTP password-reset route updates an existing credential.
- `disabledPaths` blocks matching HTTP requests in the Better Auth router. Direct `auth.api.*` calls do not pass through that router and remain available to trusted server code. The router's `onRequestRateLimit` is also not run by direct `auth.api.*` calls.
- Email OTP defaults are not sufficient as implicit product policy: explicitly configure a five-minute expiry, three verification attempts, hashed OTP storage, rotating resend, and bounded rate limits. Preserve atomic single-use consumption.

Primary source references:

- [Better Auth v1.7.14 signup route](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.14/packages/better-auth/src/api/routes/sign-up.ts)
- [Better Auth v1.7.14 email OTP routes](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.14/packages/better-auth/src/plugins/email-otp/routes.ts)
- [Better Auth v1.7.14 unproven-account cleanup](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.14/packages/better-auth/src/db/revoke-unproven-account-access.ts)
- [Better Auth v1.7.14 HTTP router and `disabledPaths`](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.14/packages/better-auth/src/api/index.ts)
- [Better Auth v1.7.14 direct `auth.api` dispatch](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.14/packages/better-auth/src/api/to-auth-endpoints.ts)
- [Better Auth Prisma adapter compatibility](https://better-auth.com/docs/adapters/prisma)

## 3. Registration and OTP flow

### Chosen phase-1 flow: two OTPs, using Better Auth routes

This is the minimal safe stock flow for a password account. One OTP is not selected for phase 1: `signInEmailOTP` creates a session and exposes its token before application-level provisioning has completed, while `signUpEmail` necessarily creates a credential and `setPassword` cannot replace it. A one-OTP variant would need additional session interception/revocation or credential-deletion orchestration. That is more custom security logic than the second standard OTP. The owner must accept the extra OTP in the registration UX before implementation.

Pin these settings in the Better Auth configuration rather than relying on defaults:

- `emailAndPassword.enabled = true`, `requireEmailVerification = true`, `autoSignIn = false`.
- `emailVerification.sendOnSignUp = true`, `autoSignInAfterVerification = false`.
- `emailOTP({ overrideDefaultEmailVerification: true, disableSignUp: true, expiresIn: 300, allowedAttempts: 3, storeOTP: "hashed", resendStrategy: "rotate", sendVerificationOTP })`.
- Do not enable the plugin's separate `sendVerificationOnSignUp` hook when `overrideDefaultEmailVerification` is handling the signup verification message; that avoids double sends. Confirm these exact option names against the pinned `v1.7.14` package types during implementation.

**State transitions:**

1. **Registration start.** `POST /api/register/start` accepts only normalized email and allowlisted display name. It accepts no password, `userId`, `profileId`, `emailVerified`, role, or other Better Auth additional fields.
2. The server calls the pinned `auth.api.signUpEmail` with a cryptographically random, server-generated throwaway password, `requireEmailVerification: true`, and `autoSignIn: false`. Never log or return the temporary password. This credential is unknowable to the registrant until replaced after verification.
3. Better Auth's email OTP plugin sends an `email-verification` OTP on signup. Do not also send a verification link. Use identical generic responses for a new email and a duplicate email; do not disclose whether an account exists.
4. **Email proof.** The user submits the first OTP to Better Auth's standard `/email-otp/verify-email` HTTP endpoint. Set `autoSignInAfterVerification: false`. The endpoint consumes the OTP once, marks the User verified, and awaits the application `afterEmailVerification` Profile provisioner. It creates no session.
5. Only after Profile provisioning succeeds may the account proceed to password installation. The user requests a second `forget-password` OTP and submits it with their chosen password to the standard reset route. The application reset guard requires `emailVerified = true` and an existing Profile before accepting this flow. A successful reset installs the chosen credential and revokes prior sessions. The user then signs in with email and password.
6. Until step 5 completes, the only credential is the hidden random password, so it cannot be used to sign in. Email/password sign-in requires verified email. OTP sign-in is disabled for public use.

This sequence avoids an active session before Profile creation, a client-selected pre-verification password, JIT OTP signup, and custom OTP/session handling.

### Registration routes and rate limits

- Configure Better Auth `disabledPaths` for public HTTP `/sign-up/email`, `/sign-in/email-otp`, and server-only password-setting endpoints. Verify the exact normalized paths against `v1.7.14` and the deployed base path. Leave the standard email verification OTP route available because its OTP and Profile callback are the required registration transition.
- The custom registration-start route is the only caller of direct `auth.api.signUpEmail`. Since direct `auth.api` skips router `disabledPaths` and router `onRequestRateLimit`, the wrapper must apply a shared, database-backed limit keyed by both client IP and normalized email before calling it. Do not use a process-local counter. Keep the standard OTP send/verify HTTP paths on Better Auth's native endpoint rate limiter.
- Forward only the original request's necessary headers to Better Auth. Apply same-origin/CSRF checks in the application wrapper as well as Better Auth's endpoint middleware; do not assume a direct server API call ran the HTTP router's Origin or rate-limit layer.
- Configure `disableSignUp: true` for the email OTP sign-in plugin path. The path is disabled publicly and unused by registration; this prevents OTP JIT account creation if a route is accidentally re-enabled.
- Keep `/sign-in/email` enabled for verified Users. No social providers or account-linking endpoints are configured in phase 1.
- Password reset endpoints must have a server hook/guard that checks the target User is already verified and has a Profile. This is required because the v1.7.14 OTP password-reset route can mark an unverified User verified after resetting a password; it must not become an alternate registration-verification route.
- Do not rely on Next Proxy or hidden UI controls as the authorization boundary. Every page data loader, API route, server action, and DAL method must verify the server-side session and resolve its Profile.

### OTP, duplicates, and enumeration contract

- Normalize email consistently before lookup and unique enforcement.
- OTP1 purpose is `email-verification`; OTP2 purpose is `forget-password`. Codes are not interchangeable.
- Expiry: 5 minutes. Attempts: at most 3 per code. Resend rotates the code. Store a hash using Better Auth's supported hashed OTP mode. Use its atomic consume operation to make concurrent verification single-winner.
- Bound sends by IP and email; return generic success for unknown/duplicate emails. Do not log OTPs, passwords, raw request bodies, or Better Auth tokens.
- An existing unverified User resumes by requesting a fresh OTP for the same normalized email; do not create a second User. An expired OTP is simply resent. Avoid a new cleanup job or pending-registration table in phase 1.

## 4. Profile provisioning and failure recovery

### Atomic, idempotent provisioning

- `afterEmailVerification` receives the verified Better Auth User from the library. Derive ownership from that User ID; never use an email, `profileId`, or user ID supplied in the verification request to select the Profile.
- Create an empty Profile with unique `Profile.userId`. Provision with a transaction/upsert guarded by that unique constraint. Concurrent verification retries may converge on the same Profile, never create two.
- New Profile IDs come from a PostgreSQL sequence whose next value is set above `MAX(Profile.id)`. Preserve existing Profile 1 exactly. Do not leave `Profile.id @default(1)` for new rows.
- Make physiology inputs that are not yet known (sex, date of birth, height, and related onboarding values) nullable until onboarding. Never use invented defaults. Physiology-dependent calculations remain unavailable until their required inputs exist.
- A Profile insert error must propagate out of `afterEmailVerification`; with `autoSignInAfterVerification: false`, no session is issued.

### Recovery: OTP consumed, User verified, Profile missing

1. Return a generic retryable registration state, not a session or private User/Profile data.
2. The user requests a new email-verification OTP. The resend endpoint returns the same generic response whether the address exists or not.
3. A fresh valid OTP proves control of the email. The standard verification endpoint may process an already verified User and calls the idempotent `afterEmailVerification` provisioner again.
4. Provisioning resolves the User by Better Auth's verified internal User ID; the request's email is not treated as identity proof.
5. Concurrent resend/verify requests are safe through OTP atomic consumption and `Profile.userId @unique`; a unique conflict is resolved by rereading the same Profile.
6. Only after Profile provisioning and the second password OTP succeed can ordinary password sign-in issue a session.

Isolated PostgreSQL must prove that failure after OTP consumption creates no session, a new OTP resumes the same User, concurrent retries create one Profile, and no request can access personal data during the incomplete state.

## 5. Password lifecycle

### Forgot password

- Use Better Auth email OTP reset with a generic response for unknown email.
- A guard rejects reset for unverified Users or Users without a completed Profile; responses remain non-enumerating.
- OTP is one-time, expires in five minutes, permits three attempts, rotates on resend, and is rate-limited. Configure `revokeSessionsOnPasswordReset: true`.
- After reset, require a new password sign-in. Do not issue a session from the reset endpoint.

### Authenticated change password with email OTP

- Better Auth's standard `changePassword` requires the current password but does not itself require email OTP. The application change-password route therefore requires a verified session, binds the address to `session.user.email`, sends an email OTP, and accepts the new password only after that OTP is consumed.
- Never accept a target email or user ID from the request as the account selector. The wrapper binds it to the session User and Profile.
- Apply `revokeSessionsOnPasswordReset`; after success, require sign-in again. Do not permit a direct password-change route that skips OTP.

### User 1 bootstrap and mandatory password replacement

- Bootstrap User 1 only after the owner supplies the exact email and separately authorizes the bootstrap. Prove that email by OTP. In one transaction, create/link Better Auth User 1 to existing Profile 1; do not copy or rewrite historical data.
- Mark User 1 `passwordChangeRequired = true`. Do not expose a generated temporary password in logs, Git, CI, or the plan. If a temporary password is used, its delivery method must be separately approved; prefer setting the first password through verified email OTP instead.
- All private routes remain blocked while `passwordChangeRequired` is true; permit only password setup/reset and sign-out.
- A password-reset callback may fail after the OTP and password have already been consumed/updated. Keep the account restricted. A User who signs in with the newly set password receives only a restricted session and may call a recovery endpoint that verifies that password via Better Auth and clears the flag transactionally. It must never grant private access merely because the callback failed or the flag is missing.
- Do not accept client writes to `passwordChangeRequired`. Revoke all prior sessions after reset/change.

## 6. Tenant ownership and isolation contract

### Required data model changes

- Add nullable unique `Profile.userId` relation for the one-to-one owner mapping; Profile 1 remains intact until the approved User 1 bootstrap.
- Add `profileId` to every tenant-owned table that lacks direct scope. In particular audit the profile-less Health raw rows/snapshots, daily data, metric samples, activity intervals, workouts, strength/session history, reconciliation, canonical energy, and all forecast/goal/model publication state. For child rows, use an explicit ownership path to a scoped parent.
- Remove `profileId @default(1)` from **every** user-owned Prisma model. Remove `DEFAULT_TRAINING_PROFILE_ID` and equivalent runtime fallback arguments. A missing owner must fail closed.
- `profileId` comes only from a verified session, a verified per-profile sync key, or a durable job carrying a profile ID. No request body, query parameter, nested ID, or global singleton supplies it.
- Profile 1 is permitted only in clearly isolated legacy bootstrap/recovery tooling, never an ordinary runtime read/write.
- Inventory and scope every global unique key that represents user data. Examples: `DailyHealthData.date` becomes unique by `(profileId, date)`; `HealthMetricSample(metric,timestamp)` becomes unique by `(profileId, metric, timestamp)`; `HealthActivityInterval.sourceFingerprint` becomes unique by `(profileId, sourceFingerprint)`. Preserve the fingerprint payload itself; tenant scope belongs in the key/ownership contract, not a rewritten provenance value.
- Add composite ownership foreign keys for cross-profile references where practical, such as a Strength session's matched Workout and a Health snapshot's daily row. For nested writes, resolve every parent with both its ID and trusted `profileId` inside the same transaction. Keep global primary IDs, but do not treat global ID uniqueness as authorization.
- `HealthSyncSnapshot` keeps a composite `(profileId, dailyHealthDataId)` FK with `ON DELETE RESTRICT`, matching Prisma. The authorized DailyHealthData delete path transactionally nulls only that optional pointer before deleting the projection; snapshot payload, timestamps, and source evidence remain unchanged. Apply the FK contract only while old delete writers are quiesced under maintenance; do not rely on a database-only partial `SET NULL` action that Prisma cannot represent.
- Set deletion behavior to restrict for Profiles with health/training data. Disable Better Auth user deletion and do not cascade-delete primary records in phase 1.

### Scope boundaries that must be converted

- **Health:** daily data, samples, snapshots, activity intervals, sync, import keys, source reconciliation, and retention/audit paths.
- **Training:** Workout, Stepper, Strength session, exercise/set IDs, accounting snapshots/operations, program/catalog, and Garmin reconciliation.
- **Model/publication:** ModelEpisode, V7, Unified, active energy canonical events/candidates/resolutions, fingerprints, generation jobs, Forecast, and Goal.
- **API/SSR:** all API routes, server actions, route loaders, server components, mutation services, and nested-ID lookups; API keys resolve exactly one Profile.
- **Workers/jobs:** Health and Training refresh jobs, V7/Unified publishing, retries, lock keys and deduplication all carry Profile ID. A worker never calls a default Profile 1 repository method.
- **Cache/publication:** disable shared/static caching for private responses or include Profile ID in every cache key/tag. Publication fences, currentness state, generation counters, and candidate lookups are Profile-scoped.

Known Profile 1 paths in current `origin/main` that require explicit conversion include `src/modules/training/training.repository.ts` (many `DEFAULT_TRAINING_PROFILE_ID` fallbacks), `src/modules/training/exercise-mapping-snapshot.ts`, `src/modules/training/stepper-workout.repository.ts`, `src/modules/model-episodes/model-episode.service.ts`, `src/modules/activity/active-energy-materialization.ts`, and `src/app/api/forecast/action/route.ts`. This list is representative; implementation must complete the route/model/worker inventory before activation.

### HealthSyncAudit

- Treat HealthSyncAudit as a system-only log, not a tenant-readable table.
- Existing Health sync reads `rawBody` before checking the Shortcut key and records unauthorized requests. Such a row has no trusted tenant; never infer one from payload.
- For an authorized sync, associate audit scope only from the profile resolved by the verified sync key. Unauthorized rows remain system-scoped and inaccessible to users.
- Preserve approved 30-day retention including `rawBody`. No tenant endpoint may read another user's audit row; no retention exemption for HealthSyncAudit can be applied to primary raw sources.
- Keep core raw-source fingerprints strict. Audit retention evidence is separate and retention-aware; it cannot weaken Health/Training raw-data integrity checks.

## 7. Transition and production release gates

### Staged release

1. **Implementation and isolated rehearsal:** tenant-aware code, auth config, additive Prisma schema, exact SQL, ownership inventory, integration tests, and restore rehearsal are completed without touching production.
2. **Protect the currently public single-user app:** until tenant-aware code is active, put private pages and personal APIs behind maintenance/access protection. Preserve the existing Shortcut only through its current API key explicitly mapped to Profile 1. Do not open public signup during this stage.
3. **Expand schema under separate authorization:** add Better Auth tables/fields, Profile relation, nullable ownership columns, scoped constraints, and required indexes. Do not apply production Prisma migrations from an app deploy. Use a separately reviewed and owner-authorized SQL artifact.
4. **Ownership backfill under separate authorization:** map existing rows to Profile 1 only, using the pre-reviewed row inventory and a release lock. Do not change primary payload values, timestamps, provenance, or derived records. Compare pre/post strict raw projections and separately prove that only the authorized new ownership fields changed.
5. **Deploy tenant-aware code with public signup disabled:** server-side auth is required on all personal reads/writes; owner bootstrap and the existing Shortcut are the only enabled access paths. Confirm both old and candidate code behavior against the expanded schema in isolated rehearsal. No rollback may return to code that exposes unscoped user data.
6. **Bootstrap User 1:** only after separate owner email and exact bootstrap authorization. Link User 1 to existing Profile 1 atomically. Do not alter Profile 1's historical data.
7. **Activate owner auth, then public signup:** verify route isolation, sync-key scope, workers, caches, data integrity, and profile currentness before enabling public registration. Use a controlled feature/config activation; do not infer activation from successful deployment.

### Pre-DDL and release gates

Before any production DDL/backfill, require all of:

- reviewed exact migration SQL and exact application SHA;
- actual production schema/drift inventory and compatibility review;
- a verified production-compatible backup and successful isolated restore rehearsal;
- Profile 1 ownership mapping and complete FK/unique-key inventory;
- strict pre/post raw-source and provenance evidence, with the ownership-column projection explicitly accounted for;
- release lock and no competing writer/deployment;
- exact owner authorization for DDL and a separate authorization for any ownership backfill;
- candidate health/readiness, auth/API/UI acceptance, worker state, and scoped Training/Unified currentness;
- forward recovery or rollback to a tenant-safe code/schema pair. Never roll back by dropping additive schema or restoring over production data.

If any identity, backup, raw-integrity, ownership, writer, or rollback state is ambiguous, leave the app protected and stop. App deployment CI is not migration authorization.

## 8. Minimal implementation stages

1. Pin Better Auth/Prisma adapter; add auth configuration, OTP email delivery, trusted-origin/CSRF behavior, and the protected registration-start route.
2. Add Profile/User relation and onboarding-nullable physiology fields with additive-compatible schema. Keep signup disabled.
3. Convert all tenant-owned repositories, endpoints, SSR/actions, nested IDs, cache keys, publication state, unique constraints, foreign keys, jobs, and workers to required scope.
4. Add the User 1 bootstrap path, Profile provisioning/recovery, password reset/change wrappers, and restricted forced-password-change recovery.
5. Complete the targeted isolated PostgreSQL acceptance tests below. Conduct internal review, then independent plan/code audit before any implementation release gate is treated as passed.
6. Only after separate exact DDL/backfill authorization, rehearse and perform the controlled schema/data transition. Deploy tenant-aware code with signup off, verify owner/Profile 1 and legacy Shortcut, then activate public signup.

No new queue, generalized tenancy framework, custom OTP store, custom cryptographic primitive, social-auth provider, broad release runner, or duplicate test framework is planned.

## 9. Targeted acceptance tests

Run only against an isolated PostgreSQL database using the pinned dependency versions:

1. **Signup and routes:** exact Better Auth HTTP paths; raw `/sign-up/email` and `/sign-in/email-otp` are blocked; trusted server registration still works; no direct route can set `emailVerified`, create a session, or choose a persistent pre-verification password.
2. **No pre-proof access:** password login, API, SSR, server action, sync key creation, and Profile lookup all fail before OTP1; no Profile or session exists.
3. **OTP contract:** hashed storage, expiry, max attempts, resend rotation, IP/email rate limits, generic duplicate/unknown responses, atomic single-use, replay, and concurrent verification.
4. **Provisioning recovery:** consume OTP1, force Profile insert failure, prove no session/token/cookie is returned, resend and verify a fresh OTP, then prove exactly one empty Profile and no reliance on request-supplied identity.
5. **Password installation/reset:** OTP2 cannot run for unverified/no-Profile Users; it succeeds after Profile provisioning; reset revokes sessions; OTP2 cannot substitute for OTP1 or verify an email by itself.
6. **Password callback recovery:** inject failure after password update/OTP consumption; user remains data-restricted; a new OTP or restricted authenticated recovery completes safely; concurrent resets are single-winner.
7. **Tenant isolation:** missing owner, foreign Profile, cross-profile nested Workout/Strength/Stepper ID, conflicting global keys, concurrent workers for different profiles, and request-supplied owner all fail closed.
8. **Legacy preservation:** Profile 1 ID and physiology/raw/provenance payloads remain unchanged; scoped unique keys allow equivalent values in different Profiles; cascades cannot delete primary history.
9. **HealthSyncAudit:** unauthenticated row has no trusted tenant, tenant APIs cannot read audit rows, authorized key maps to exactly one Profile, and 30-day pruning affects only eligible audit rows.
10. **Workers/currentness:** Health, Training, V7, Unified, Energy, Forecast, and Goal jobs run with explicit Profile IDs; generation and publication fences remain isolated per Profile.
11. **Migration rehearsal:** restore backup to isolated PostgreSQL, apply reviewed exact SQL, backfill Profile 1 ownership, compare strict raw projections/provenance, test candidate/tenant-safe rollback compatibility, and confirm no production credentials or DB were used.

Do not expand into a broad test framework; add these to the existing targeted integration surfaces.

## 10. Owner decisions and authorization still required

Already decided: open public registration and mandatory email OTP. Invite-only is rejected. HealthSyncAudit retains its approved 30-day policy.

Before implementation/activation, owner must still decide or authorize:

1. The exact verified owner email and one-time authorization to bind User 1 to Profile 1. Do not put the email or credentials in this plan.
2. Whether the registration UX accepts the recommended two-OTP sequence. If one OTP is required, first prove the complete pinned-version flow—including no token/cookie/session exposure before Profile provisioning and safe credential installation—on isolated PostgreSQL. Do not replace the phase-1 flow with an untested custom session wrapper.
3. The approved secure delivery channel for a User 1 temporary password, or approve the simpler alternative of setting its first password through verified OTP without a temporary password.
4. User/Profile deletion and health-data retention semantics. Until explicitly decided and implemented safely, deletion remains disabled and Profile deletion is restricted.
5. Exact production DDL authorization and separate ownership-backfill authorization after the gates in section 7. This plan authorizes neither.

## 11. Audit finding disposition

| Prior finding | Required plan decision |
|---|---|
| Pre-verification password and direct route risk | Server-generated throwaway credential; exact HTTP route guard; OTP verification gate; no raw signup or OTP sign-in endpoint. |
| Profile insert failure after OTP consumption | Fresh OTP recovery; idempotent provisioning by verified Better Auth User ID; no session until Profile callback succeeds. |
| Profile 1 defaults and runtime fallbacks | Remove all user-owned `@default(1)` and `DEFAULT_*_PROFILE_ID` fallbacks; derive scope from trusted identity. |
| Production recovery/DDL gap | Exact SQL, drift check, verified backup, isolated restore, raw integrity, lock, separate owner authorizations, tenant-safe rollback. |
| HealthSyncAudit tenant ambiguity | System-only rows; only authenticated key can supply scope; preserve 30-day rawBody retention. |
| Password reset callback failure | Keep restricted state; allow idempotent retry/recovery after proving the new password; no data access while flag remains. |
| OTP/API complexity and version ambiguity | Pin Better Auth v1.7.14 and adapter; choose standard two-OTP flow unless a one-OTP isolated integration proves simpler and safe. |

**Plan handoff:** ready for an independent plan re-audit. This is not an independent audit PASS, implementation approval, production DDL authorization, or deployment authorization.
