# Production Recovery Authorization Plan

## 1. Status, purpose, and safety boundary

This document is the single source of truth for the production recovery authorization design. Future planning and implementation reviews should update or reference this document rather than reproduce the design in chat.

**Plan audit: PASS** on the implementation baseline `7053873ef386bbbae81896890c6a6b5ab36aeab4`. The latest user order authorizes code implementation of this plan only. It does not authorize production preparation or operations.

This document authorizes no production activity. Do not access production, provision roles or secrets, install or activate the recovery authority, create a production marker, run migration/restore/replay/backfill/activation/deploy, open traffic, push, or merge as part of planning.

The goal is a fail-closed, separately authorized in-place recovery after a release marker has been written. It preserves the captured pre-maintenance app artifact, keeps ordinary traffic in maintenance during restore, and requires distinct restore and post-restore authorizations.

## 2. Owner-approved decisions

- The rollback app SHA is the exact SHA actually serving before maintenance. It is captured from trusted host state, not supplied by an operator.
- Restore is in-place against the same logical production database and topology.
- Once the release marker exists, the system remains maintenance-only until the reviewed restore and recovery gates succeed. Process exit or a belief that DDL did not start never clears the marker.
- The first rollback-app start is externally constrained by PostgreSQL read-only privileges.
- After read-only compatibility is established and those connections are drained, recovery may reuse the existing canonical production app writer role. No permanent recovery writer role is introduced.
- A separate, future owner-authorized checkpoint prepares only the read-only recovery role bodycast_recovery_readonly.
- Forward migration/V4 authorization is independent of both recovery phases.
- Merge, ordinary startup, and ordinary deploy do not install recovery infrastructure, create roles/secrets, create a V2 marker, or execute recovery.

## 3. Trust model

Trust is divided among:

1. **Canonical reviewed code and provenance:** exact repository, main SHA, reviewed tooling manifest, and immutable digests.
2. **Root-owned host recovery authority:** sole writer of authoritative recovery state and sole broker for privileged production mutations.
3. **Independent approvals:** GitHub records prove only observable workflow/environment facts. Owner/security review and a dedicated policy signer establish the explicit trust boundary for environment settings, including settings GitHub API cannot prove.
4. **PostgreSQL enforcement:** the first rollback app process cannot write, regardless of app behavior.
5. **Durable evidence:** journal chain, signed authorizations, artifact capture, restore verification, rollout receipt, and completion receipt.

No workflow input, environment variable, repository script, operator-selected SHA, or caller-provided approved flag substitutes for these checks. A missing, stale, inconsistent, unverifiable, or unsupported fact blocks the operation and keeps maintenance in effect.

## 4. Root-owned host recovery authority

Install a narrowly scoped root-owned service/helper outside the mutable production checkout. Its code/configuration, private state directory, and private keys are not writable/readable by the production release user. The persistent authoritative state directory is root-owned mode 0700. Journal records and receipts are root-owned. The marker projection is root-owned and not writable by the release user; if ordinary readers require file access, expose only a fixed read-only projection path with a non-writable parent. The release user cannot alter the projection or authoritative state.

The service derives every trusted path internally, rejects symlinks/path traversal, validates canonical repository/main/tooling provenance, verifies authorization signatures and bindings, enforces the closed state machine, commits journal records without overwrite, projects marker state, and creates authenticated receipts. It does not accept arbitrary shell commands, paths, JSON-defined commands, or generic writes.

The fixed interface may expose only typed operations equivalent to:

- verify reader rollout;
- read authoritative state;
- apply one enumerated transition;
- rebuild marker projection from a validated journal tail;
- finalize recovery and remove the exact active projection after receipt verification.

Callers provide protocol inputs such as a signed envelope, evidence identifiers, and expected generation/digest. They cannot choose output bytes or a next state outside the authority's validated transition. Read-only diagnostics may remain available where safe. If the authority is unavailable, privileged operations and fail-closed gates stop.

Skipping a repository advisory lock does not grant write permission. Only the authority can mutate authoritative state or invoke the privileged production-operation broker.

## 5. Authority installation/update provenance and anti-rollback

