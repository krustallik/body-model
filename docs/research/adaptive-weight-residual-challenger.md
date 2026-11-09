# Adaptive weight and forecast challengers

## Status

Causal residual correction, adaptive scale-only Kalman filtering,
initial-level sensitivity, robust bias, and uncertainty fallback are
implemented as isolated research methods and remain disabled in serving.
Forecast, Model, Goal, UI, database schema, and production data paths were not
changed. No production write, recalculation, or deployment occurred.

## V7 replay mismatch and historical baseline

Persisted Profile 1 rows identify runtime v7-7 while the current producer is
v7-8. The newer revision adds receipt-time scale-filter fields and changes
payload/fingerprint metadata. On the isolated snapshot, 55/55 rows have equal
semantic cores after excluding only revision/fingerprint metadata and those
new filter fields. Physical compartment payloads also match but are unavailable
on every row; energy/nutrition and training projections match 55/55. This
supports a versioned-payload explanation, not changed tissue state. The saved
V7 payloads lack the complete immutable source bundles, so byte-for-byte
historical raw-input equality cannot be established.

Historical state fit is not forecast skill: prior bias/MAE/RMSE
+2.356 / 2.357 / 2.480 kg; posterior +1.911 / 1.911 / 2.011 kg (53 dates).
Initialization had one observation and status insufficient. Initial total
91.20 kg matched the first weight but does not identify composition:
fat 25.81, lean 45.05, glycogen 0.50, glycogen-associated water 1.35 kg,
ECF deviation 0. First-seven median was 88.85 kg, 2.35 below initial total.
In that week replayed physiological weight changed only -0.032 kg despite
-2,293 kcal cumulative modeled balance; fat and lean fell about 0.36 kg while
glycogen plus associated water rose about 0.33 kg and ECF was held. This is
consistent with unidentified initial composition/fluid and/or model response;
it does not identify a specific compartment or establish later energy drift
as the sole cause. The fixed weight filter reduced mean residual by about
0.45 kg but left +1.91 kg bias. Each new weight updates its scale belief, not
tissue or energy state.

## Causal experiment

A verified Profile 1 snapshot was restored to isolated local PostgreSQL
bodycast_profile1_research_test_20261109. The runner attempted 42 origins
(2026-09-26 through 2026-11-06); 39 had complete physiology forecasts.
Candidates share active Forecast issue/target pairs and immutable
HealthSyncSnapshot target weights, with first receipt after issue cutoff.
Paired N is 37/35/31/25 for 1/3/7/14 days. Deterministic replay matched and
the HealthSyncSnapshot row-count/fingerprint remained unchanged.

These are counterfactual receipt-time hindcasts, not forecasts BodyCast
actually issued; as-issued snapshots were not saved. The physiology comparator
is legacy calculateEpisodeHistory + simulateDays, not full V7 daily runtime.
A comparable V7 tissue forecast is unavailable (N=0): all 55 saved
compartment states are unavailable. Adjacent daily pairs overlap. Intervals
are paired non-wrapping moving-block bootstrap 95% intervals, 4,000 resamples,
block length equal to horizon days. The early/late split at 2026-10-10 was
inspected and is exploratory, not blind holdout. Positive delta means active
MAE minus candidate MAE, favoring candidate.

## Approaches

- Initial-level sensitivity: first-seven median requested -2.35 kg, clamped
  to -0.75 kg and assigned only to an ECF-deviation sensitivity state. This
  does not show actual ECF and is not a recommended correction.
- Two-timescale residual: causal slow/fast components from matured prior
  residuals, with three-day decay for the fast component.
- Robust persistent residual: trailing 28-calendar-day median, bounded to
  +/-1 kg. Residual methods do not change tissue or energy parameters.
- Adaptive local-level Kalman: scale-only state, 0.25 kg2 measurement noise,
  initial process noise 0.01 kg2/day, innovation adaptation with a 14-day
  time constant and bounds 0.001-0.25 kg2/day. It emits a scale belief.
- Physiology anchors shift active Forecast by adaptive filter estimate minus
  latest weight; tissue/energy trajectory is unchanged.
- Uncertainty fallback uses last-known weight after at least eight matured
  exact-horizon outcomes and active P05-P95 coverage below 60%. It shifts,
  but does not widen, intervals.
- Energy, initial-water, and filter-only controls test effects on physiology.

## Paired results

> The paired intervals in the original table below used truncated moving
> blocks. A review found edge bias for short, highly overlapping series. The
> runner now uses circular moving blocks; the original point metrics are
> unchanged, but their old confidence intervals are superseded by the final
> intervals in “New paired challenger experiment” below.

