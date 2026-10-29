# BodyCast authentication and multi-user transition plan

**Status:** `IMPLEMENTED ON MAIN; OWNER BOOTSTRAP READY FOR A SEPARATELY AUTHORIZED FUTURE CUTOVER`
**Scope:** Architecture and implementation contract. This plan does not authorize production DDL, owner bootstrap, public-signup activation, or deployment.
**Implementation source baseline:** `26ba69fb9c2997559826d0cd7ee8786121c5109d`; this readiness change also adds the missing Profile API-key UI.
**Auth API basis:** The implementation pins Better Auth `1.7.14`; this checkout uses Next.js `16.3.6` and Prisma `6.19`.

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

The implementation pins `better-auth` to `1.7.14` and records the compatible Prisma adapter in the lockfile. Better Auth's Prisma documentation says Prisma 6 can keep its existing Prisma Client setup. Do not change this to an unpinned `latest` API.

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

This is the minimal safe stock flow for a password account. One OTP is not selected for phase 1: `signInEmailOTP` creates a session and exposes its token before application-level provisioning has completed, while `signUpEmail` necessarily creates a credential and `setPassword` cannot replace it. A one-OTP variant would need additional session interception/revocation or credential-deletion orchestration. That is more custom security logic than the second standard OTP. The owner has accepted this two-OTP flow and will set the initial password directly; no temporary password is handed to the owner.

Pin these settings in the Better Auth configuration rather than relying on defaults:

- `emailAndPassword.enabled = true`, `requireEmailVerification = true`, `autoSignIn = false`.
- `emailVerification.sendOnSignUp = true`, `autoSignInAfterVerification = false`.
- `emailOTP({ overrideDefaultEmailVerification: true, disableSignUp: true, expiresIn: 300, allowedAttempts: 3, storeOTP: "hashed", resendStrategy: "rotate", sendVerificationOTP })`.
- Do not enable the plugin's separate `sendVerificationOnSignUp` hook when `overrideDefaultEmailVerification` is handling the signup verification message; that avoids double sends. Confirm these exact option names against the pinned `v1.7.14` package types during implementation.

**State transitions:**

1. **Registration start.** `POST /api/registration/start` accepts only normalized email and display name. It accepts no password, `userId`, `profileId`, `emailVerified`, role, or other Better Auth additional fields.
2. The server calls the pinned `auth.api.signUpEmail` with a cryptographically random, server-generated credential, `requireEmailVerification: true`, and `autoSignIn: false`. Never log or return this credential. It is not known to the registrant and cannot be used before verified email and Profile provisioning.
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

### Owner bootstrap and first password

- The owner has supplied the exact email out-of-band and authorized the product contract. Configure that exact address through `AUTH_PROFILE_ONE_OWNER_EMAIL`; do not commit the address or credentials. Enable `AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED=true` only with public registration disabled and valid Brevo configuration. While bootstrap is enabled, non-owner registration requests stay generic and create no users.
- The owner starts registration and proves mailbox control with OTP1. Only after Better Auth consumes OTP1 does the server transaction bind the verified User to the existing Profile 1. It rejects a missing Profile 1, a Profile 1 bound to another User, or an owner User already attached elsewhere. It does not create an owner Profile or touch Profile 1's existing data.
- The verification callback creates no session. The owner then requests OTP2 and sets their own password through the guarded Better Auth password-reset flow. The callback clears `passwordChangeRequired` only for a verified User that already has a Profile. No temporary password is sent or handed over.
- Ordinary login is allowed after OTP2 succeeds. If the password update succeeds but its callback fails, keep the account restricted and repeat the OTP-backed reset; never clear the flag because a session exists. Existing sessions are revoked on reset/change.
- Do not accept client writes to `passwordChangeRequired`. Do not open public registration until owner/Profile 1 binding, password setup/login, raw-data integrity and tenant-isolation postflight have passed.

## 6. Tenant ownership and isolation contract

### Implemented ownership model and invariants