Build and review the authority binary/package and configuration outside the mutable production checkout. `scripts/production-recovery/build-authority-package.mjs` emits a bundled authority executable and a separate non-privileged typed client. The authority bundle statically includes the independently reviewed host-adapter module; the adapter must satisfy the closed callbacks required by `createRecoveryHostRuntime`. Pin the authority and configuration digests. Install the authority under its private mode-0700 root and install only the public socket client in the separate root-owned, non-writable client path. A separate privileged, owner-authorized checkpoint performs that installation. The installer verifies signed provenance before installation and records:

- authorityVersion;
- binaryDigest;
- configDigest;
- authorityKeyId;
- installationReceiptDigest.

The release user cannot replace or downgrade authority code/configuration. Enforce a monotonic minimum allowed authority version or an explicit reviewed-version allowlist; reject stale or otherwise unauthorized versions. Authority signing material remains root-held and unavailable to repo code and ordinary workflows.

Any authority code/configuration change invalidates reader-rollout receipts and requires a fresh rollout verification. Authority installation/update is not part of merge or ordinary deploy.

## 6. Host-enforced Docker/Caddy/production mutation boundary

Filesystem protection of the journal is insufficient if the release user can bypass the authority by mutating production services directly. Before enabling marker V2, route all production mutations through fixed privileged host wrappers/services outside the mutable checkout. Each operation independently checks authoritative journal/marker state, canonical reviewed tooling/provenance, and the exact allowed release, image, state transition, and target.

The release user must not have unrestricted capability to:

- access or mutate the production Docker daemon/Compose project;
- run a production migration container;
- replace the production app;
- change Caddy configuration, routes, or reload state;
- deploy a rollback app;
- reopen traffic.

Constrain the Docker socket and daemon so the release user is not in the docker group and has no direct socket ACL, equivalent API endpoint, or unrestricted root/sudo route. Sudo policy must expose only fixed typed wrappers, not a shell, Docker, Compose, or arbitrary command. Caddy configuration and reload capabilities are restricted to the privileged broker; the release user cannot write the active config or call a reload/admin endpoint directly. Disable or restrict alternate credentials, service accounts, and host APIs that would provide equivalent mutation.

Each fixed wrapper checks the journal/marker itself and asks the authority to authorize the exact operation. An active marker blocks ordinary deploy, migration, and traffic cutover. Recovery exceptions are limited to the exact state, captured artifact, and transition allowed by the state machine. A stale checkout cannot bypass these controls by invoking Docker/Caddy directly.

Safe read-only diagnostics may remain available. Ordinary app/deploy behavior should remain functionally unchanged through the approved wrappers after the separate host-authority checkpoint; merging code does not install or activate that checkpoint.

## 7. Authoritative append-only recovery journal

One host-private append-only logical journal is the sole source of recovery state. It is stored as immutable generation records in a root-owned local-filesystem journal directory. There are no separate authoritative nonce or grant ledgers.

Each record binds at least:

- journal schema version and monotonic generation;
- exact prior generation and prior authoritative record digest;
- prior marker/state and next state;
- failedReleaseSha and rollbackAppSha;
- immutable rollback container/image/artifact identity and capture attestation;
- logical production database identity digest;
- transition purpose/phase and authorization ID;
- nonce and nonce-consumption identity where applicable;
- persisted narrow grant where applicable;
- source evidence digest and workflow/run provenance;
- host authority instance/version/key ID and timestamp.

Every externally visible host operation uses a reviewed operation-specific contract with a stable operation ID, immutable input digest, exact expected pre-state and post-state, and a fixed actual-state inspector. The sequence is: commit intent, inspect host state, skip the effect only when the exact post-state already exists, otherwise execute the fixed idempotent/deduplicated operation, reconcile the exact post-state, validate the typed operation-specific success, then write the durable authenticated receipt. A resolved callback or truthy response is not success. Undefined, false, malformed, wrong-ID, mismatched-input, and missing-postcondition results do not produce receipts. Same-ID concurrent execution is serialized; retries after a process crash inspect host state before any effect and fail closed on any state other than the exact pre-state or post-state.

The installed host adapter must implement operation contract version 2 and carry a current signed conformance receipt bound to its installed binary digest and the exact contract digest. Conformance covers migration, restore, application replacement/start/stop, writer enablement (including healthy writer-mode postcondition), traffic changes, and any external finalization effect. Authority readiness and mutation remain blocked until all operation classes pass the conformance suite. Authority-owned journal finalization is not an adapter callback: it has its own exact journal, receipt, marker, and retry-evidence checks under the authority lock.