Bias / MAE / RMSE are in kg. The last column is paired active MAE minus
candidate MAE and its 95% block interval; intervals crossing zero do not
establish improvement. Accepted energy calibration had no accepted parameter
change at these origins, so equality is not evidence of a valid calibration.
| Method | Horizon | N | Bias / MAE / RMSE kg | ΔMAE kg (%) [paired 95% block interval] |
| --- | ---: | ---: | ---: | ---: |
| Active physiology Forecast | 1d | 37 | -0.19 / 0.65 / 0.80 | baseline |
| Last-known scale weight | 1d | 37 | -0.06 / 0.56 / 0.71 | +0.08 (+12.9%) [+0.03, +0.14] |
| Fixed local-level Kalman (scale only) | 1d | 37 | -0.01 / 0.56 / 0.72 | +0.08 (+12.8%) [−0.09, +0.27] |
| Adaptive local-level Kalman (scale only) | 1d | 37 | -0.07 / 0.56 / 0.68 | +0.09 (+13.5%) [−0.04, +0.23] |
| Fixed Kalman adjustment anchored to physiology | 1d | 37 | -0.14 / 0.67 / 0.82 | −0.02 (−3.1%) [−0.19, +0.16] |
| Adaptive Kalman adjustment anchored to physiology | 1d | 37 | -0.20 / 0.65 / 0.79 | −0.01 (−1.1%) [−0.14, +0.13] |
| Theil-Sen scale trend | 1d | 37 | -0.14 / 0.70 / 0.83 | −0.06 (−8.7%) [−0.24, +0.14] |
| Initial water reallocation sensitivity | 1d | 37 | -0.19 / 0.65 / 0.80 | +0.00 (+0.0%) [−0.00, +0.00] |
| Filter-only negative control | 1d | 37 | -0.19 / 0.65 / 0.80 | 0.00 (0.0%) [0.00, 0.00] |
| Two-timescale residual correction | 1d | 37 | 0.05 / 0.80 / 1.01 | −0.15 (−23.2%) [−0.31, −0.00] |
| Robust persistent residual correction | 1d | 37 | -0.11 / 0.66 / 0.80 | −0.01 (−1.3%) [−0.07, +0.05] |
| Accepted energy calibration replay | 1d | 37 | -0.19 / 0.65 / 0.80 | 0.00 (0.0%) [0.00, 0.00] |
| Uncertainty-triggered last-known fallback | 1d | 37 | -0.06 / 0.57 / 0.72 | +0.07 (+11.6%) [+0.02, +0.13] |
| Active physiology Forecast | 3d | 35 | -0.30 / 0.74 / 1.03 | baseline |
| Last-known scale weight | 3d | 35 | -0.04 / 0.72 / 0.97 | +0.02 (+3.1%) [−0.09, +0.14] |
| Fixed local-level Kalman (scale only) | 3d | 35 | 0.00 / 0.63 / 0.79 | +0.11 (+14.9%) [−0.06, +0.31] |
| Adaptive local-level Kalman (scale only) | 3d | 35 | -0.08 / 0.60 / 0.79 | +0.14 (+18.7%) [−0.03, +0.29] |
| Fixed Kalman adjustment anchored to physiology | 3d | 35 | -0.26 / 0.74 / 0.90 | −0.00 (−0.6%) [−0.15, +0.16] |
| Adaptive Kalman adjustment anchored to physiology | 3d | 35 | -0.34 / 0.72 / 0.90 | +0.02 (+2.8%) [−0.12, +0.15] |
| Theil-Sen scale trend | 3d | 35 | -0.22 / 0.77 / 0.97 | −0.03 (−3.6%) [−0.29, +0.28] |
| Initial water reallocation sensitivity | 3d | 35 | -0.29 / 0.74 / 1.03 | +0.00 (+0.1%) [−0.00, +0.00] |
| Filter-only negative control | 3d | 35 | -0.30 / 0.74 / 1.03 | 0.00 (0.0%) [0.00, 0.00] |
| Two-timescale residual correction | 3d | 35 | -0.11 / 0.76 / 1.00 | −0.02 (−3.1%) [−0.11, +0.11] |
| Robust persistent residual correction | 3d | 35 | -0.23 / 0.72 / 1.01 | +0.02 (+3.2%) [−0.02, +0.09] |
| Accepted energy calibration replay | 3d | 35 | -0.30 / 0.74 / 1.03 | 0.00 (0.0%) [0.00, 0.00] |
| Uncertainty-triggered last-known fallback | 3d | 35 | -0.06 / 0.73 / 0.98 | +0.01 (+1.7%) [−0.09, +0.13] |
| Active physiology Forecast | 7d | 31 | -0.57 / 0.89 / 1.03 | baseline |
| Last-known scale weight | 7d | 31 | -0.06 / 0.79 / 0.92 | +0.11 (+12.1%) [−0.11, +0.33] |
| Fixed local-level Kalman (scale only) | 7d | 31 | 0.03 / 0.68 / 0.83 | +0.21 (+23.5%) [−0.01, +0.47] |
| Adaptive local-level Kalman (scale only) | 7d | 31 | -0.08 / 0.67 / 0.80 | +0.22 (+25.1%) [+0.01, +0.40] |
| Fixed Kalman adjustment anchored to physiology | 7d | 31 | -0.48 / 0.78 / 0.95 | +0.11 (+12.2%) [−0.05, +0.36] |
| Adaptive Kalman adjustment anchored to physiology | 7d | 31 | -0.59 / 0.83 / 0.96 | +0.06 (+7.0%) [−0.05, +0.19] |
| Theil-Sen scale trend | 7d | 31 | -0.38 / 0.90 / 1.12 | −0.01 (−0.7%) [−0.26, +0.12] |
| Initial water reallocation sensitivity | 7d | 31 | -0.56 / 0.89 / 1.03 | +0.00 (+0.3%) [+0.00, +0.00] |
| Filter-only negative control | 7d | 31 | -0.57 / 0.89 / 1.03 | 0.00 (0.0%) [0.00, 0.00] |
| Two-timescale residual correction | 7d | 31 | -0.37 / 0.75 / 0.88 | +0.14 (+15.8%) [+0.03, +0.25] |
| Robust persistent residual correction | 7d | 31 | -0.51 / 0.82 / 0.95 | +0.08 (+8.7%) [+0.03, +0.15] |
| Accepted energy calibration replay | 7d | 31 | -0.57 / 0.89 / 1.03 | 0.00 (0.0%) [0.00, 0.00] |
| Uncertainty-triggered last-known fallback | 7d | 31 | -0.24 / 0.74 / 0.89 | +0.15 (+16.7%) [+0.00, +0.34] |
| Active physiology Forecast | 14d | 25 | -0.91 / 1.14 / 1.45 | baseline |
| Last-known scale weight | 14d | 25 | -0.03 / 0.80 / 0.95 | +0.34 (+29.7%) [−0.10, +0.80] |
| Fixed local-level Kalman (scale only) | 14d | 25 | 0.15 / 0.82 / 1.00 | +0.32 (+27.7%) [−0.27, +0.95] |
| Adaptive local-level Kalman (scale only) | 14d | 25 | -0.02 / 0.75 / 0.91 | +0.39 (+33.9%) [−0.10, +0.89] |
| Fixed Kalman adjustment anchored to physiology | 14d | 25 | -0.73 / 1.13 / 1.38 | +0.01 (+1.1%) [−0.12, +0.19] |
| Adaptive Kalman adjustment anchored to physiology | 14d | 25 | -0.90 / 1.15 / 1.42 | −0.01 (−0.7%) [−0.10, +0.06] |
| Theil-Sen scale trend | 14d | 25 | -1.22 / 1.38 / 1.75 | −0.24 (−21.1%) [−0.38, +0.18] |
| Initial water reallocation sensitivity | 14d | 25 | -0.90 / 1.13 / 1.44 | +0.00 (+0.4%) [+0.00, +0.01] |
| Filter-only negative control | 14d | 25 | -0.91 / 1.14 / 1.45 | 0.00 (0.0%) [0.00, 0.00] |
| Two-timescale residual correction | 14d | 25 | -0.75 / 1.00 / 1.27 | +0.14 (+12.2%) [+0.03, +0.22] |
| Robust persistent residual correction | 14d | 25 | -0.87 / 1.11 / 1.40 | +0.02 (+2.2%) [−0.03, +0.03] |
| Accepted energy calibration replay | 14d | 25 | -0.91 / 1.14 / 1.45 | 0.00 (0.0%) [0.00, 0.00] |
| Uncertainty-triggered last-known fallback | 14d | 25 | -0.73 / 0.96 / 1.22 | +0.18 (+15.5%) [0.00, +0.18] |