- The additive Auth migration adds nullable unique `Profile.userId` for the one-to-one owner mapping; Profile 1 remains intact until the separately authorized owner bootstrap.
- Tenant-owned tables are explicitly scoped or reached through an ownership-checked parent path. Scope includes Health raw rows/snapshots, daily data, metric samples, activity intervals, workouts, strength/session history, canonical energy, and Forecast/Goal/model-publication state.
- User-owned Prisma models and runtime repository methods do not default to Profile 1. A missing owner fails closed.
- `profileId` comes only from a verified session, a verified per-profile sync key, or a durable job carrying a profile ID. No request body, query parameter, nested ID, or global singleton supplies it.
- Profile 1 is permitted only in clearly isolated legacy bootstrap/recovery tooling, never an ordinary runtime read/write.
- Inventory and scope every global unique key that represents user data. Examples: `DailyHealthData.date` becomes unique by `(profileId, date)`; `HealthMetricSample(metric,timestamp)` becomes unique by `(profileId, metric, timestamp)`; `HealthActivityInterval.sourceFingerprint` becomes unique by `(profileId, sourceFingerprint)`. Preserve the fingerprint payload itself; tenant scope belongs in the key/ownership contract, not a rewritten provenance value.
- Add composite ownership foreign keys for cross-profile references where practical, such as a Strength session's matched Workout and a Health snapshot's daily row. For nested writes, resolve every parent with both its ID and trusted `profileId` inside the same transaction. Keep global primary IDs, but do not treat global ID uniqueness as authorization.
- `HealthSyncSnapshot` keeps a composite `(profileId, dailyHealthDataId)` FK with `ON DELETE RESTRICT`, matching Prisma. The authorized DailyHealthData delete path transactionally nulls only that optional pointer before deleting the projection; snapshot payload, timestamps, and source evidence remain unchanged. Apply the FK contract only while old delete writers are quiesced under maintenance; do not rely on a database-only partial `SET NULL` action that Prisma cannot represent.
- Set deletion behavior to restrict for Profiles with health/training data. Disable Better Auth user deletion and do not cascade-delete primary records in phase 1.

### Scope boundaries enforced by the implementation

- **Health:** daily data, samples, snapshots, activity intervals, sync, import keys, source reconciliation, and retention/audit paths.
- **Training:** Workout, Stepper, Strength session, exercise/set IDs, accounting snapshots/operations, program/catalog, and Garmin reconciliation.
- **Model/publication:** ModelEpisode, V7, Unified, active energy canonical events/candidates/resolutions, fingerprints, generation jobs, Forecast, and Goal.
- **API/SSR:** all API routes, server actions, route loaders, server components, mutation services, and nested-ID lookups; API keys resolve exactly one Profile.
- **Workers/jobs:** Health and Training refresh jobs, V7/Unified publishing, retries, lock keys and deduplication all carry Profile ID. A worker never calls a default Profile 1 repository method.
- **Cache/publication:** disable shared/static caching for private responses or include Profile ID in every cache key/tag. Publication fences, currentness state, generation counters, and candidate lookups are Profile-scoped.

The former runtime Profile 1 fallbacks in Training, Stepper, V7, Energy, and Forecast were removed or made explicitly scoped. The remaining explicit Profile 1 paths are the feature-gated legacy Shortcut principal in `src/modules/auth/access.ts` and the isolated historical provenance backfill in `src/modules/health/legacy-weight-provenance-backfill.ts`; neither is an ordinary session-scoped tenant fallback. Recheck these two paths before activation and keep the legacy Shortcut feature enabled only for the approved transition window.

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

### Protected production configuration checklist

Set values only in the protected runtime secret/config store; never put them in Git, CI output, logs, or this document.