The journal record schema is versioned independently from the marker schema. Version 1 is verified only against its original exact key set and is read-only; version 2 is verified against the new exact key set including operation intent/evidence. A chain may not mix versions. Unsupported versions or records with fields from another schema fail closed. No authority mutation implicitly upgrades or appends to a legacy chain.

The first record establishes the failed release and initial failed normal state. Every later state transition creates one new generation. No backward state transitions are allowed. A missing generation, duplicate/conflicting generation, invalid digest chain, or malformed committed record blocks recovery.

## 8. Canonical records, no-overwrite commit, and crash semantics

Encode records as canonical UTF-8 JSON using RFC 8785 JSON Canonicalization Scheme, without BOM or duplicate keys, with fixed enums, integer generations, UTC RFC 3339 timestamps, and lowercase hexadecimal digests. The authoritative record digest is SHA-256 over canonical record fields excluding the record's own digest field. Authority signature/MAC covers the canonical digest and record identity. The signature proves origin; the digest chain detects inconsistency.

The journal directory is on one persistent local filesystem, root-owned mode 0700. Reject symlinks for directory, temp files, and generation paths. Generation filenames contain only validated deterministic integers. Before enabling journal V2, verify on the production filesystem that same-filesystem hard links, O_EXCL, file fsync, and directory fsync work. If any capability is unavailable, fail closed and do not enable V2.

Under one exclusive host lock:

1. Validate the current journal tail and marker projection.
2. Re-read the expected predecessor generation/digest and verify authorization/live preconditions.
3. Prepare the complete next canonical record, including nonce consumption and grant if applicable.
4. Create a temp file in the same journal directory using O_CREAT|O_EXCL and mode 0600.
5. Write complete bytes and fsync the temp file.
6. Create the final generation path with same-filesystem hard-link creation, such as Node fs.link. The link must fail with EEXIST if that generation already exists. Never replace or unlink an existing final generation.
7. Fsync the journal directory. Successful hard-link creation is the atomic visibility point; directory fsync is required before acknowledging durable success.
8. Write the marker projection to a temp file, fsync it, atomically rename it, and fsync its directory.
9. Verify the projection matches the authoritative journal tail, then remove the journal temp file and fsync the journal directory again.
10. Release the lock.

On EEXIST, read and verify the existing generation, do not alter it, and reject/retry from the new authoritative tail. Temp files are never authoritative.

Crash handling:

- Temp created but not linked: no transition; ignore orphan temp.
- Crash during temp write: incomplete temp is not committed.
- Link visible but directory not fsynced: after restart, a present valid final record with the exact predecessor chain is authoritative; an absent final record means no transition. Do not acknowledge success until fsync completed.
- Link and directory fsync complete, marker not updated: journal commit stands; reconstruct marker from journal.
- Marker temp written but not renamed: journal stands; ignore temp and reconstruct projection.
- Marker renamed but directory not fsynced: projection may be old or new after restart; ordinary readers fail closed on mismatch, and recovery rebuilds from journal under lock.
- Link committed and fsynced but temp cleanup incomplete: final record remains authoritative; cleanup is idempotent.
- A malformed/truncated final generation record or broken chain is rejected and blocks recovery; never treat it as an earlier safe state.

Two contenders cannot commit the same predecessor under the same lock. The journal record itself proves nonce/grant consumption, avoiding an ambiguous consumed-nonce/missing-grant state.

## 9. Marker V2 projection and fail-closed readers

The marker is a cache/projection, not authority. It contains supported marker schema version, authoritative journal generation and record digest, projected state, and release bindings needed by readers. If it has a self-digest, compute SHA-256 over canonical fields excluding that digest.

Marker absent means only that the marker path does not exist. If it exists, first treat it as ACTIVE/BLOCKING, then parse. Malformed data, unsupported/legacy version in an unsupported context, future version, unknown state, recovery state on an ordinary path, or journal/digest mismatch all fail closed. None may be interpreted as absence.

Ordinary migration, deploy, traffic cutover, and rollback-deploy paths block on any active recovery marker. Only the recovery authority may rebuild a mismatched projection from a validated journal tail under lock. Ordinary readers fail closed even when rollout receipt is absent.