## Time stability

Early means issue dates before 2026-10-10; late starts that day. Positive
paired delta MAE favors the candidate. The adaptive filter's 14-day gain
changes from negative early to large positive late; last-known weight shows
the same shift. This makes pooled results vulnerable to a changing
forecast-error regime.

## Assimilation and uncertainty

The adaptive filter received 13-52 causal observations. Process-noise Q
started at 0.071, median 0.060, ended 0.072, and ranged 0.040-0.082 kg2/day;
it was not monotonic. Posterior variance median was 0.100 kg2 (0.084-0.180).
Filter estimate minus latest weight median was -0.044 kg (range -0.820 to
+1.326). It adapts the observation-layer estimate as data accumulate; tissue
is outside its state vector. Synthetic regression covers sustained-innovation
Q adaptation and excludes future observations from earlier estimates.

Active Forecast P05-P95 coverage / mean width (nominal coverage is 90%):
1d 27% / 0.68 kg; 3d 34% / 0.86 kg; 7d 26% / 1.00 kg; 14d 36% / 1.05 kg.
These intervals are materially under-calibrated.

Fallback P05-P95 coverage / mean width:
1d 38% / 0.68 kg; 3d 34% / 0.86 kg; 7d 42% / 1.00 kg; 14d 40% / 1.05 kg.
Fallback activated on 29/37 (78%), 25/35 (71%), 18/31 (58%), and 4/25
(16%) pairs at 1/3/7/14 days. The fallback does not produce calibrated
uncertainty.

