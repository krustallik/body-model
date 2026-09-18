# Physiology v7 persisted rebuild lifecycle

Stage 9B stores v7 daily results as a derived cache. `DailyHealthData`, workouts,
training diary records, and other durable inputs remain source truth. Deleting
the v7 cache is safe because the normal Stage 9A runtime rebuilds it.

`PhysiologyV7DailyResult` stores the complete discriminated v7 result JSON plus
source, predecessor, and result fingerprints and the exact runtime versions.
Known, carried-forward, and unavailable compartments therefore survive without
flattening unavailable values into zero. Observed scale weight and reconstructed
model mass remain separate fields in the result contract.

`PhysiologyV7Lifecycle.staleFromDate` is the earliest invalid date. Mutations
merge with `min(existing, affectedDate)` and increment a monotonic generation.
Rows before the watermark remain current; existing rows on or after it are
physically retained but reads label them stale. Relevant health, workout, and
training-table writes invoke PostgreSQL triggers, so source write and
invalidation commit atomically. HR, resting HR, sleep, profile values, equipment
configuration, and presentation-only catalog renames do not invalidate because
the current v7 scientific fingerprint does not consume them.

The invalidation matrix is: daily body/nutrition/activity/feed changes from the
authoritative daily date; workout creation/deletion or scientific field/date
changes from the minimum old/new related daily date; sync snapshot step/timing
changes from its daily date; and diary session, exercise, set, RIR, mapping, or
workout-link changes from the minimum affected training date. HR, resting HR,
sleep, device kcal, raw payload, external IDs, profile fields, and cosmetic
catalog names are currently context/presentation-only and do not invalidate.

`rebuildAndPersistPhysiologyForProfileRangeV7` uses the existing Stage 9A source
loader and runtime. It takes a generation snapshot, rebuilds from the earliest
stale day using a compatible current predecessor, then promotes all results in
one transaction. A per-profile PostgreSQL advisory lock serializes promotion.
Generation compare-and-swap makes a concurrent source mutation win. Failure or
process termination before promotion leaves the watermark intact; retry is
idempotent through the `(profileId,date)` unique key.

Fingerprints exclude row IDs, operational timestamps, and JSON key ordering.
Version incompatibility marks the cache stale for latest-model rebuild. No old
v5/v6 `DailyModelState` value is translated into v7 state.
