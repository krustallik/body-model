# Phase 20 — Garmin workout activity energy (physiology v6)

## Scope

Phase 20 brings recorded workout active energy into BodyCast daily activity
accounting under model version `bodycast-physiology-v6`. It defines how Garmin
(and Apple Health–compatible) active calories map onto BodyCast’s net-activity
contract, how strength and stair workouts interact with walking and work
overlap, and which behaviors are scientific convention versus engineering
policy.

Claim tags used throughout:

- **Scientific evidence** — peer-reviewed physiology or Compendium convention
- **Source/device semantics** — vendor definitions of calorie fields
- **Existing BodyCast model** — pre-v6 behavior
- **New BodyCast adaptation** — v6 physiology / sync contract
- **Engineering policy** — BodyCast product choices that are not scientific
  constants

## 1. Problem

BodyCast already modeled walking, occupational hybrid activity, and
duration-based strength MET. Users also sync recorded workouts (especially
Garmin Traditional Strength Training and Stair Climbing) with device active
calories. Until v6 those workout rows were stored but unused by expenditure,
while day-level `activeEnergyKcal` was stored and never entered TDEE.

Without an explicit contract, three errors are easy:

1. treating Garmin **activity calories** (gross during a recorded bout) as if
   they were **active calories** (movement beyond rest), or the reverse;
2. subtracting BodyCast RMR again from values that already exclude resting;
3. double-counting stair climbing against walking distance or work intervals.

## 2. Existing BodyCast behavior

**Classification: Existing BodyCast model.**

Pre-v6 daily net activity was:

```text
outside-work walking
+ occupational hybrid (Phase 7.1)
+ strength from strengthTrainingMinutes × DEFAULT_STRENGTH_MET (3.5)
```

Dynamic RMR, macro TEF, and adaptive thermogenesis composed TDEE as in
Phases 10–12. Personalization applied `activityCalibration` once to the summed
net Activity, then added `personalOffsetKcalPerDay`.

Day-level `activeEnergyKcal` was persisted on `DailyHealthData` and snapshots
for diagnostics and future use, but was **not** a TDEE input. `Workout` rows
(type, start/end, duration, legacy `energyKcal`) were synced and retained, yet
the simulator ignored them. Explicit strength/work time overlap was deferred in
Phase 7.1 because day-level strength minutes could not locate bout boundaries.

## 3. Garmin / device source semantics

**Classification: Source/device semantics.**

### Garmin calorie classes