## Causal findings and separated error sources

- The current replay is deterministic and reproduces all 55 stored days across
  935 compared numeric values; the maximum difference is below `1e-12`. This
  verifies replay compatibility, not physiological validity.
- Initialization has one scale observation and is explicitly `insufficient`.
  It pins total weight at 91.20 kg but cannot identify fat, lean tissue,
  glycogen, glycogen water, ECF, or gut-content mass. The first seven scale
  observations were already available at episode creation, so receipt delay
  does not explain their discrepancy.
- On those first seven days, observed median weight was 88.85 kg while the
  replayed physiological median was 91.168 kg. The first day matches within
  0.03 kg, then the replay's weekly state-fit bias is +1.68 kg. Despite a
  modeled −2,293 kcal balance, physiological weight changed only −0.032 kg:
  fat and lean fell about 0.36 kg while glycogen plus associated water rose
  about 0.33 kg; ECF was held. This points to an unidentified transient
  scale-to-compartment discrepancy, but it cannot tell whether water, gut
  content, initial composition, or input semantics caused it.
- The local read-only receipt-time check found 53 distinct weight dates from
  6,270 snapshots. First receipt was a median 8.7 hours (p90 11.8 hours) after
  local midnight; three dates arrived at least a day later. The causal runner
  uses receipt-time projection, and the first seven scale readings were
  already available at episode creation.
- Fourteen-day historical physiological-state bias remains positive but is
  not monotonically accumulating: +2.14, +2.62, +2.52, and +2.14 kg across
  the four windows. Filtered bias is +1.71, +2.13, +2.06, and +1.73 kg. The
  scale filter removes roughly 0.45 kg on average, but it never feeds the
  compartment or energy state. Thus the +2.356 kg state bias is not evidence
  of a steadily increasing energy deficit error.
- Energy arithmetic is internally consistent (identity error 0); the replay
  averages 2,714 kcal intake versus 2,916 kcal expenditure across 55 days.
  The 53-observation calibration still rejects its attempted +500 kcal/day
  offset at the parameter bound: validation NIS improves from 18.08 to 6.92,
  but the evidence does not identify that offset as safe or correct.
- Active Forecast has a separate negative future bias: −0.91 kg at 14 days.
  The current engine anchors each particle to the latest scale weight using
  one constant offset, while the physiological slope is driven by recent
  donor behavior and energy parameters. It does not adapt that residual over
  the horizon. Last-known weight scores better here, but without historical
  as-issued forecasts this is only a counterfactual comparison.
- P05–P95 coverage is 26–36%, far below nominal 90%. The Forecast diagnostics
  explicitly omit measurement and model-parameter uncertainty; stochastic
  behavior paths alone do not cover the observed scale/physiology residual.

## New paired challenger experiment