Before any V2 marker can be written, all canonical production entrypoints must use existence-first fail-closed readers. Production operations run only through canonical/current reviewed host tooling and exact allowed main/release state; stale checkouts are rejected. Audit/test every installed V1/pre-V2 reader against malformed markers and each V2/recovery state. If any old reader could treat V2 as safe/absent, either provide a backward-compatible blocking representation or ensure the host-enforced privileged boundary makes that reader unable to perform authoritative operations. Do not rely on operator discipline.

## 10. Marker-reader rollout attestation

The host authority exposes the reader-rollout verification operation; a repo script cannot issue its own receipt. The authority checks an exact reviewed entrypoint manifest covering every authoritative deploy, migration, traffic, recovery, and marker read/write entrypoint/helper. It verifies installed Git blob SHA and SHA-256 digests, canonical repository/main provenance, host/topology identity, stale-checkout rejection, and compatibility fixtures for malformed marker, unsupported V1, all V2 recovery states, unknown V2 state, and future schema version.

After successful verification, the authority creates a root-owned authenticated receipt containing schema version, repository, canonical main SHA, reviewed manifest, exact entrypoint/helper digests, marker reader protocol version, host/topology identity digest, evidence digest, creation time, expiry or policy validity, receipt digest, and authority provenance/signature.

Every operation capable of creating marker V2 checks that the receipt exists and is current; canonical main, installed manifest/digests, host/topology, authority provenance, and validity all match. Relevant tooling or authority code/config changes invalidate it. No environment boolean or workflow input substitutes for the receipt.

The required precondition is a verified, current authority-issued reader-rollout receipt before any production workflow can create a V2 marker.

## 11. Two-phase recovery authorization

Phase A authorizes only restore. Phase B is a separate authorization after restore verification. Each phase has its own closed claim schema, purpose, capability, signer/verifier, approval, policy attestation, nonce, and journal consumption. Phase A cannot authorize Phase B or forward migration; Phase B cannot authorize Phase A or forward migration. Forward migration authorization rejects both recovery envelopes.

Workflow inputs are selectors only. Trusted claims are independently derived, signed, bound, and rechecked by the host authority. Missing, extra, expired, replayed, drifted, or mismatched claims fail closed.

### Phase A closed claims

Reject any missing or unknown claim. Claims are:

- schemaVersion;
- purpose = recovery Phase A restore-only;
- capability = restore-only;
- repository;
- workflowPath, workflowId, workflowRunId, workflowRunAttempt, workflowRef;
- canonicalMainSha and recoveryEnvironment;
- failedReleaseSha and manifestId;
- priorJournalGeneration and priorJournalRecordDigest;
- priorMarkerSchemaVersion, priorMarkerState, priorMarkerDigest;
- rollbackAppSha, rollbackContainerId, rollbackImageId, rollbackImageDigest, rollbackArtifactId, rollbackArtifactDigest, rollbackCaptureAttestationDigest;
- composeProjectServiceIdentityDigest and deployHostTopologyDigest;
- backupArtifactId, backupArtifactDigest, hostBackupSha256, backupSnapshotTimestamp;
- logicalProductionDbIdentityDigest;
- expectedPreDdlSchemaDigest and expectedPreDdlMigrationHistoryDigest;
- preflightEvidenceDigest;
- ownerApproval with environment, reviewerGithubUserId, reviewerLogin, approvalState, approvalTime, runId, runAttempt;
- markerReaderRolloutReceiptDigest;
- phaseAPolicyAttestationDigest, phaseAPolicyAttestationNonce, phaseAPolicyReviewedAt, phaseAPolicyExpiresAt, phaseAPolicyVersion;
- hostRecoveryAuthorityIdentity and hostRecoveryAuthorityKeyId;
- issuedAt, expiresAt, authorizationId, nonce.

### Phase B closed claims

Reject any missing or unknown claim. Claims are:

