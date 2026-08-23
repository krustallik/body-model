# Phase 7.1: sync snapshots, work intervals, and occupational overlap

## Why immutable snapshots are required

`DailyHealthData` remains the latest daily state and keeps its existing UPSERT
semantics. That representation cannot reconstruct intraday activity because each
sync overwrites the previous cumulative total. `HealthSyncSnapshot` therefore
appends one immutable row inside the same transaction as every successful UPSERT.
Deleting a mutable daily-state row sets the snapshot relation to `null` rather
than deleting its history.

Snapshot `steps` and `walkingDistanceKm` mean cumulative totals for the snapshot's
calendar day at approximately its timestamp. They may be `null`; explicit zero is
a real observation. Snapshots are never required to be monotonic because Apple
Health can revise totals retroactively.

`receivedAt` is the server receipt instant in UTC. An optional iPhone-generated
`syncedAt` is stored separately and used for reconstruction when present. It is
never invented. The original day object remains in snapshot `rawPayload`.

## Timezone contract

The single-user default is `Europe/Bratislava`, which is also correct for Košice.
This is an IANA timezone, not a fixed `UTC+2` offset:

- `2026-08-23 10:00` in Košice is `08:00Z` under CEST;
- `2026-01-23 10:00` is `09:00Z` under CET.

Work intervals are entered as local `date`, `startTime`, and `endTime`, then stored
as UTC instants together with the originating IANA zone. Nonexistent spring-DST
times and ambiguous autumn-DST times are rejected. Server-local timezone is never
used. Phase 7.1 rejects overnight intervals explicitly; they are not silently
assigned to one calendar day.

## Boundary reconstruction

The default maximum boundary gap is 45 minutes and is configurable by callers.
For each cumulative metric independently:

1. use an exact snapshot at the boundary;
2. otherwise linearly interpolate when snapshots exist on both sides and each is
   within the maximum gap;
3. otherwise use the nearest snapshot within the maximum gap;
4. otherwise return `insufficient-data` or `gap-too-large`.

Linear interpolation is an explicitly labelled engineering approximation. It
assumes cumulative activity accumulated uniformly between two nearby samples; it
is not treated as a direct measurement. Results expose method, source timestamps,
and gap duration rather than an unjustified confidence percentage.

If a surrounding or interval counter decreases, reconstruction returns
`counter-decreased`. Negative values are not clamped. Work intervals are sorted
and cannot overlap, enforced both by application validation and a PostgreSQL GiST
exclusion constraint.

## Golden example

```text
08:05  1200 steps  0.8 km
16:05  4700 steps  3.3 km
22:00  7200 steps  5.1 km
work interval 08:00–16:00
```

Both boundaries use the nearest snapshot with a five-minute gap:

```text
work steps    = 4700 - 1200 = 3500
work distance = 3.3 - 0.8   = 2.5 km
outside work  = 5.1 - 2.5   = 2.6 km
```

If summed work distance exceeds the final daily distance, outside-work distance
is unavailable with a diagnostic; it is never clamped to zero.

## Occupational categories

The small category set maps directly to the 2024 Adult Compendium occupation
entries rather than inventing new intensities:

| Identifier | MET | Code | Examples |
| --- | ---: | --- | --- |
| `standingLight` | 1.8 | 11600 | store clerk, bartending, filing, light assembly |
| `manualLight` | 2.8 | 11475 | general light manual or unskilled work |
| `standingLightModerate` | 3.3 | 11610 | packing, stocking, patient care, auto repair |
| `manualModerate` | 4.5 | 11476 | general moderate manual or unskilled work |

Net occupational expenditure reuses BodyCast's individualized-resting approach:

```text
gross = MET * weightKg * durationHours
resting during work = RMR / 24 * durationHours
net occupation = gross - resting during work
```

Standard Compendium METs describe category averages, not personal measurements;
the selected category remains a user input and is not automatically changed from
step counts.

## Overlap and walking-speed policy

Daily activity is:

```text
occupational activity
+ outside-work walking activity
+ strength activity
```

It is never occupation plus all daily walking, because that would count walking
inside work twice. Estimated work steps/distance remain available for diagnostics.

Daily average walking speed is not interval-specific. Phase 7.1 uses it only as
an explicit approximation for outside-work walking kcal; occupational MET absorbs
all walking inside work. Strength remains separately counted. Workout instants are
already preserved, but exact strength/work overlap is deferred because the current
daily strength aggregate does not reliably identify all overlap cases.

## Persistence and future UI contract

New persistence models:

- `HealthSyncSnapshot`: immutable cumulative sync history related to its daily row;
- `WorkInterval`: timezone-aware manual work interval with occupational category.

APIs expose list/create/update/delete for work intervals. A future UI can submit
local start/end/category and display estimated work steps, distance, boundary
method, source timestamps, gap minutes, and diagnostics. No UI is added here.

## Sources

- Herrmann et al., *2024 Adult Compendium of Physical Activities: A third update
  of the energy costs of human activities*,
  [Journal of Sport and Health Science / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/).
- [2024 Adult Compendium — Occupation table](https://pacompendium.com/occupation/),
  including codes 11475, 11476, 11600, and 11610.
- Hall et al., *Quantification of the effect of energy imbalance on bodyweight*,
  [NIDDK/Lancet web appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf).