- `BETTER_AUTH_SECRET`: a unique random secret of at least 32 characters.
- `BETTER_AUTH_URL`: the canonical HTTPS BodyCast origin.
- `AUTH_TRUSTED_ORIGINS`: explicit comma-separated HTTPS origins that are allowed to make auth requests; no wildcard.
- `AUTH_TRUSTED_PROXIES`: exact proxy address/CIDR entries for the production ingress; validate against the actual app network.
- `AUTH_PROFILE_ONE_OWNER_EMAIL`: the owner’s exact normalized email. `AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED=true` requires this and the Brevo values below.
- `AUTH_PUBLIC_REGISTRATION_ENABLED=false` during owner bootstrap; it must not be true at the same time as `AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED=true`.
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`: valid provider credential and verified sender. Confirm quota and delivery only after a separately authorized production configuration and email check; CI uses a stub, never production Brevo.
- `AUTH_EMAIL_DAILY_LIMIT` and `AUTH_EMAIL_RECIPIENT_DAILY_LIMIT` are optional bounded quota overrides; defaults are 250 messages/day and 10 messages/recipient/day.
- Preserve the existing `IOS_SHORTCUT_API_KEY` secret and set `LEGACY_IOS_SHORTCUT_ENABLED=true` during the legacy-to-personal-key transition. Do not log or regenerate the existing key. The current env schema still requires this variable even after the legacy flag is disabled.
- Production startup also requires the existing database URL, HTTPS, secure HttpOnly/SameSite cookies, and the actual trusted-proxy setting. Verify all without disclosing values.

### Apple Shortcut key transition

The UI creates, lists, rotates, and revokes per-Profile keys; only a digest is stored and a newly created secret is shown once. After the owner is authenticated to Profile 1, create one personal key in Profile settings, replace only the existing Shortcut’s `x-api-key` value, run one owner-authorized sync, and confirm it resolves to Profile 1 without changing the payload contract. Keep the legacy key enabled until that sync and ownership/integrity checks pass. Then disable `LEGACY_IOS_SHORTCUT_ENABLED` through the separately authorized config change and revoke the personal key only through its Profile-scoped UI. Do not create a production key as part of readiness work.

## 8. Implementation and activation status

- Core Auth, owner bootstrap, Profile 1 binding, tenant scoping, API-key endpoints, migrations, and targeted integration tests are implemented on the recorded source baseline and merged to `main`. This readiness change adds the missing Profile settings UI for personal API-key creation, one-time copy, rotation, and revocation; it reuses the existing scoped endpoints.
- No production schema/data/owner changes, email OTP, activation, or deployment were performed by this readiness pass.
- Future production work follows section 7’s protected preflight, separate backup/restore and DDL authorization, maintenance, exact migration, tenant-aware serving with public registration off, OTP1 Profile 1 binding, OTP2 password setup, integrity/currentness acceptance, and only then public signup activation.
- Rollback remains limited to a schema-compatible, tenant-safe code/schema pair. After owner/multi-user activation, never return to code that serves user data without tenant scoping. Retire the legacy Shortcut key only after its personal Profile 1 key is verified.

No new queue, generalized tenancy framework, custom OTP store, custom cryptographic primitive, social-auth provider, broad release runner, or duplicate test framework is planned.

## 9. Targeted acceptance tests

Run only against an isolated PostgreSQL database using the pinned dependency versions:

1. **Signup and routes:** exact Better Auth HTTP paths; raw `/sign-up/email` and `/sign-in/email-otp` are blocked; trusted server registration still works; no direct route can set `emailVerified`, create a session, or choose a persistent pre-verification password.
2. **No pre-proof access:** password login, API, SSR, server action, sync key creation, and Profile lookup all fail before OTP1; no Profile or session exists.
3. **OTP contract:** hashed storage, expiry, max attempts, resend rotation, IP/email rate limits, generic duplicate/unknown responses, atomic single-use, replay, and concurrent verification.
4. **Provisioning recovery:** consume OTP1, force Profile insert failure, prove no session/token/cookie is returned, resend and verify a fresh OTP, then prove exactly one empty Profile and no reliance on request-supplied identity.
5. **Password installation/reset:** OTP2 cannot run for unverified/no-Profile Users; it succeeds after Profile provisioning; reset revokes sessions; OTP2 cannot substitute for OTP1 or verify an email by itself.
6. **Password callback recovery:** inject failure after password update/OTP consumption; user remains data-restricted; a new OTP-backed reset completes safely; concurrent resets are single-winner. Never clear the restriction solely because a session exists.
7. **Tenant isolation:** missing owner, foreign Profile, cross-profile nested Workout/Strength/Stepper ID, conflicting global keys, concurrent workers for different profiles, and request-supplied owner all fail closed.
8. **Legacy preservation:** Profile 1 ID and physiology/raw/provenance payloads remain unchanged; scoped unique keys allow equivalent values in different Profiles; cascades cannot delete primary history.
9. **HealthSyncAudit:** unauthenticated row has no trusted tenant, tenant APIs cannot read audit rows, authorized key maps to exactly one Profile, and 30-day pruning affects only eligible audit rows.
10. **Workers/currentness:** Health, Training, V7, Unified, Energy, Forecast, and Goal jobs run with explicit Profile IDs; generation and publication fences remain isolated per Profile.
11. **Migration rehearsal:** restore backup to isolated PostgreSQL, apply reviewed exact SQL, backfill Profile 1 ownership, compare strict raw projections/provenance, test candidate/tenant-safe rollback compatibility, and confirm no production credentials or DB were used.

Do not expand into a broad test framework; add these to the existing targeted integration surfaces.

## 10. Owner decisions and authorization still required

Already decided: public registration is the product direction, email OTP is mandatory, the owner uses the existing Profile 1, the owner sets their own first password through the two-OTP flow, temporary-password delivery is not used, and HealthSyncAudit retains its approved 30-day policy. Invite-only is rejected. Public registration remains operationally disabled until after owner bootstrap acceptance.

Still required before production activation:

1. Configure and verify the owner address, Better Auth secret/URL/origins/proxy, and Brevo API/sender values in the protected production environment. Do not place secrets or the owner email in Git, logs, or this plan.
2. Separate exact authorization for production backup/isolated restore, DDL, Profile 1 ownership bootstrap, maintenance, and the exact-SHA deployment. This plan authorizes none of those operations.
3. Decide and implement safe User/Profile deletion and health-data retention semantics before enabling deletion. Until then, deletion remains disabled and Profile deletion is restricted.

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