- schemaVersion;
- purpose = post-restore recovery authorization;
- capabilitySet = exact reviewed recovery transition set;
- repository;
- workflowPath, workflowId, workflowRunId, workflowRunAttempt, workflowRef;
- canonicalMainSha and recoveryEnvironment;
- failedReleaseSha and manifestId;
- phaseAAuthorizationId, phaseAEnvelopeDigest, phaseAJournalGeneration, phaseAJournalRecordDigest;
- restoreInProgressJournalGeneration, restoreInProgressJournalRecordDigest;
- restoreVerifiedJournalGeneration, restoreVerifiedJournalRecordDigest;
- restoreEvidenceArtifactId, restoreEvidenceArtifactDigest, restoreResultDigest;
- backupArtifactId, backupArtifactDigest, hostBackupSha256, backupSnapshotTimestamp;
- actualRestoredLogicalDbIdentityDigest and liveDbObservationsDigest;
- expectedRestoredSchemaDigest, actualRestoredSchemaDigest;
- expectedMigrationHistoryDigest, actualMigrationHistoryDigest;
- writerDrainDigest, topologyDigest, observedAt;
- rollbackAppSha, rollbackContainerId, rollbackImageId, rollbackImageDigest, rollbackArtifactId, rollbackArtifactDigest, rollbackCaptureAttestationDigest;
- composeProjectServiceIdentityDigest and deployHostTopologyDigest;
- ownerApproval with environment, reviewerGithubUserId, reviewerLogin, approvalState, approvalTime, runId, runAttempt;
- markerReaderRolloutReceiptDigest;
- phaseBPolicyAttestationDigest, phaseBPolicyAttestationNonce, phaseBPolicyReviewedAt, phaseBPolicyExpiresAt, phaseBPolicyVersion;
- hostRecoveryAuthorityIdentity and hostRecoveryAuthorityKeyId;
- issuedAt, expiresAt, authorizationId, nonce.

Phase B rejects any rollback artifact mismatch against Phase A and pre-maintenance capture.

### Forward migration live challenge and proof

Forward migration is a two-call broker flow. After the existing signed live guard, the challenge request captures fresh release SHA, migration manifest, logical database identity, absent marker state, authoritative recovery generation/digest, pending migration-set digest/count, and exact workflow/run/attempt. The root authority durably records the random nonce, challenge ID, challenge digest, issue time, and short expiry in an immutable signed receipt. The workflow obtains fresh OIDC execution proof for that broker challenge and submits the exact challenge ID/digest with the proof; caller environment flags cannot create authorization. After the OIDC round trip, the release script resamples PostgreSQL/writer state and repeats the signed live guard before forwarding the proof.

The broker verifies proof issuer, audience, challenge/nonce digest, release, manifest, database identity, workflow/run/attempt, and expiry. Before the irreversible boundary it rechecks the live database, pending migration set, and final guards. The fixed adapter durably writes the exact `ddl-started` marker first, then invokes the broker's one-time pre-effect guard immediately before Prisma spawn. That guard rechecks release/main, marker digest/state, database and pending set, recovery state, proof, and existing final migration guards, then durably consumes the challenge. Missing, expired, consumed, replayed, or drifted challenges cannot authorize another DDL attempt. A repeat with the same consumed challenge/proof can only reconcile an exact completed post-state without repeating the effect; a different operation/proof or unfinished/unknown state stays blocked for reviewed recovery.

### Traffic serving and Unified V4

`traffic-serve` checks production Unified V4 currentness at the authority boundary immediately before the fixed adapter mutates the authoritative route. The check must bind the exact release and canonical main SHA, V4 model revision, current and published generation, rollout epoch, and equal current/published source digests. It is repeated at the adapter's pre-effect callback. Missing, stale, mismatched, failed, or changed V4 evidence blocks route mutation. Caller-side preflight is not sufficient.

## 12. Per-phase environment-policy attestation and independent signer

Use a fresh single-use owner-reviewed policy attestation for each phase, created after the recovery case exists and immediately before that phase authorization. Maximum lifetime is 30 minutes. It cannot be reused for another case, phase, run/attempt, main SHA, reviewer, environment configuration, or nonce. Consumption is recorded in the corresponding authoritative journal transition.

Closed policy attestation fields:

- schemaVersion;
- purpose = recovery-environment-policy-review;
- recoveryCaseId;
- phase = A or B;
- repository and canonicalMainSha;
- environment = production-recovery;
- exact workflowPath, workflowId, workflowRunId, workflowRunAttempt;
- allowlistedReviewerGithubUserIds and reviewedReviewerGithubUserId;
- ownerApprovalId and ownerApprovalTimestamp;
- preventSelfReviewRequired = true;
- adminBypassRequiredDisabled = true;
- branchPolicy = main-only;
- reviewedConfigurationDigest;
- reviewedAt, expiresAt, singleUseRequestId, singleUseNonce, policyVersion;
- signer, keyId, signature.

