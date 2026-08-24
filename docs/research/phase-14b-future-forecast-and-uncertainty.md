# Phase 14B — Future Forecast and Uncertainty Propagation

## Decision

Phase 14B implements `bodycast-forecast-v1` as a side-effect-free latent
physiological forecast. It propagates both a distribution over the current
state and a distribution over future behavior through the unchanged
`bodycast-physiology-v4` daily transition. It does not persist forecast runs,
does not forecast future scale observations, and does not sample scientific
parameters.

The v1 forecast answers a conditional question: what distribution of modeled
future states follows if the scenario distribution is a reasonable description
of future nutrition and activity? It does not guarantee adherence, future scale
readings, or individual accuracy outside the model and scenario support.

## Research conclusion

Hall's mechanistic model work demonstrates why dynamic energy expenditure,
macronutrient partitioning, and metabolic adaptation must evolve through time
rather than use a static kcal-per-kg rule ([Hall 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/),
[Hall et al. 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/)). Controlled
feeding validation supports mechanistic forward simulation, but external work
also notes that individual and free-living behavior limits point-prediction
accuracy. BodyCast therefore treats the deterministic physiology as a
conditional transition, not as a certainty generator.

Probabilistic forecasts should maximize sharpness subject to calibration and
should be evaluated as distributions, not merely point errors
([Gneiting, Balabdaoui & Raftery 2007](https://doi.org/10.1111/j.1467-9868.2007.00587.x)).
The forecast intervals below are predictive intervals under the scenario, not
confidence intervals for a single fitted parameter.

Day-to-day energy intake varies materially within people; one controlled study
reported an average within-person intake CV near 25%
([Dietitian II](https://pubmed.ncbi.nlm.nih.gov/24021734/)), and longer dietary
records show person-specific variation and weekday effects
([Tarasuk & Beaton 1992](https://doi.org/10.1016/0195-6663(92)90209-O)). Physical
activity likewise has substantial within-person daily variation
([Schneider et al.](https://pubmed.ncbi.nlm.nih.gov/12165695/),
[Schmidt et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5910625/)). These
findings justify a stochastic behavior layer, but not one universal population
standard deviation.

Block resampling preserves short temporal and cross-variable dependence better
than independent marginal sampling; it is conceptually related to block
bootstrap methods for dependent series
([Politis & Romano 1994](https://doi.org/10.1080/01621459.1994.10476870)). For
weighted starting particles, stratified resampling was selected because it is
unbiased and has lower variance than multinomial resampling under the standard
comparison, while systematic resampling lacks that guarantee in general
([Douc, Cappé & Moulines 2005](https://arxiv.org/abs/cs/0507025)).

## What uncertainty is modeled

### Initial-state uncertainty

The full usable Phase 14A ensemble represents epistemic uncertainty about the
current latent state after an historical gap. Every particle contains FatMass,
LeanTissue, glycogen, extracellular-fluid state, adaptive thermogenesis, and
the auxiliary weight-filter state. Forecast never replaces this ensemble with
a mean, median, MAP particle, or highest-weight particle.

With fully resolved history, the deterministic history is replayed and the
initial distribution is exactly one state with weight one. No fake initial
spread is added.

### Future-behavior uncertainty

Stochastic scenarios represent aleatoric variation conditional on the stated
behavior model: calories, macros, outside-work walking, strength adherence, and
occupational adherence. The future inputs are assumptions, not reconstructed
observations.

### Not modeled

- Future scale measurement error is not injected into latent physiology.
- Gut content and sodium-driven water variation are not modeled.
- Scientific/model-parameter uncertainty is not modeled. All physiology
  constants, `personalOffsetKcalPerDay`, and `activityCalibration` stay fixed.
- Structural misspecification, medication, illness, endocrine effects, and
  long-term behavioral regime changes outside the scenario are not quantified.

This means the result is a conditional latent predictive distribution, not a
complete distribution of future real-world scale readings.

## Exact predictive construction

Let recovery provide weighted states

\[
\{(x_0^{(j)}, w_j)\}_{j=1}^M,\qquad w_j\ge 0,\quad \sum_jw_j=1.
\]

For a deterministic current state, `M=1` and `w_1=1`. The target is

\[
p(x_{1:H}\mid D,S)=
\int p(x_{1:H}\mid x_0,u_{1:H})
     p(u_{1:H}\mid S)
     p(x_0\mid D)\,du\,dx_0.
\]

The deterministic simulator makes
`p(x_t | x_{t-1}, u_t)` a point mass at
`F_phys(x_{t-1}, u_t)`. No transition noise is added to physiology.

For `N` forecast paths, stratified resampling draws the starting index using

\[
U_i=(i+V_i)/N,\quad V_i\sim U(0,1),
\]

and the inverse CDF of cumulative `w`. Each resulting path has empirical weight
`1/N`. Conditional on its selected state, a behavior path is sampled directly
from `p(u_{1:H}|S)`, so no proposal distribution or importance correction is
needed. This conversion adds finite-`N` Monte Carlo error but is unbiased and
avoids `M × N` trajectory explosion.

For every path and date:

```text
weighted current-state ensemble
→ seeded stratified starting-state draw
→ seeded future behavior path
→ simulateOneDay through unchanged physiology
→ retain full nonlinear trajectory
→ empirical date-wise quantiles
```

Invalid paths are not clamped. They are discarded as complete paths and their
reasons are counted. The response reports generated, valid, and invalid counts;
any invalid path or a valid fraction below the configurable threshold visibly
degrades the result.

## Starting-state contract

| History state | Forecast behavior |
|---|---|
| Fully resolved | Replay to the latest exact latent state; one initial particle, weight 1 |
| `recovered` | Use the full current weighted Phase 14A ensemble |
| `degraded` | Use the ensemble and return `initialStateQuality=degraded`; do not alter its intervals |
| `awaiting-observations` / no current ensemble | Return `initial-state-unavailable`; no prior-only forecast masquerades as conditioned recovery |
| `degenerate` | Return `initial-state-unreliable`; never use posterior median, MAP, or pre-gap state |
| Stale fingerprint/latest date | Return `initial-state-unavailable` until recovery is rerun |

No prior-predictive fallback is exposed in v1. This is the safest explicit
behavior because a prior-only current state is too easy for callers to mistake
for recovered history.

## Scenario contract

### `fixed`

Requires a complete coherent daily nutrition vector, outside-work walking,
walking speed, strength minutes, and an explicit occupational schedule.
Date overrides and weekday strength schedules are supported. Zero strength,
zero walking, and no work are valid explicit values. Missing fields fail schema
validation and never become zero or frozen maintenance.

With one exact current state, this mode collapses exactly to the deterministic
simulator. This is both a supported scenario and a critical regression.

### `recent-behavior`

Uses only reliable days whose nutrition source and dependency are both
`observed`, whose full transition inputs are complete, and whose activity is
reconstructable. Phase 13.1 imputed days, unknown-gap particles, and recovery
particles can never become donors.

Whole joint behavior days are sampled in configurable circular blocks (default
7 days), retaining nutrition/macronutrient/activity correlation and short
patterns. Default donor lookback is 56 days and minimum evidence is 14 reliable
days. Insufficient evidence returns `422 insufficient_scenario_evidence`; two
days are not promoted to personalized variability.

### `target-centered`

The schedule is the planned center, not an exact daily promise. Each path has a
persistent standard-normal regime component and each day has residual
variation. A common log-normal nutrition multiplier preserves strong dependence
between calories and all macros; smaller centered macro-composition factors
permit realistic non-exact food-label/accounting relations. Calories and macros
are therefore not independent draws and are not forced to satisfy exactly
`4P+9F+4C=calories`.

Outside-work walking uses a separate log-normal path/day component. Scheduled
strength and occupation use explicit adherence Bernoulli variables. The plan
never invents load or intensity.

Spread is estimated with robust log-scale MAD from at least 14 reliable
observed days. User-specified scenario spreads override the relevant dimensions.
Without sufficient history, configurable defaults are used and provenance is
`engineering-fallback`; the whole forecast is labeled `degraded`, not
personalized uncertainty.

## Activity semantics

The forecast input preserves the accepted decomposition:

```text
occupational net activity
+ outside-work walking
+ strength
```

Occupational intervals carry category, duration, break duration, optional work
walking, and walking-speed assumptions. Work walking is evaluated inside the
occupational component only. Outside-work distance remains separate, preventing
double counting. Future WorkIntervals do not pretend to contain Apple Health
snapshots. Apple Active Energy and steps are never primary forecast drivers.

## Physiological propagation

- Each particle carries its current adaptive thermogenesis into day one; AT is
  updated by the exact existing transition.
- Dynamic RMR is recalculated daily from evolving FatMass and LeanTissue.
- Personalization is applied unchanged to every path and is never refitted.
- Glycogen and its `2.7 kg water / kg glycogen` associated water propagate
  explicitly through existing equations.
- ECF uses production `hold-ecf`. Sodium forcing is absent, so the API reports
  this limitation rather than arbitrarily widening tissue intervals.
- Forecast sets `measuredWeightKg=null`; the auxiliary scale observation filter
  receives no synthetic future observations.

## Predictive summaries

Every date reports mean, median, p05, p25, p75, and p95 for:

- physiological body weight;
- FatMass and LeanTissue;
- glycogen, glycogen water, and total glycogen-associated mass;
- extracellular-fluid deviation under the declared ECF policy;
- adaptive thermogenesis;
- dynamic RMR and personalized TDEE;
- energy intake and calibrated net activity.

The p25–p75 and p05–p95 ranges are presentation-policy 50% and 90%
predictive intervals. They are not guarantees.

## Reproducibility and fingerprints

The same current-state source, recovery fingerprint, scenario, horizon, seed,
forecast version, physiology version, personalization, simulator parameters,
and config produce identical paths and summaries. The Phase 14A `SeededRandom`
is reused; `Math.random()` is never called.

The response carries separate SHA-256 source and scenario fingerprints.
`sourceFingerprint` covers the current deterministic/recovery source,
personalization, parameters, model version, recovery version, and forecast
version. `scenarioFingerprint` covers scenario, seed, horizon, config, and
forecast version.

## Persistence and staleness

V1 deliberately uses generate-on-request with no forecast table:

- scenarios are explicit request data;
- runs are deterministic and replayable from fingerprints and seed;
- summaries are modest but repeated user-created scenarios could still create
  unnecessary database rows;
- particle trajectories would be very large and are never returned publicly.

Every request recomputes the current history/recovery relationship. A recovery
whose latest date or Phase 14A source fingerprint differs is blocked. New health,
weight, nutrition, work/break, recalculation, recovery, personalization,
algorithm, config, or scenario data necessarily produce a different current
result/fingerprint. Since no old run is stored, there is no stale forecast row
to display. Phase 15 may persist named scenario summaries for user comparison,
but must use these fingerprints.

The only Phase 14B endpoint is:

```text
POST /api/v1/model/forecast
```

It returns compact summaries, status/provenance, and diagnostics—not paths.

## Generative calibration

Phase 14B.1 audited the validation generator before changing any production
interval. The old N=32 harness used adjacent integer seeds for its forecast and
truth streams. Adjacent seeds are not a defensible independence contract for a
small deterministic panel, and the resulting pairing plus large binomial noise
created the apparent 78–81% undercoverage. Panel indices are now avalanched into
domain-separated forecast/truth streams. Production sampling, physiology,
quantile probabilities, and interval widths are unchanged.

The enlarged main panel uses N=128 independent truth draws per horizon and 256
forecast paths. Every row reports successes/N, empirical coverage, and Wilson
95% CI. Every nominal 50% and 90% target is inside its corresponding CI.

| Horizon | Metric | 50% successes/N; coverage (Wilson 95%) | 90% successes/N; coverage (Wilson 95%) |
|---:|---|---:|---:|
| 7d | Weight | 75/128; 58.59% (49.93–66.75) | 115/128; 89.84% (83.40–93.97) |
| 7d | FatMass | 66/128; 51.56% (42.99–60.05) | 117/128; 91.41% (85.27–95.13) |
| 7d | Glycogen | 66/128; 51.56% (42.99–60.05) | 112/128; 87.50% (80.66–92.16) |
| 30d | Weight | 70/128; 54.69% (46.05–63.05) | 117/128; 91.41% (85.27–95.13) |
| 30d | FatMass | 68/128; 53.13% (44.52–61.55) | 117/128; 91.41% (85.27–95.13) |
| 30d | Glycogen | 59/128; 46.09% (37.70–54.72) | 113/128; 88.28% (81.56–92.77) |
| 90d | Weight | 70/128; 54.69% (46.05–63.05) | 115/128; 89.84% (83.40–93.97) |
| 90d | FatMass | 74/128; 57.81% (49.15–66.02) | 114/128; 89.06% (82.48–93.37) |
| 90d | Glycogen | 73/128; 57.03% (48.37–65.28) | 113/128; 88.28% (81.56–92.77) |

### Resampling, empirical quantiles, and finite-path semantics

Starting-particle weights are normalized once and stratified resampling uses one
random offset per stratum. Tests cover uniform, dominant, zero-weight, malformed,
and reproducible weighted inputs. No second reweighting occurs after resampling.

Forecast summaries are equal-path empirical distributions. Quantiles use the
inverse empirical CDF, `Q(p) = x[ceil(pN)]` with one-based order statistics. For
N=256 and an independent continuous truth, this convention implies finite-path
coverage 128/257 = 49.81% for p25–p75 and 231/257 = 89.88% for p05–p95—not
exactly 50% and 90%. Odd/even N, repeated values, deterministic collapse,
monotonicity, and equivalence to an expanded equal-weight representation are
regression tested.

The decomposition panel separately draws initial-only, future-only, and combined
truths from the same declared distributions (N=64 per horizon/quantity). Weight
and FatMass nominal targets remain within Wilson intervals across 7/30/90 days.
Initial-only glycogen reaches 100% coverage at 90 days because the simulator
contracts distinct starting glycogen states onto tied endpoint values; this is a
real loss of memory and conservative tie behavior, not interval widening.

Scenario-mode evidence is separate:

- fixed mode is exact at 90 days: maximum endpoint error is zero for all five
  reported order statistics of weight, FatMass, and glycogen;
- recent-behavior uses N=128 per horizon with joint circular block resampling;
  all 50% and 90% nominal targets are inside Wilson 95% intervals;
- target-centered uses the enlarged N=128 main table above, with joint nutrition
  multipliers and stochastic activity adherence tested directly.

### Long-horizon numerical quality

A same-seed 365-day comparison used 512 ordinary paths and an 8192-path
reference. The 512-path result is explicitly classified
`limited-long-horizon`; 8192 is `standard`. Endpoint absolute differences were
up to 1.123 kg for weight, 0.697 kg for FatMass, and 0.0091 kg for glycogen
across p05/p25/median/p75/p95. This is numerical Monte Carlo resolution, not a
new physiological uncertainty source. The API reports path count, recommended
minimum, adequacy, starting-state support, and outer-rank standard error; it does
not silently widen intervals.

## Stress validation

The separate stress suite contains deficit, maintenance, surplus, abrupt
deficit→maintenance, deficit→surplus, high/low carbohydrate, low/high activity,
regular strength, vacation-recovered state, degraded recovery, and limited
history. These are support/robustness probes, not nominal calibration data.

Twelve of thirteen constructed truths fell inside the forecast 90% weight
interval. The deliberate `deficit→surplus` edge did not. Intervals were not
widened or tuned to force inclusion. Fixed scenarios correctly produced a
collapsed distribution. Degraded and limited-history cases remained visibly
`degraded`; all generated paths were valid.

## Canonical forecasts

All values below are latent modeled endpoints under the stated distributions,
not guaranteed outcomes.

| Scenario | Endpoint weight p05 / median / p95 kg | FatMass median kg | Glycogen median kg | RMR median | TDEE median |
|---|---:|---:|---:|---:|---:|
| 30d target-centered deficit | 76.774 / 78.044 / 79.540 | 14.841 | 0.4939 | 1730.1 | 2159.7 |
| 90d target-centered maintenance | 76.759 / 81.538 / 87.011 | 16.931 | 0.4960 | 1765.8 | 2297.7 |
| 15d deficit → 15d maintenance | 77.816 / 79.371 / 81.284 | 15.602 | 0.4955 | 1743.2 | 2238.9 |
| Recovered vacation ensemble → 30d maintenance | 78.788 / 80.495 / 82.533 | 16.303 | 0.4969 | 1755.4 | 2276.3 |

The complete daily median, 50%, and 90% trajectories are returned by the API;
the table shows only the final date for compactness.

## Performance and path-count sensitivity

All benchmark paths were valid. Approximate raw path-metric memory counts 12
floating metrics per path/date and excludes JavaScript object overhead.

| Paths | 7d | 30d | 90d | 180d | 365d | Approx raw metric memory at 365d |
|---:|---:|---:|---:|---:|---:|---:|
| 128 | 28.3 ms | 81.7 ms | 159.0 ms | 300.5 ms | 583.6 ms | 4.5 MB |
| 512 | 47.9 ms | 212.6 ms | 624.9 ms | 1,314.9 ms | 2,761.4 ms | 17.9 MB |
| 2048 | 265.6 ms | 1,051.1 ms | 3,271.6 ms | 6,508.6 ms | 13,483.2 ms | 71.8 MB |

Thirty-day weight p05/median/p95 was:

- 128: `78.811 / 80.718 / 82.936 kg`;
- 512: `78.736 / 80.480 / 82.641 kg`;
- 2048: `78.742 / 80.483 / 82.659 kg`.

Thus 512 remains the v1 default: its representative 30-day endpoints are nearly
identical to 2048 while runtime is about five times lower. At 365 days Monte
Carlo median sensitivity remains visible (512 vs 2048 differs by about 0.51 kg),
so horizons beyond 180 days with fewer than 1024 paths are explicitly marked
`limited-long-horizon`. With stochastic behavior, 90% weight width increased from
about 1.27 kg at 7 days to 27.29 kg at 365 days for 512 paths; uncertainty is not
artificially held constant.

## Limited history

Explicit fixed plans work from physiological defaults even before 28 or 56
days and do not require personalization. Target-centered forecasts also work,
but if fewer than 14 reliable donor days exist and spreads are not fully
specified, configurable fallback spreads are used with
`source=engineering-fallback` and `status=degraded`. Recent-behavior sampling
requires its minimum donor evidence and fails explicitly otherwise.

`calibrationStatus`, fixed personalization parameters, and donor evidence are
independent concepts. Forecast never satisfies a history gate or changes
calibration state.

## Phase 15 interface and limitations

Phase 15 may graph the returned daily summaries and show scenario provenance,
initial-state quality, and ECF warning. It must not describe p05–p95 as a
guarantee. Goal probability, target solving, adherence optimization, sodium,
observed-scale distributions, parameter uncertainty, and recommendations remain
out of scope for this phase.

## Verification snapshot

- Unit/API/regression/validation: 85 files, 1,128 tests passed, 0 failed,
  0 skipped.
- PostgreSQL: 3 files, 25 tests passed, 0 failed, 0 skipped.
- Overall coverage with forecast included: 98.89% statements/lines, 94.91%
  branches, 99.00% functions.
- `src/model`: 100% statements, branches, functions, and lines.
- `src/modules/model-forecast`: 99.33% statements/lines, 91.20% branches,
  96.77% functions. Forecast code is explicitly inside the coverage include
  scope.
- Prisma: 12 migrations present, database schema current; Phase 14B adds no
  schema or migration.
- PostgreSQL integration verifies deterministic and recovered/degraded starts,
  degenerate and stale-fingerprint blocking, deterministic replay, and no
  mutation of ModelEpisode, DailyModelState, frozen baseline/personalization,
  or recovery ensemble.
