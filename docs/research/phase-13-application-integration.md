# Phase 13 — Historical application integration

## Scope

Phase 13 connects PostgreSQL history to the existing pure deterministic model.
It persists reconstructed historical state only. It does not create forecasts,
future dates, confidence intervals, target solving, or Monte Carlo output.

Scientific equations remain in `src/model`; Prisma and application policy live
under `src/modules/model-episodes`.

## Evidence and policy boundary

- Hall, *Estimating changes in free-living energy intake and its confidence
  interval*, supports using longitudinal daily weight over periods longer than
  28 days rather than interpreting a few scale observations as energy balance:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/
- Sen, *Estimates of the Regression Coefficient Based on Kendall's Tau*, defines
  the median pairwise-slope estimator used here to protect maintenance trend
  detection from isolated scale values:
  https://doi.org/10.1080/01621459.1968.10480934
- Phase 5's BIA evidence and initialization policy remain unchanged; recent
  paired weight/BIA observations are selected and aggregated by the existing
  pure primitives.

The exact 28/90-day windows, counts, and `0.25%/week` stability limit are
transparent BodyCast engineering policy, not clinical definitions or learned
population parameters.

## Database architecture

`ModelEpisode` is an auditable period with frozen baseline and initialization
assumptions. It stores:

- local start date, timezone, and centralized `modelVersion`;
- initial body compartments, filter state, Dynamic RMR alignment, AT and filter
  constants;
- frozen energy and carbohydrate baselines with derivation provenance;
- explicit ECF policy;
- current accepted personalization and calibration diagnostics;
- latest successfully modeled date.

`DailyModelState` stores a useful diagnostic subset for each episode/date:
status and source quality, end compartments, energy components, tissue and
glycogen changes, and filtered weight. Incomplete and blocked dates are
persisted with nullable calculations rather than fabricated values.

`(episodeId, date)` is unique. A PostgreSQL partial unique index permits at most
one `active = true` episode, while inactive episodes and daily history remain
auditable. Daily rows cascade only when their owning episode is deliberately
deleted.

## Episode lifecycle and initialization

`initializeNewModelEpisode` defaults to yesterday in
`Europe/Bratislava`, calculated from an injected/current instant through the
existing timezone conversion. An explicit start date must also be a completed
local day.

Initialization:

1. loads the singleton profile and 90 days ending at the selected start date;
2. derives a defensible frozen maintenance baseline;
3. selects up to seven paired weight/BIA observations from the preceding 14
   days and applies the existing median/MAD estimator;
4. initializes observed fat, ECF, glycogen, latent LeanTissue, Mifflin RMR,
   Dynamic RMR alignment, AT, and the weight filter using existing model
   primitives;
5. atomically deactivates the old episode and creates the new active episode.

Failure is explicit: `profile-missing`, `insufficient-baseline-data`,
`insufficient-weight-bia`, `invalid-initial-state`, or
`start-date-not-complete`. Existing episodes are not modified when preparation
fails.

## Frozen maintenance baseline

Candidate 28-calendar-day windows are examined newest first inside a 90-day
lookback. A window requires:

```text
complete calories + protein + fat + carbs days >= 21
valid weight observations >= 14
weight observation span >= 21 days
```

Typical intake is:

```text
baselineEnergyIntake = median(complete daily calories)
baselineCarbIntakeG  = median(complete daily carbohydrate grams)
```

The weight trend is the median of every pairwise weight slope (Theil–Sen),
converted to percent of median weight per week. A candidate is rejected when:

```text
abs(weightTrendPercentPerWeek) > 0.25
```

This catches coherent active loss/gain while resisting an isolated scale
reading. A zero nutrition observation remains an observation; missing remains
missing. The selected window, counts, trend, threshold, and method are persisted.
Baseline values never roll forward during recalculation.

## Historical input construction

The builder enumerates every local calendar label from episode start through
the newest completed source date. It never skips a missing date. Each day gets
one source status:

- `complete`;
- `missing-nutrition`;
- `missing-activity`;
- `work-reconstruction-unavailable`.

Missing metrics remain `null`. Explicit strength/activity zero remains zero.
Measured weight is optional and contributes no likelihood when absent.

Work walking is reconstructed with the existing snapshot-boundary engine and
its 45-minute maximum gap. Only outside-work walking enters the walking term:

```text
daily walking 5.1 km
- reconstructed work walking 2.5 km
= simulator outside-work walking 2.6 km
```

Multiple non-overlapping WorkIntervals are passed as a list. The pure
expenditure composer applies the existing individualized MET calculation to
each interval and sums it. This is a contract extension, not a change to MET,
RMR subtraction, or any physiological coefficient.

With `hold-ecf`, sodium remains `null`; it is never replaced by implicit zero.

## Current-day and incomplete-day policy

The current Bratislava local day is excluded from initialization defaults,
calibration, simulation, and persisted history. Repeated syncs during a partial
day therefore cannot be interpreted as a complete-day deficit.

When a historical calendar date is incomplete, the simulator persists that
date as `incomplete` and later dates as `blocked`, following the Phase 11 state
contract. The application does not interpolate nutrition or Activity and does
not jump the state across the gap.

## Two-pass calibration and recalculation

One recalculation uses one serializable PostgreSQL transaction and one frozen
episode snapshot:

1. load the episode and completed historical sources;
2. build consecutive model inputs;
3. call the existing robust Phase 12/12.1 calibrator;
4. accept exactly the parameters it returns (`insufficient-history`,
   `invalid-history`, and `defaults-retained` already return defaults);
5. rerun the whole episode with that one parameter set;
6. UPSERT daily rows, remove stale rows, then update episode parameters,
   diagnostics, and latest modeled date.

No early/late mixture of default and calibrated parameters is persisted.
Because the model is stateful, any historical edit causes a full episode
rebuild. Incremental dependency tracking is intentionally deferred.

The transaction prevents partial state history or episode metadata. A real
PostgreSQL trigger-failure integration test verifies that earlier UPSERTs and
the episode update roll back together. Repeated unchanged recalculation updates
the same unique rows and produces identical modeled values without duplicates.

## API and data minimization

The three dynamic Route Handlers use the existing constant-time `x-api-key`
convention:

- `POST /api/v1/model/recalculate`;
- `GET /api/v1/model/status`;
- `GET /api/v1/model/history` with episode/date range/limit/offset.

Status and history return explicit DTOs rather than raw episode JSON or health
payloads. Errors do not expose stack traces. No service logs raw health,
nutrition history, API keys, or complete latent state structures.

## Versioning and operational limitations

The centralized version is `bodycast-physiology-v1`. Ordinary source-data
recalculation keeps it unchanged. A future incompatible scientific state or
equation change must introduce a new version and explicit migration or episode
reinitialization policy.

Limitations:

- the maintenance detector cannot prove energy balance or correct systematic
  intake under-reporting;
- a stable older window may still represent a personally atypical period;
- snapshot gaps make work walking unavailable rather than guessed;
- one incomplete day blocks all later state until source data is repaired;
- serializable full-history recalculation favors correctness over throughput;
- no forecast or causal interpretation is provided.