The dedicated policy signer signs only after independently verifying authenticated owner/security approval bound to recoveryCaseId, phase, repository, canonicalMainSha, workflow path/ID, run/attempt, reviewed configuration snapshot digest, reviewer identity, approval ID and timestamp, and single-use request ID/nonce. Caller-supplied approved flags, JSON, environment variables, or workflow job state are not proof. Recovery workflow credentials alone cannot obtain a valid signature. The signing key is unavailable to ordinary repo/workflow code.

GitHub API checks exact observable repository/workflow/run/attempt/environment, approval identity/state/time, and required reviewer/prevent-self-review configuration where exposed. It does not prove hidden admin-bypass settings. The owner/security reviewer independently inspects the full protected-environment configuration and approves the snapshot; the signed attestation defines this explicit trust boundary. Host authority verifies signature, expiry, phase, case/run/main/reviewer and digest, then repeats the checks. Missing, reused, expired, changed, or mismatched policy fails closed.

## 13. Immutable rollback artifact capture and retention

Before maintenance, capture the exact currently serving rollbackAppSha and immutable artifact provenance:

- running container ID and image ID;
- immutable image digest and stored OCI/registry artifact ID/reference/content digest;
- Compose project/service identity;
- deploy/host topology identity;
- capture attestation digest;
- artifact availability/retention proof.

Bind the complete identity through pre-DDL evidence, initial journal/marker, Phase A, restore evidence, Phase B, all recovery states, and final receipt. No operator-selected substitute or rebuilt image is accepted, even if it was built from the same SHA. Missing artifact or any digest mismatch leaves recovery blocked in maintenance.

## 14. Logical production database identity

Bind the same logical in-place database across preflight, backup, restore, Phase A/B, and post-restore checks. Canonical host-side identity includes deploy root, host/topology ID, Compose project/config identity, DB service, volume/storage identity, configured DB name, expected roles, backend network/topology, and application DB binding. PostgreSQL OID, IP, port, and version are supporting observations only and may change during restore. Any canonical identity or topology mismatch blocks recovery.

Capture exact backup artifact ID/digest, host-side SHA-256, snapshot time, expected pre-DDL schema digest, migration-history digest, and preflight evidence. Restore is same-logical-database in-place; a rehearsal or disposable restore is not production restore evidence.

## 15. Recovery state machine

The failed normal marker state is one of ddl-started, schema-applied, or app-ready. The transitions are:

| Transition | Required gate |
|---|---|
| failed normal state → restore-authorized | Phase A envelope and fresh Phase A policy validate for exact current marker/journal, rollback artifact, and database identity; authorization/nonce/grant commit together in one journal generation. |
| restore-authorized → restore-in-progress | Persisted narrow grant, exact predecessor, and fresh live checks pass. Phase A envelope is not consumed again. |
| restore-in-progress → restore-verified | In-place restore completes and post-restore identity, schema, migration history, and evidence are verified. |
| restore-verified → recovery-authorized | Separate Phase B envelope and fresh Phase B policy validate against the exact restore evidence and captured rollback artifact. |
| recovery-authorized → rollback-app-ready | Exact captured image starts under external PostgreSQL read-only enforcement and passes readiness plus schema compatibility. |
| rollback-app-ready → writers-enabled | Read-only app stopped; all sessions/writers drained and topology rechecked; same image starts with existing canonical production app role. |
| writers-enabled → recovery-complete | App health and recovery integrity checks pass. |
| recovery-complete → traffic-open | Explicit guarded traffic transition and fresh live checks pass. |
| traffic-open → recovery-finalized | Rollback release is serving and final health/topology checks pass. |
| recovery-finalized → receipt → marker projection removed | Authenticated immutable completion receipt is durably written and verified before removing the exact active projection. |

Every transition is an authoritative journal generation. No backward transition is permitted. Ordinary operations block on any active marker. If projection disagrees with journal, ordinary paths fail closed; only the authority may reconstruct it from validated journal tail under lock.

### Failure boundary