Garmin Support documents three related labels
([Calorie Terminology](https://support.garmin.com/en-US/?faq=lkl4cwCLlK7ox362uGQEV7);
Viewing Calorie Data in Garmin Connect points to the same terminology):

| Label | Meaning |
| --- | --- |
| **Active Calories** | Energy from movement beyond rest |
| **Resting Calories** | Basal / basic physiological needs |
| **Total** | Resting + active |

Separately, **activity calories** on a *recorded activity* are the calories
attributed to that timer window. Garmin staff clarification on the Connect
forums (pointing readers back to Calorie Terminology) states that this activity
total includes **active + resting during the activity**, and therefore need not
equal the activity’s contribution to daily Active Calories
([forum thread](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/229874/no-calorie-burn-from-non-exercise-activity/1213290)).

BodyCast’s shortcut field `Trainingactivekcal` maps to Garmin **Active
Calories** for the workout, not the activity’s gross timer total. Verified
example arithmetic: resting 102 + active 562 = total 664 on the activity
summary, with the ingested training field carrying **562**.

**Implication:** BodyCast must **not** subtract dynamic RMR again from
`Trainingactivekcal` / `Workout.activeEnergyKcal`. That field is already the
movement-beyond-rest component.

Garmin does **not** publish the full proprietary calorie formula (Firstbeat /
device fusion). Device values are observations under vendor semantics, not
indirect calorimetry.

### Apple Health alignment

**Classification: Source/device semantics.**

`HKQuantityTypeIdentifierActiveEnergyBurned` excludes resting/basal energy;
basal energy is a separate quantity type
([Apple documentation](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned)).
This matches the BodyCast interpretation of workout `activeEnergyKcal` as
active-only energy when the payload originates from HealthKit-compatible sync.

## 4. Scientific evidence

**Classification: Scientific evidence.**

### Net versus gross activity energy

**Scientific evidence — principle.** Compendium MET values are multiples of a
standard resting metabolic rate (~1 kcal·kg⁻¹·h⁻¹). Gross activity cost during
a bout is therefore `MET × bodyMass × duration`. The portion of resting
metabolism that would have occurred anyway during that same clock time is not
“extra” activity. Separating **gross** from **net** (gross minus resting during
the bout) is the standard accounting principle for adding activity to RMR-based
daily expenditure without double-counting rest
(Herrmann et al. 2024 Compendium; Phase 10).

**Existing / New BodyCast adaptation — implementation.** BodyCast does **not**
subtract a fixed 1 MET population rest term. It subtracts the user’s current
**dynamic RMR** prorated over the bout:

```text
grossActivity = MET * currentPredictedWeightKg * durationHours
restingDuringActivity = currentDynamicRmrKcalPerDay / 24 * durationHours
netActivity = grossActivity - restingDuringActivity
```

That BodyCast-specific rest term is individualized (Hall tissue coefficients +
Mifflin baseline calibration from Phase 10). It applies only to **MET-derived**
components (walking, strength MET fallback, occupation). It must **not** be
applied again to device active calories that already exclude resting under
Garmin/Apple semantics.

Primary Compendium reference: Herrmann SD et al., *2024 Adult Compendium of
Physical Activities*,
https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/.

### Strength MET fallback only

Herrmann et al. 2024 list resistance training at **3.5 MET** (code **02054**)
among other resistance intensities. BodyCast’s `DEFAULT_STRENGTH_MET = 3.5` is
used **only** when a Traditional Strength Training event lacks device active
kcal but has duration.

Resistance energy expenditure is highly variable. Mitchell et al. (scoping
review) note measured MET-equivalent values roughly **3–8 MET** depending on
population and session style, with Compendium table values of 3.5 / 5.0 / 6.0
for resistance codes:
https://pmc.ncbi.nlm.nih.gov/articles/PMC11393209/.

### Wearable EE is not ground truth

O’Driscoll et al., *How well do activity monitors estimate energy expenditure?
A systematic review and meta-analysis of the validity of current technologies*
(Br J Sports Med 2020; conference abstract 2018) found heterogeneous accuracy
and a pooled tendency to underestimate criterion EE
(https://doi.org/10.1136/bjsports-2018-099643). BodyCast therefore treats
device active kcal as a **structured observation** under vendor semantics, not
as a calorimetry substitute.

### Stair METs exist; BodyCast still refuses invention

The Adult Compendium includes stair-related codes in the **17130–17138** range.
**Classification: New BodyCast adaptation / Engineering policy.** BodyCast does
**not** invent a Stair Climbing MET when device active kcal is missing; stair
without active kcal contributes **0** workout kcal (prefer undercount over
fabricated intensity).

## 5. New v6 activity accounting

**Classification: New BodyCast adaptation.**

Model version: `bodycast-physiology-v6`.

Persistence:

- Additive column `Workout.activeEnergyKcal` (device active energy).
- Legacy `Workout.energyKcal` is retained and **not** reinterpreted as active
  or gross; v6 expenditure reads `activeEnergyKcal` only.
- Day-level `activeEnergyKcal` remains stored and remains **out of TDEE**.

Composition (conceptual):

```text
net Activity =
  outside-work walking (after stair overlap subtraction)
  + occupational hybrid
  + workout-aware strength / workout block
```

where the workout-aware block resolves each explicit workout event, then
applies the strength-precedence rules in §6. `activityCalibration` still
multiplies the **summed** net Activity once.

Calendar ownership (**Engineering policy**):

- A workout is attributed to the local calendar date of `startAt`.
- Sync replaces workouts only for the synced day.
- Workouts in the payload whose local `startAt` date differs from the synced
  day are dropped for that sync (conservative; no silent reassignment).

## 6. Strength precedence

**Classification: New BodyCast adaptation.**

Per Traditional Strength Training event:

1. **Device active kcal** if present and positive — use as-is (no RMR
   subtraction).
2. Else **duration × DEFAULT_STRENGTH_MET (3.5)** with the existing Phase 10
   net-MET helper (gross − individualized rest).
3. Day-level `strengthTrainingMinutes` is used only when **no** explicit
   strength workouts exist for the day.

If explicit strength workouts exist, legacy day minutes are suppressed to avoid
double counting the same bout as both a workout and an aggregate. Non-strength
workouts (e.g. stair with device kcal) may still add on top of legacy strength
minutes when no explicit strength events are present.

## 7. Stair anti-double-count

**Classification: New BodyCast adaptation** (mechanics) with engineering
thresholds in §8–§9.

Stair Climbing is a first-class Garmin activity type in BodyCast
(`"Stair Climbing"`). Accounting rules:

1. Energy: **device `activeEnergyKcal` only**; never invent Stair MET.
2. Walking: reconstruct cumulative walking distance overlapping the stair
   window from sync snapshots; subtract that overlap from outside-work walking
   distance before walking MET.
3. If overlap cannot be reconstructed safely, keep walking distance unchanged
   and still add stair device kcal when present (prefer documented under-
   subtraction of walking over inventing stair MET).
4. Missing stair active kcal → 0 stair workout kcal and no invented intensity.

## 8. 10-minute snapshot policy

**Classification: Engineering policy.**

Phase 7.1 used a default **60-minute** maximum gap for work-boundary
reconstruction. Stair overlap uses a stricter constant:

```text
STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES = 10
```

Before the stair `startAt` and after the stair `endAt`, BodyCast requires a
snapshot within ≤10 minutes. Wider gaps yield diagnostics
(`before-gap-too-large` / `after-gap-too-large` / missing snapshot) and **no**
walking-distance claim for that bout. The tighter window reduces interpolated
or loosely nearest-neighbor distance attribution during short stair sessions.

This 10-minute bound is not a physiological constant; it is a BodyCast
engineering choice for high-confidence overlap only.

**Conservative approximation caveat.** Bracketing snapshots may sit up to 10
minutes before the workout starts and up to 10 minutes after it ends. Walking
distance accumulated in those adjacent margins can therefore be included in the
claimed stair overlap even though it occurred immediately before/after the
recorded bout. BodyCast accepts this as a **conservative** walking subtraction
(prefer removing slightly more walking MET than double-counting stair vs
walking) rather than interpolating inside the bout without evidence.

## 9. Work / stepper dedup

**Classification: New BodyCast adaptation / Engineering policy.**

Overlap reconstruction builds chronological walking segments between consecutive
snapshots. Segments are:

- **excluded** if already attributed to a work interval (Phase 7.1 occupational
  ownership);
- **claimed at most once** across stair windows (segment dedup), so overlapping
  or adjacent stair recordings cannot subtract the same distance twice;
- left invalid on counter resets / null distances without aborting later
  segments.

Net effect: stair device kcal is additive to Activity; overlapping walking
distance is removed from the walking MET path when evidence is strong enough;
work-owned distance is never also stair-owned.

## 10. Missing-data behavior

**Classification: New BodyCast adaptation.**

| Situation | Behavior |
| --- | --- |
| Strength event with active kcal | Use device kcal |
| Strength event without active kcal, with duration | MET 3.5 net fallback |
| Strength event without kcal and without duration | 0 for that event |
| Explicit strength workouts present | Ignore day `strengthTrainingMinutes` |
| No explicit strength workouts | Keep legacy minutes path |
| Stair without active kcal | 0 stair kcal; no MET invention |
| Stair with active kcal but bad snapshots | Add stair kcal; do not subtract walking |
| Day `activeEnergyKcal` only | Still unused in TDEE |
| `workoutActivity` omitted | Preserve pre-v6 expenditure path (v5 episodes) |

Unknown/null components continue to make complete TDEE `null` where the
existing one-day contract requires known zeros versus unknown.

## 11. Device-error limitations

**Classification: Scientific evidence** (wearable validity) **and Source/device
semantics** (opaque formulas).

- Garmin / HealthKit active calories can bias high or low by activity type;
  meta-analytic evidence supports treating wearables as imperfect estimators
  (O’Driscoll et al., doi:10.1136/bjsports-2018-099643).
- Proprietary algorithms are unpublished; BodyCast cannot correct vendor bias
  with a second RMR model.
- Heart-rate dropout, incorrect user profile weight, TrueUp multi-device
  reconciliation, and revised Apple Health totals can change historical active
  energy after the fact; snapshots record what was synced, not a locked
  physiological truth.
- Strength MET fallback inherits Compendium average-cost uncertainty
  (Mitchell et al. PMC11393209; Herrmann et al. PMC10818145).

## 12. Validation matrix

**Classification: Engineering policy** (test plan), covering the v6 contract.

| Case | Expectation |
| --- | --- |
| Garmin strength active kcal present | Used as-is; no second RMR subtraction |
| Strength active kcal missing, duration present | Net MET 3.5 fallback |
| Explicit strength + day strength minutes | Minutes suppressed |
| Stair with active kcal + tight snapshots | Stair kcal added; overlapping walk km removed |
| Stair with active kcal + gap >10 min | Stair kcal added; no walk subtraction |
| Stair without active kcal | 0 stair kcal; no MET |
| Stair overlapping work-owned segment | Segment not double-claimed |
| Two stairs claiming same segment | Dedup; second claim skipped |
| Day `activeEnergyKcal` only | Unchanged TDEE vs omitting it |
| v5 episode / `workoutActivity` omitted | Bit-identical to pre-change path |
| Cross-day workout in sync payload | Dropped for that day |
| Sync replace | Prior workouts for synced day replaced atomically |
| `activityCalibration` | Applied once to summed Activity including workouts |
| Randomized invariants | No NaN; nonnegative remaining walk; no double segment claims |

Automated coverage lives in `tests/workout-energy.test.ts`,
`tests/stair-walking-overlap.test.ts`,
`tests/model-workout-aware-expenditure.test.ts`,
`tests/workout-activity-invariants.test.ts`,
`tests/workout-activity-v6-regression.test.ts`, and
`tests/expand-training-workouts.test.ts`.

## 13. Results

Synthetic / unit validation completed in the Phase 20 implementation pass
(2026-09-16). Production migration was **not** applied from the agent.

| Item | Status |
| --- | --- |
| Unit / invariant suite | 1364/1364 passed (117 files; includes mixed-case type canonicalization) |
| Integration suite (local Docker Postgres @ localhost:5432) | 31/31 passed, 0 skipped |
| Targeted `validate:workout-activity-v6` | 7/7 passed |
| Typecheck / ESLint / production build | green |
| Prisma schema validate | green |
| Local additive migrate `20260916120000_add_workout_active_energy_kcal` | applied; `migrate status` up to date |
| Live Garmin day spot-checks | deferred to post-deploy smoke |
| Residual known mismatches vs Connect UI | none in synthetic/integration fixtures |

## 14. Known limitations

- Device active kcal remains a vendor estimate, not calorimetry.
- Stair without device kcal is silently zero rather than Compendium-estimated.
- Overlap reconstruction depends on sync cadence; sparse syncs skip walking
  subtraction even when stairs occurred.
- Overnight / cross-midnight stair windows inherit conservative calendar
  ownership by `startAt` only.
- Legacy `energyKcal` is not mapped; payloads that only populate gross activity
  calories without an active field under-contribute until the shortcut sends
  active kcal.
- Strength/work time overlap for MET-fallback strength bouts is still not a
  full interval intersection model beyond stair–walking–work segment rules.
- Personalization cannot fully separate food error, RMR error, and wearable
  bias; workout inclusion changes the Activity residual that calibration
  absorbs.

## 15. Versioning rationale

**Classification: New BodyCast adaptation / Engineering policy.**

`bodycast-physiology-v6` is required because workout-aware Activity changes
historical day energy for the same stored inputs whenever workouts are
supplied. Episodes pinned to v5 must omit `workoutActivity` (or equivalent)
so DynamicDailyExpenditure matches the pre-change path. Additive
`Workout.activeEnergyKcal` avoids reinterpretation of legacy `energyKcal`,
keeping old rows semantically stable while new syncs populate the active field.

Bump triggers for this phase: first use of device workout active energy in
TDEE, strength precedence over day minutes, and stair walking anti-double-count
with the 10-minute snapshot policy.

## Sources

### Source / device

- Garmin Customer Support, *Calorie Terminology*:
  https://support.garmin.com/en-US/?faq=lkl4cwCLlK7ox362uGQEV7
- Garmin Customer Support, *Viewing Calorie Data in Garmin Connect* (cross-links
  Calorie Terminology; Active / Resting / Activity classifications)
- Garmin Connect forums staff clarification on Active vs Resting vs Activity
  calories:
  https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/229874/no-calorie-burn-from-non-exercise-activity/1213290
- Apple Developer Documentation,
  `HKQuantityTypeIdentifierActiveEnergyBurned`:
  https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned

### Scientific

- Herrmann SD et al., *2024 Adult Compendium of Physical Activities*:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/
- Mitchell L et al., *Methods to Assess Energy Expenditure of Resistance
  Exercise: A Systematic Scoping Review*:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11393209/
- O’Driscoll R et al., *How well do activity monitors estimate energy
  expenditure? A systematic review and meta-analysis of the validity of current
  technologies*, Br J Sports Med:
  https://doi.org/10.1136/bjsports-2018-099643
  (related Nutrition Society abstract:
  https://doi.org/10.1017/s0029665118001532)

### Prior BodyCast phases

- Phase 7.1 — sync snapshots, work intervals, occupational overlap
- Phase 10 — dynamic RMR and net MET activity
