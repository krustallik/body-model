# Long unknown intervals and state continuity (Phase 13.2)

## Problem statement

BodyCast is a mechanistic hidden-state model. Fat mass, lean tissue, glycogen,
extracellular fluid, adaptive thermogenesis, and the weight-filter state are not
directly observed each day. Their deterministic transition depends on recorded
nutrition and activity. When those drivers are absent for a vacation-length
interval, there is no scientifically identified single transition to compute.

The correct Phase 13.2 state of knowledge is:

```text
resolved physiological state
→ unresolved transition interval
→ real post-gap observations awaiting recovery
```

It is not a held-constant trajectory, a zero-intake trajectory, or an automatic
new episode.

## Focused evidence review

- Longitudinal missing-data reviews warn that missingness can bias inference and
  reduce precision, and that the appropriate method depends on the variables,
  timing, analysis model, and missingness assumptions. Multiple imputation
  represents missing-value uncertainty by analyzing several predictive draws,
  rather than declaring one completed history to be observed
  ([Wijesuriya et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC11755704/),
  [Ibrahim and Molenberghs](https://pmc.ncbi.nlm.nih.gov/articles/PMC3016756/)).
- A single imputation erases the distinction between observed and guessed
  values and generally overstates precision
  ([Missing Data in Longitudinal Trials](https://pmc.ncbi.nlm.nih.gov/articles/PMC2722118/)).
  This supports a strict bound on BodyCast's deterministic continuity bridge.
- State-space terminology distinguishes one-step prediction using prior
  observations, filtering using observations through the current time, and
  smoothing using later observations as well
  ([Mixed-Effects State Space Models](https://pmc.ncbi.nlm.nih.gov/articles/PMC3507995/)).
  Rauch–Tung–Striebel-style smoothing explicitly conditions earlier hidden
  states on the whole observation set
  ([VISTA-SSM](https://pmc.ncbi.nlm.nih.gov/articles/PMC12344451/)).
- In a Kalman prediction, covariance propagates through the transition and adds
  process covariance before an observation update. Repeated unobserved
  prediction steps therefore normally increase state uncertainty unless a
  degenerate zero-process-noise assumption is imposed. BodyCast must not invent
  that assumption for an unknown vacation.
- Particle filtering / Sequential Monte Carlo represents nonlinear hidden-state
  posteriors with weighted candidate trajectories and updates them when
  observations arrive
  ([Particle Filters tutorial](https://pmc.ncbi.nlm.nih.gov/articles/PMC7826670/),
  [particle-filter survey](https://pmc.ncbi.nlm.nih.gov/articles/PMC5750742/)).
  This is relevant to future Phase 14A, not an algorithm to implement here.
- The Hall/NIDDK model is a mechanistic dynamic system in which energy intake,
  activity, body composition, glycogen, and adaptive thermogenesis affect the
  trajectory; it does not justify evolving the model through unknown forcing as
  though it were known
  ([NIDDK model research](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research),
  [Hall model appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf)).

## Answers to the research questions

### Missing-interval semantics

Deterministically filling a long interval is not defensible without strong and
visible assumptions about nutrition, activity, and missingness. A single path
would hide uncertainty and could be badly wrong during travel, illness, unusual
food intake, or changed activity. Phase 13.2 therefore stops deterministic
state propagation at the first day whose transition cannot be evaluated.

### Prediction, filtering, and smoothing

- **Prediction** estimates a state from the prior state and transition model,
  before using the current observation.
- **Filtering** updates the current state using observations available through
  that date.
- **Smoothing** estimates an earlier hidden state using observations that also
  occur later.

Post-vacation weights and inputs can constrain which gap trajectories are
plausible, so they must be retained. Applying them requires a distribution over
candidate trajectories and an observation likelihood; Phase 13.2 exposes the
necessary data but does not smooth or recover a state.

### Short deterministic bridge versus unlimited single imputation

Phase 13.1 permits at most two missing nutrition days, requires coherent donor
evidence, labels the result as imputed, and propagates dependency provenance.
This is a bounded product-continuity policy, not a claim that the donor values
were observed. Extending the same single path to 7, 30, or 90 days would make
the uncertainty grow while the stored result remained falsely precise.

### State uncertainty

When forcing and observations are absent, more transition histories become
compatible with the last resolved state. In state-space terms, process
uncertainty accumulates between observation updates. Phase 14A should represent
this growth explicitly; Phase 13.2 records duration and anchors without choosing
a distribution or numeric variance-growth law.

### Episode and personalization continuity

A temporary observation gap does not invalidate the frozen baseline, initial
provenance, pre-gap latent state, or previously learned conservative parameters.
Starting an unrelated episode would discard information rather than express
uncertainty. The same `ModelEpisode` remains active. Calibration is allowed only
on the resolved deterministic prefix and never treats post-gap observations as
continuously connected until recovery exists.

## Existing behavior before Phase 13.2

The input builder already enumerated consecutive Europe/Bratislava calendar
dates, including dates with no `DailyHealthData` row. Phase 13.1 bridged eligible
one- and two-day nutrition gaps. For an unbridgeable three-day or seven-day gap:

1. the first missing-transition day was passed to the strict simulator and
   returned `incomplete`;
2. every later date, including dates with real resumed observations, was emitted
   as `blocked`;
3. nullable state columns prevented fabricated compartments, but a
   `DailyModelState` placeholder existed for every later date;
4. the episode remained active and source observations remained in their source
   tables, but APIs described the valid vacation condition as generic blocked
   history rather than first-class unresolved continuity.

Missing weight alone already caused a Kalman prediction-only day and did not
block physiological simulation.

## Transition-input classification

The classifier follows the strict simulator's actual requirements:

| Input | Transition rule |
| --- | --- |
| Calories, protein, fat, carbs | All required after Phase 13.1 bridging |
| Outside-work walking distance | Required; missing is not zero |
| Average walking speed | Required only when walking distance is nonzero |
| Strength duration | Required; explicit zero remains valid |
| Occupational activity | Supplied interval list must have duration and category when duration is positive; an empty list is the existing explicit no-work representation on an otherwise tracked activity day |
| Work walking reconstruction | Missing reconstruction uses the labeled category fallback where possible; it does not itself fabricate walking |
| Measured weight | Optional observation; missing means prediction-only, not unknown transition |
| Body fat | Used for episode initialization, not required daily |
| Sodium | Required only for `full` ECF policy; `hold-ecf` and `assume-unchanged-sodium` retain their explicit policies |

Absence of `WorkInterval` alone does not create a gap. On a wholly absent day,
walking and strength are also unknown, so the transition remains unavailable.

## Architecture options

| Option | Scientific semantics | Persistence/auditability | Backfill and Phase 14A | Decision |
| --- | --- | --- | --- | --- |
| Dedicated `ModelUnknownInterval` | Separates unknown transition from latent state rows | Explicit open/closed/multiple intervals and compact API | Re-derived and synchronized from current inputs; direct anchor/gap lookup | Chosen |
| Status-only `DailyModelState` rows | Nullable state can avoid fabricated values, but rows after the gap resemble model outputs | One row per unknown/post-gap date and overlapping status vocabulary | Recovery must disentangle placeholders from physiological history | Rejected |
| Derive only on every API request | Scientifically coherent | No durable audit object; repeated computation and harder transactional reporting | Backfill is simple but Phase 14A lookup and atomic recalc diagnostics are weaker | Rejected |
| Hold state or auto-create episode | Falsely precise or discards prior information | Superficially simple | Makes principled recovery harder | Rejected |

## Chosen representation

`ModelUnknownInterval` belongs to one episode and stores:

```text
startDate                 first unavailable transition date
lastUnknownDate           last currently detected unavailable date
endDate                   last unavailable date when closed; null when open
anchorDate                last deterministic state date before the first unresolved continuity break
firstPostGapObservationDate
postGapObservedDayCount
missingTransitionFields   union of explicit causes in the interval
recoveryRequired          true in Phase 13.2
```

The unique key `(episodeId, startDate)` supports multiple intervals. Every
recalculation re-derives intervals from current source data, upserts current
intervals, and deletes stale ones in the same serializable transaction. Thus
backfill can shrink, move, or remove an interval automatically.

`DailyModelState` contains only the resolved deterministic prefix. There are no
state rows inside a gap or after its unresolved transition. The last complete
row is the immutable recovery anchor; it is not copied forward.

An interval is **closed** when transition-evaluable days occur after its missing
run; `endDate` is then the last missing-transition date. It is **open** when the
run reaches the latest completed local calendar day; `endDate` is null and
`lastUnknownDate` records how far detection currently extends. Current unfinished
Europe/Bratislava day remains excluded.

Real post-gap values remain in `DailyHealthData`, snapshots, and WorkIntervals.
The history API returns compact observation records awaiting recovery alongside
the gap metadata. No recovered compartment state is produced.

## API vocabulary

The compact continuity state is:

```text
resolved           no unknown intervals
awaiting-recovery  one or more unknown intervals
```

This is separate from system errors. Status reports the last resolved date,
unknown-interval count, recovery requirement, and post-gap observation count.
History returns resolved daily states, overlapping unknown intervals, and real
source observations with no deterministic state. Recalculate succeeds with
`status: ok` and the same continuity diagnostics.

## Calibration and weight filtering

Calibration receives only the resolved deterministic prefix and retains the
existing Student-t likelihood, bounds, regularization, gates, and chronological
validation. Post-gap weights do not satisfy calibration gates until recovery
connects their candidate states to the anchor. They are retained for Phase 14A.

Missing weight on an otherwise complete transition still runs the existing
Kalman prediction-only step. Across an unknown forcing interval, neither the
weight filter nor a post-gap weight update is run. A weight observation never
overwrites Fat, LeanTissue, Glycogen, or ECF.

## Backfill and multiple gaps

Input history remains authoritative:

```text
unknown interval
→ user inserts observed historical inputs
→ full recalculation
→ Phase 13.1 bridges any remaining eligible 1–2 day gaps
→ unknown intervals shrink or disappear
→ deterministic prefix is rebuilt from the frozen initial state
```

Two vacations produce two source-level interval records even though Phase 13.2
cannot yet deterministically connect state beyond the first. Both are available
to the future recovery layer; all share the last actually resolved anchor until
an earlier interval is recovered or backfilled.

## Very long gaps

Three, seven, fourteen, thirty, and ninety days use the same semantic rule. The
duration is preserved and future uncertainty should grow with it. Phase 13.2
does not introduce a reset cliff or a `reinitialization-may-be-useful` threshold.

## Model version decision

The deterministic physiological equations do not change, and the resolved v3
pre-gap states remain numerically coherent. However, persisted history changes
meaningfully from v3 `incomplete/blocked` placeholder rows to explicit intervals
plus resolved-only states. Recalculation therefore advances the centralized
version to `bodycast-physiology-v4` and atomically rewrites all retained daily
rows and interval metadata, preventing mixed persistence semantics.

## Future Phase 14A hook

Future recovery can load, without reinitializing:

- the anchor `DailyModelState` and complete physiological/filter state;
- gap dates and duration;
- frozen baseline and simulator parameters;
- pre-gap behavior and personalization;
- post-gap weight, nutrition, activity, snapshots, and WorkIntervals.

Phase 14A may construct candidate deterministic trajectories and evaluate later
observations. Phase 13.2 adds no sampling, particle weights, smoothing,
uncertainty bands, or recovered state.

## Limitations and policy boundaries

- `missing != zero`, and no absent driver receives a default value.
- The interval records identify unresolved forcing but do not quantify its
  distribution or missingness mechanism.
- A closed interval does not mean recovered; it means observations or evaluable
  inputs resumed after it.
- Multiple intervals are source-level facts, while deterministic state remains
  resolved only through the earliest unrecovered break.
- Work walking, explicit breaks, residual categories, and outside-work distance
  exclusion retain the Phase 13.1A/13.1B algorithms unchanged.