Before marker creation, a reviewed pre-DDL abort may return to the prior normal release. Once the marker exists, treat schema as potentially changed—even before or around Prisma spawn. Keep maintenance, do not run the old app, and do not clear marker because of process exit or an inference that DDL did not start. Recovery requires reviewed restore and verification. No automatic marker cleanup.

## 16. Read-only rollback app runtime

The first start of the captured old image is isolated: Caddy remains in maintenance with no public route to the recovery app; no migration container, worker, or companion writer runs; recovery service uses restart:no and only bodycast_recovery_readonly credentials. PostgreSQL is the primary enforcement: the role has no object ownership, DML/DDL, write-capable function execution, or privileged rights. Add read-only transaction enforcement as defense in depth and prove write probes are rejected.

Implementation must demonstrate that the exact captured old image can start, pass meaningful readiness (not only SELECT 1), and run a dedicated read-only schema compatibility check for that rollback release. If it requires writes or cannot prove compatibility, do not weaken DB privileges; block recovery in maintenance.

## 17. Writer-enable transition

After read-only validation, stop the recovery app, drain its sessions, and verify no other writer remains. Recheck topology and marker/journal under authority control. Only then start the same immutable image with the existing canonical production app DB role. Do not create a permanent recovery writer account. Any failed check keeps traffic closed and marker active.

## 18. Completion receipt and marker removal

The authority writes and authenticates an immutable completion receipt binding final journal generation/digest, full lineage, failed release, rollback SHA/image/artifact, backup, Phase A/B authorization IDs, restored DB identity, schema/history verification, writer/topology evidence, traffic target, health result, and timestamp/provenance.

Under the host lock, finalization rechecks the exact active marker and predecessor, traffic-open state, actual serving rollback artifact, database identity, and final health/topology. The authority durably writes and verifies the receipt before removing only the exact active marker projection. A crash after receipt creation but before marker removal is safely retryable for that exact journal generation and evidence; retry returns the same immutable receipt, while different evidence is rejected. Receipt remains audit evidence, not an active blocker for future releases.

No generic/manual marker clear is allowed.

## 19. Merge safety and later production checkpoints

Code merge does not install/activate the privileged authority, create roles/secrets, trigger recovery, create marker V2 during startup, or run production migration/restore. Missing preparation blocks future migration/recovery readiness, not current ordinary runtime. Ordinary production behavior remains unchanged until separately authorized host preparation; later ordinary deploys continue through constrained privileged wrappers.

Separate checkpoints:

1. Merge the reviewed plan/implementation code.
2. Separate owner-authorized authority package/config installation and verification, including anti-rollback.
3. Reader rollout verification and current authority-issued marker-reader receipt.
4. Separate owner-authorized preparation of only bodycast_recovery_readonly, its secret, privilege audit, and runtime checks.
5. Future owner-authorized production migration. Production operations are not authorized by merge.

Before marker V2 or a migration relying on this recovery path, require checkpoints 2–4 and a current rollout receipt. Missing/wrong role or secret, unsafe privileges, missing authority, stale receipt, incompatible old image, or failed identity check blocks readiness.

## 20. Test strategy

All database tests use isolated localhost *_test databases. Never use production credentials or databases.

**Authority and mutation boundary**

- Release user cannot create/replace journal generations, marker projection, rollout receipt, completion receipt, or private keys.
- Stale checkout cannot write authoritative state.
- Bypassing repo advisory lock gives no mutation rights.
- Release user cannot access Docker socket/daemon, run Compose/migration/app replacement, mutate/reload Caddy, deploy rollback, or reopen traffic except through fixed authorized wrappers.
- Unauthorized operation, arbitrary path, symlink, wrong image/state, and unavailable authority are rejected; safe read-only diagnostics remain available.
- Authority verifies exact predecessor, state machine, signed envelope, provenance, and root-issued receipts; forged same-shape receipts fail.
- Every host operation rejects false/undefined/malformed/wrong-ID results and reconciles exact operation-specific post-state before its receipt is persisted.
- Adapter conformance fixtures cover success, failure, crash before receipt, completed-state replay without duplicate effect, wrong post-state, wrong idempotency binding, and concurrent duplicate replay.
- Migration tests cover missing/stale/replayed challenge, wrong or cross-challenge proof, changed database/marker/release, and the durable marker-before-Prisma guard.
- Traffic tests prove missing/stale/changed Unified V4 currentness prevents the authoritative route mutation.