The Profile 1 source snapshot was imported and replayed in isolated local
PostgreSQL `bodycast_profile1_research_test_20261109`. Its source manifest is
SHA-256 `27c26a2d92990fdf5e02099b3d3fadbb0e85c22b4ea7164f618515f8c8839927`
(234,118 records, 1,179,498,139 bytes); the importer rechecked the digest and
table counts. The final runner used 42 as-of origins, completed 39 forecasts,
and kept the HealthSyncSnapshot row count/fingerprint unchanged. These are
counterfactual hindcasts, not stored as-issued forecasts. ΔMAE is active MAE
minus challenger MAE, so positive values favor the challenger. Paired
uncertainty is a 4,000-replicate circular moving-block bootstrap with block
length equal to horizon; the intervals are exploratory because adjacent
origins and target outcomes overlap.

Historical physiological state is shown separately from future Forecast:

| Historical state-fit | Baseline / stored contract | New challenger | Result |
| --- | --- | --- | --- |
| V7 semantic replay | 55 stored days | 55/55 reproduced; 935 fields compared | max difference <1e-12 |
| Physiological weight residual | bias +2.356, MAE 2.357, RMSE 2.480 kg | No candidate changes tissue state | Not improved |
| Filtered weight residual | bias +1.911, MAE 1.911, RMSE 2.011 kg | Scale-only filter; tissue untouched | About 0.446 kg lower bias, still high |
| First seven days | observed median 88.85; model median 91.168 kg | No compartment reassignment accepted | +1.68 kg week-fit bias; cause not identifiable |
| 14-day residual windows | +2.14 / +2.62 / +2.52 / +2.14 kg | — | Persistent positive offset, not a monotone drift |

Prospective/counterfactual forecast comparisons, all on identical issue/target
pairs. RMSE change is challenger minus active; interval columns show P05–P95
coverage and mean width.

| Horizon | N | Active bias / MAE / RMSE | AR(1) bias / MAE / RMSE | AR(1) ΔMAE (95% CI); ΔRMSE | Last weight MAE / RMSE | Energy drift MAE / RMSE | Active → widened interval coverage; width kg |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1d | 37 | −0.192 / 0.647 / 0.804 | −0.132 / 0.666 / 0.803 | −0.019 [−0.060, +0.019]; −0.001 | 0.564 / 0.714 | 0.650 / 0.808 | 27% → 73%; 0.68 → 2.15 |
| 3d | 35 | −0.296 / 0.740 / 1.034 | −0.241 / 0.709 / 1.006 | +0.031 [−0.004, +0.076]; −0.028 | 0.717 / 0.971 | 0.748 / 1.043 | 34% → 66%; 0.86 → 2.34 |
| 7d | 31 | −0.569 / 0.894 / 1.031 | −0.509 / 0.837 / 0.965 | +0.057 [+0.008, +0.117]; −0.067 | 0.785 / 0.915 | 0.907 / 1.036 | 26% → 65%; 1.00 → 2.54 |
| 14d | 25 | −0.908 / 1.138 / 1.449 | −0.856 / 1.098 / 1.388 | +0.040 [+0.004, +0.077]; −0.061 | 0.800 / 0.951 | 1.210 / 1.516 | 36% → 44%; 1.05 → 1.61 |

AR(1) ΔMAE is −2.9%, +4.1%, +6.4%, +3.5% and ΔRMSE is −0.1%, −2.7%,
−6.4%, −4.3% of active error at 1/3/7/14 days. The energy-drift candidate's
ΔMAE is −0.5%, −1.1%, −1.5%, −6.3%; its ΔRMSE is +0.5%, +0.8%, +0.5%,
and +4.6%. Negative ΔMAE means worse. Last-known scale weight reduces MAE
versus active by 12.9%, 3.1%, 12.1%, and 29.7%, but it is a persistence
baseline rather than a causal physiology model.

The AR(1) scale-residual challenger learns only weak persistence on this slice:
the estimated per-day coefficient ranged 0–0.08 as matured history grew from
one to 34 residuals. It reduces 7d/14d point error slightly, but worsens 1d
MAE, does not improve uncertainty, and is supported by only 25 overlapping
14d cases. The energy-drift challenger used finite-difference simulator
sensitivity and a zero-centered prior; 24 origins were estimable, 13 were
split-unstable, and 2 had insufficient observations. Its offsets ranged
−164 to +251 kcal/day, but future error worsened at every horizon and 14d
ΔMAE was −0.072 kg [−0.137, −0.007]. Retrospective residual slope therefore
does not transfer safely into future energy correction here.

Prequential interval widening used only prior, matured, same-horizon
counterfactual outcomes. It improved empirical coverage but remained below
90%, especially at 14d; only eight origins had enough 14d calibration cases.
The intervals became 1.6–2.5 kg wide. Outcomes and forecast origins overlap,
so this is a diagnostic, not a formal conformal coverage guarantee.

