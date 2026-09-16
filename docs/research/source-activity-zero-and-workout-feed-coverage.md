# Source measurement zero and workout-feed coverage semantics

Engineering / source-contract notes (not a physiology phase).

## Nutrition

For `caloriesKcal`, `proteinG`, `fatG`, `carbsG`:

| Received | Meaning |
| --- | --- |
| positive | observed intake |
| `0` | not tracked → stored/normalized as `null` |
| absent / `null` | missing |

Existing nutrition gap bridge (`maxBridgeDays = 2`) and recovery paths are unchanged.

## Activity walking / strength scalars

Phone always sends walking. Received `0` is an observed zero.

| Field | Received `0` | Absent |
| --- | --- | --- |
| `walkingDistanceKm` | observed 0 km | unknown |
| `averageWalkingSpeedKmh` | observed 0 (rare) | unknown; required only if walking distance > 0 |
| `strengthTrainingMinutes` | observed 0 minutes | unknown unless workout-feed coverage says otherwise |
| `steps`, `activeEnergyKcal` | observed 0 | unknown |

`normalizeDailyMeasurements` therefore **preserves** activity zeros and only collapses nutrition/weight/body-fat zeros.

## Workout latest-3 contract

The Shortcut may send up to three most recent workout events across calendar days.

At sync of observation day `D`:

1. Persist only workouts whose local `startAt` date equals `D`.
2. Persist `DailyHealthData.workoutFeedObserved`:
   - `true` — `workouts` array present (including `[]`) or usable training-field feed
   - `false` — feed absent or structurally invalid
   - `null` — legacy rows written before this column

### Confirmed rest day

`workoutFeedObserved = true` and no Traditional Strength Training on `D`
→ strength component is confirmed `0` for v6 even if legacy `strengthTrainingMinutes` is null.
→ physiological transition continues.

### Unknown feed

`workoutFeedObserved` is `false` or `null` and legacy strength is null
→ keep previous unknown/incomplete activity semantics.
→ do **not** invent a rest day.

### Historical safety

Coverage is attached to the synced calendar day at sync time. A later sync's latest-3 payload must never be used to conclude that an older day had no workout. Recalculation reads the persisted flag for each day; it does not re-interpret a modern feed.

### Parser / malformed feed

Structurally invalid workout feed → `workoutFeedObserved = false` (unknown), never confirmed zero.
One malformed event among otherwise valid structured events does not remove array presence; same-day valid events still persist. Training-field catastrophic mismatches (missing paired fields / wrong line counts) are unavailable.

## Version notes

- **v6:** confirmed-zero strength from observed feed applies.
- **v5 / legacy rows:** `workoutFeedObserved` null does not silently reinterpret historical null strength as rest. Observed stored `0` strength (after zero-preservation) remains valid complete activity.

## Work reconstruction follow-up

If work intervals exist but snapshots cannot reconstruct work walking, `outsideWorkWalkingDistanceKm` may still become null and block continuity even when daily walking total is known. That case is unchanged here and remains a separate design follow-up.
