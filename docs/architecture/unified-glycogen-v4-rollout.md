# Unified V4 physical glycogen and associated water

## State contract

`DailyModelState.glycogenKg` is the physical glycogen authority. A present complete current row with a finite nonnegative value is authoritative, including an explicit zero. A present row with a null value blocks the episode fallback. Only when no episode-local production row exists may `ModelEpisode.initialGlycogenKg` supply a finite, strictly positive initial value. Relative glycogen shadows are diagnostic only. The sole water conversion is `calculateGlycogenAssociatedWaterKg` in `src/model/body-composition/state.ts`; transient exercise water remains a separate component.

The Unified lifecycle starts at V3, rollout epoch `0`, with no published V3 marker. Migration never selects V4. `scripts/unified-v3-postflight.ts` checks exact source coverage, episode boundaries, source lineage and predecessor fingerprints, then sets published epoch `0` only after a profile-serialized source-token recheck. `scripts/unified-v4-activate-replay.ts --activate-v4 --owner-authorized --profile-id <id>` explicitly advances the target and epoch, replays V4 and verifies its currentness. Retry in the same unpublished V4 epoch is safe; already-current V4 is a read-only idempotent result.

Forecast V2 is the only application forecast path. It requires lifecycle target V4, a published V4 rollout epoch matching the target epoch, current production and Unified generations, an exact V4 row at the latest completed episode day, and valid physical glycogen plus matching canonical water. Missing, null, or stale evidence produces a typed blocked result. Requests, startup and ordinary deployment do not activate or replay V4.

## Global lock order

Acquire conflicting locks in this order:

1. Physiology profile transaction advisory lock `(927001, profileId)`.
2. Relative Muscle rebuild advisory lock `(1886417000, profileId)` when that diagnostic rebuild is involved.
3. Stable source-row locks, including StrengthDiarySession `FOR UPDATE`, ordered by primary key when a transaction needs more than one.
4. Derived-output, Active Energy alias/event, and lifecycle row writes. Repeated acquisition of the profile advisory lock in one transaction is reentrant and may be used by existing invalidation helpers.

Long candidate computation and external work stay outside the profile lock. Publishers capture source/dependency tokens before computation, acquire the profile lock only for final publication, reload the token, then write rows and lifecycle markers atomically. Source mutation and its invalidation share one transaction. Production-affecting inputs advance the production invalidation generation; shadow-only inputs clear Unified publication and its published rollout epoch without marking production TDEE stale.

Observed lock sites covered by this order include Unified/V3/V4 publication, lifecycle invalidation, Active Energy canonical event resolution, Relative Muscle rebuild and invalidation, transient-water publication, three StrengthDiarySession row-lock paths, stepper reconciliation confirmation/rejection, and authorized Workout visibility activation. Strength/accounting status writers must use the same profile-first helper before any session row lock. No app writer may acquire the Relative Muscle lock before the profile lock.

## Canonical Unified inputs and writers

| Durable input read by `UnifiedExperimentalPhysiologySourceLoaderV1` | Writer/fencing surface |
| --- | --- |
| ModelEpisode boundaries and `initialGlycogenKg` | `model-episode.service.ts`, `model-episode.repository.ts`; profile lock and lifecycle invalidation in the episode transaction |
| DailyHealthData, Workout rows, visible-workout membership | `days/day.repository.ts`, `health.repository.ts`, stepper workout/reconciliation operations; source mutation and Active Energy/production invalidation are transactional |
| Workout/StrengthDiarySession matching and `hiddenFromHistory` | `training.repository.ts`, `stepper-reconciliation.service.ts`, `selection-v1-episode-ops.ts`; confirmation, visibility activation and rollback share profile serialization |
| StrengthDiarySession and its persisted accounting output | `training.repository.ts`; accounting candidate rechecks and publication invalidation |
| HealthActivityInterval, HealthSyncSnapshot, HeartRateSample, RestingHeartRateSample, SleepSegment | `health.repository.ts` and health synchronization/import service; production generation invalidation |
| DailyModelState energy and physical glycogen | episode recalculation/persisted-rebuild services; production generation publication gate |
| Active Energy canonical events and aliases | `active-energy-canonical.repository.ts`, `active-energy-invalidation.ts`, `active-energy-materialization.ts` |
| FatWeightShadowV1Result | fat-weight shadow service; Unified-only publication invalidation |
| ExperimentalGlycogenStateShadow / ExperimentalGlycogenAssociatedWaterShadow | glycogen shadow/repletion services; Unified-only invalidation; V4 ignores their numeric state |
| ExperimentalTransientExerciseWaterShadow | `experimental-transient-exercise-water-shadow.service.ts`; profile lock, token recheck and separate component accounting |
| Relative Muscle daily/cumulative persisted state | `relative-muscle-shadow-core.service.ts`; profile lock then Relative Muscle lock and Unified-only invalidation |
| Strength-derived persisted outputs and upstream session/exercise/set inputs | training/accounting repository; source fingerprint recheck and profile-first session locking |

The inventory is intentionally tied to the loader's select list. Any new loader input must add its writer to this table and add an invalidation/fencing test before it can be treated as current.

## Release cutover

The production Compose topology declares a local `db` service, but drain identity is not assumed from configuration alone. Before claiming writer drain, the release operator must prove the actual database is that local Compose PostgreSQL and map every nonlocal `pg_stat_activity.client_addr` to a concrete Compose container. Unknown addresses, a proxy/NAT hop, or an unmapped client block the release.

The safe sequence is: route maintenance and stop old app writers; verify writer drain and topology; owner-authorized migration; V3 postflight epoch `0`; deploy the exact SHA with non-serving traffic; explicit owner-authorized V4 target/epoch activation and replay through the migrator tool; verify exact coverage/currentness; then enable serving traffic. Ordinary deployment remains schema-preflight/build/recreate only and the serving cutover gate is read-only: it refuses to route Forecast V2 unless V4 is already current. Neither deploy nor app startup runs the migration, V3 publication, activation or replay.

This repository implementation does not execute any production operation. The release workflow must preserve owner authorization and perform the topology/writer-drain evidence check against the actual host.