**Authority installation and rollout**

- Unsigned/wrong-digest package/config, below-minimum version, unallowlisted version, or downgrade is rejected.
- Authority code/config change invalidates rollout receipt.
- Every installed authoritative entrypoint is covered by the reviewed manifest and compatibility fixtures.
- Malformed, unsupported V1, every recovery state, unknown V2, and future marker version block.
- Old reader treating V2 as safe fails rollout verification; stale main/tooling/host fails; env boolean cannot substitute for receipt.
- Valid current authority-issued receipt permits V2 marker creation.

**Journal/crash safety**

- Two contenders for one generation: exactly one hard-link commit succeeds; EEXIST never overwrites.
- Symlink paths, unsupported hard links/O_EXCL/fsync, and cross-filesystem links fail closed.
- Partial/orphan temp records are not authoritative.
- Crash after link before directory fsync, after journal commit before marker update, marker temp before rename, rename before directory fsync, and temp cleanup are recoverable from authoritative generation.
- Missing/stale projection is reconstructed from journal; malformed committed record or broken chain blocks.
- Same nonce cannot produce two committed transitions; nonce and grant are in the same journal record.
- Version 1 records use the original exact schema and remain read-only; version 2 records require intent/evidence keys; missing, mixed, or unsupported schema chains fail closed.

**Authorization and policy**

- Missing/extra Phase A/B claims; wrong repository/workflow/path/ID/run/attempt/ref/main/environment/case/state/digest; wrong artifact/database/topology; expiry and replay all reject.
- Phase A/B/forward cross-use rejects.
- GitHub approval without policy attestation is insufficient.
- Policy signer rejects caller-supplied approved flags and workflow-only credentials.
- Missing/invalid signature, expired (>30 minutes), reused nonce, wrong phase/case/run/attempt/main/reviewer/configuration, or reviewer not allowlisted rejects.
- Phase A policy cannot authorize Phase B; policy consumption appears in the exact authoritative journal transition.

**Artifact, database, and app**

- Missing exact artifact, same SHA with different image digest, rebuilt image, or changed capture attestation blocks.
- Changed logical DB identity/topology blocks.
- RO role write probes fail; ownership, DML/DDL, privileged rights, and unsafe functions are absent.
- Exact old image passes meaningful read-only readiness and schema compatibility checks; otherwise recovery stays blocked.
- Full isolated two-phase recovery success path covers capture, marker, Phase A, in-place restore, verification, Phase B, RO app, drain, writer enable, health, traffic, receipt, and marker removal.
- Restore interruption, writer presence, bad schema, app incompatibility, health failure, receipt/marker crash, and authorization drift remain fail-closed.
- Normal migration/V4 regression tests prove no authorization cross-use and no ordinary startup activation.

**Merge safety**

- Merge/deploy does not install host authority or provision role/secret.
- Missing authority/receipt/role blocks only future marker-V2 migration/recovery readiness.
- Current ordinary app/deploy remains functional before preparation and uses only the constrained host wrappers after installation.

## 21. Explicit non-goals and forbidden shortcuts

- No production migration, restore, replay, backfill, activation, deploy, role/secret provisioning, or traffic operation as part of planning or code merge.
- No automatic recovery, marker cleanup, or “DDL probably did not run” inference.
- No bypass based on operator discipline, repo advisory lock, caller-supplied approval flag, environment variable, or mutable checkout.
- No direct release-user Docker/Caddy/migration capability.
- No replacement/rebuild of the captured rollback artifact.
- No relaxed PostgreSQL permissions to make the old app start.
- No reuse of Phase A authorization for Phase B or forward migration.

## 22. Current audit status

- The canonical implementation plan passed its independent plan audit on the baseline identified in Section 1.
- Code implementation is authorized by the current user order, subject to the code-only scope and invariants in this document.
- Round-2 recovery safety changes are implemented against the audited code base and are pending independent re-audit; the host adapter is not installed, and readiness remains fail-closed until its signed exact-binary conformance receipt is present.
- Production migration, restore, replay, backfill, activation, deploy, role/secret provisioning, host authority installation/activation, traffic changes, push, and merge remain unauthorized in this implementation task.
- This implementation and its local validation are for independent implementation audit before any separate production-preparation checkpoint.