## Decision after new experiments

No candidate meets the activation bar. The AR(1) residual method is now a
completed, tested research challenger; it remains disabled. The energy-slope
candidate is rejected for use on these data. Interval widening is not
calibrated enough for a user-facing confidence claim. Active Forecast, Model,
Goal, Diagnostics, APIs, UI, schema, and production data remain unchanged.

The remaining uncertainty is whether the prospective bias is a stable
short-horizon regime or a temporary pattern in this inspected 55-day episode.
The minimum informative next experiment is to persist immutable, as-issued
baseline and challenger forecast snapshots, freeze both algorithms, and score
at least 30 non-overlapping 14-day target pairs after their first receipt.
That is about 14 months if issuing one independent pair every two weeks; daily
overlapping hindcasts should not be counted as independent evidence.
## Prior challenger decision (superseded by the new experiment above)

Adaptive scale-only local-level filtering has the lowest or near-lowest MAE
at 1/3/7/14 days: 0.56/0.60/0.67/0.75 kg versus active 0.65/0.74/0.89/1.14.
Its reductions are 0.09/0.14/0.22/0.39 kg (13.5/18.7/25.1/33.9%). Only its
7-day bootstrap interval excludes zero; the others include zero and the
14-day interval is wide. It extrapolates a smoothed current scale reading,
not future tissue or energy change, so it is a strong baseline rather than a
physiological Forecast replacement.

The nearest physiology-preserving candidate, the adaptive anchor, changes
MAE by -0.01/+0.02/+0.06/-0.01 kg; every interval includes zero. Two-timescale
residual improves 7d/14d by +0.14 kg on this inspected slice, but worsens 1d
and is not reliably helpful at 3d. Initial-water sensitivity changes MAE by
at most 0.01 kg. Energy calibration was not accepted. Fallback can lower point
error but does not calibrate intervals. No candidate is ready for activation;
keep all challengers isolated and disabled.

Do not write scale residual into fat, lean, glycogen, water, nutrition, or
energy balance. Evidence shows mismatch, not a safe compartment correction.
No active Forecast/Model/Goal/UI or production behavior changed.

## Prospective evidence

Persist immutable active and challenger forecasts with issue time, input
cutoff, model/source fingerprint, target date, point estimate, and quantiles.
Freeze parameters and score only after the target's first receipt. Compare
identical origins with predeclared time blocks for at least six months,
especially to obtain independent 14-day blocks. Require a physiology-preserving
candidate to improve MAE and RMSE without harming 1d/3d behavior and approach
nominal 90% interval coverage. Historical posterior fit is not future forecast
proof.

## Literature

- Hall et al., [The Dynamics of Human Body Weight Change](https://pmc.ncbi.nlm.nih.gov/articles/PMC2266991/): dynamic mass change depends on energy flux and composition.
- Hall et al., [Quantification of the effect of energy imbalance on bodyweight](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/): weight response is dynamic and slow.
- Brown & Rutan, [Adaptive Kalman Filtering](https://nvlpubs.nist.gov/nistpubs/jres/090/jresv90n6p403_a1b.pdf): innovations can guide filter-noise adaptation, not establish a body-weight-specific model.
- Bhutani et al., [Composition of two-week change in body weight under unrestricted free-living conditions](https://pubmed.ncbi.nlm.nih.gov/28676555/): short-window scale changes concern body composition.
- Xu & Xie, [Conformal Prediction Interval for Dynamic Time-Series](https://proceedings.mlr.press/v139/xu21h.html): time-series interval calibration needs methods that account for temporal dependence; this small overlapping replay does not establish their coverage assumptions.

## Verification record

- Isolated local PostgreSQL and deterministic replay only; no production connection or write.
- Targeted adaptation and causal-assimilation tests: 30 passed. Full TypeScript typecheck, full ESLint, and optimized Next build passed with test-only loopback environment. The full local Windows unit suite reported 4,195 passed, 23 failed, 40 skipped, and 8 worker errors; failures were in unrelated production-release fixtures with Windows CRLF expectations or subprocess timeouts. The exact-main Linux CI remains the authoritative full-suite result.
- Final isolated PostgreSQL replay was deterministic across 55/55 stored days and left the HealthSyncSnapshot fingerprint unchanged. Independent audit and re-audit: PASS. Main push and exact-new-SHA CI remain pending.
- Main push and exact-SHA CI: pending.
