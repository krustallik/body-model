# Phase 14A: historical gap recovery and state uncertainty

## Problem and inference target

BodyCast has a deterministic mechanistic transition, but vacation-length missing
nutrition and activity create an unidentified forcing history. Phase 14A infers
a distribution over plausible missing inputs and the physiological trajectories
they generate. It does not infer one true vacation history, mutate scientific
parameters, or turn posterior estimates into deterministic `DailyModelState`.

The target is the posterior over full trajectories from the last resolved state
through the latest completed local day:

```text
p(trajectory | pre-gap anchor, observed inputs, post-gap scale weights,
  explicit engineering prior)
```

Daily scale weight alone cannot uniquely distinguish tissue, glycogen-associated
water, or unmodelled sodium-related fluid. That ambiguity must remain visible.

## Evidence review

- State-space filtering estimates the current state using observations through
  the current time; prediction propagates without a new observation; smoothing
  or retrospective trajectory inference additionally conditions earlier states
  on later observations. Particle methods attach importance weights because
  candidates are sampled from a proposal rather than directly from the
  posterior, and effective sample size (ESS) diagnoses concentration
  ([Particle Filters: A Hands-On Tutorial](https://pmc.ncbi.nlm.nih.gov/articles/PMC7826670/)).
- Full-trajectory particle smoothers can suffer path degeneracy after repeated
  resampling; backward simulation is useful when sequential filtering and full
  smoothed paths are required, but adds substantial machinery
  ([state-space smoothing review/example](https://pmc.ncbi.nlm.nih.gov/articles/PMC8408370/)).
- Multiple-imputation literature requires missing values to be drawn from a
  predictive distribution and retained as multiple plausible completions;
  single imputation suppresses uncertainty
  ([longitudinal MI tutorial](https://pmc.ncbi.nlm.nih.gov/articles/PMC11755704/),
  [longitudinal missing-data review](https://pmc.ncbi.nlm.nih.gov/articles/PMC2722118/)).
- Hall's model work supports using mechanistic weight dynamics to constrain
  otherwise unobserved energy intake, especially with repeated weights, but it
  does not make short daily intake uniquely identifiable
  ([Hall 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/),
  [short- and long-term intake patterns](https://pmc.ncbi.nlm.nih.gov/articles/PMC4127345/)).
  Free-living intake varies substantially day to day while weight responds on a
  slower time scale, so a broad trajectory ensemble is more appropriate than
  reverse-solving one daily calorie sequence.
- Dietary and physical-activity records have both random and systematic error;
  observed within-person day-to-day variability and correlations should not be
  destroyed by independent marginal sampling
  ([diet-reporting error](https://pmc.ncbi.nlm.nih.gov/articles/PMC3025654/),
  [physical-activity reporting error](https://pmc.ncbi.nlm.nih.gov/articles/PMC3544158/)).
- Day-to-day scale changes include biological water variability well above
  instrument resolution. Sodium and glycogen are important contributors
  ([euvolemic body-mass variability](https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/)).
  BIA is hydration-sensitive and is therefore not introduced as a recovery
  likelihood in this phase
  ([hydration and BIA](https://pmc.ncbi.nlm.nih.gov/articles/PMC7144212/)).
- Heavy-tailed observation models are a standard robust alternative when
  occasional outliers can otherwise dominate state estimation
  ([robust Student-t filtering](https://pmc.ncbi.nlm.nih.gov/articles/PMC6891737/)).

## Candidate algorithms

| Method | Benefits | Costs / decision |
| --- | --- | --- |
| Independent full-trajectory Monte Carlo plus likelihood weighting | Direct fit to deterministic BodyCast, conditions jointly on every later weight, simple seeded replay, no path impoverishment | Can suffer weight degeneracy; chosen with ESS diagnostics |
| Sequential Monte Carlo filter | Progressive weighting/resampling and natural online extension | More state and resampling machinery than needed for retrospective bounded gaps; proposal remains the dominant issue |
| Particle filter plus backward smoother | Strong general solution for smoothed paths | Backward kernels and path storage are disproportionate for Phase 14A |
| Multiple-imputation ensemble | Correctly emphasizes multiple plausible histories | Rubin-style pooling targets parameter inference, while BodyCast needs a weighted posterior state ensemble |

Recovery v3 uses **defensive adaptive self-normalized importance sampling over
full trajectories**. A discarded pilot population learns only the marginal
posterior location/spread of the persistent log-nutrition regime. The final
population is sampled from a mixture of that adaptive marginal and the original
prior. It remains retrospective trajectory inference, not a particle filter or
smoother: there is no resampling, backward pass, or duplicated-particle claim.

Adaptive mixture importance sampling is a standard way to reduce mismatch
between proposal and target while retaining evaluable mixture densities
([Cappé et al. 2008](https://doi.org/10.1007/s11222-008-9059-x)). The defensive
prior component follows the same support-preservation principle as defensive
mixture importance sampling. Full AMIS reuse of past samples was not selected:
discarding pilot particles keeps the conditional final-proposal argument and
density accounting substantially simpler. Tempered SMC was also reviewed
([Del Moral, Doucet & Jasra 2006](https://www.stats.ox.ac.uk/~doucet/delmoral_doucet_jasra_sequentialmontecarlosamplersJRSSB.pdf));
without a valid rejuvenation kernel, resampling would only duplicate existing
vacation paths and make nominal ESS look better without increasing unique
trajectory diversity.

## Exact recovery sequence

```text
reconstruct exact resolved anchor with deterministic replay
→ draw and score a prior pilot population
→ fit a regularized one-dimensional log-nutrition proposal
→ sample final regimes from a defensive prior/adaptive mixture
→ sample all macro/activity/structural modes and daily noise from the unchanged prior
→ run deterministic simulator with measuredWeightKg = null
→ use observed post-gap inputs to propagate each candidate
→ score predicted physiological body weight against each measured scale weight
→ normalize log weights with log-sum-exp
→ retain weighted latest-state ensemble and empirical summaries
```

Multiple unknown intervals are handled in chronological order in one trajectory
ensemble. The posterior after gap A is therefore the prior carried into gap B
within each particle.

## Importance target and generative prior

For unknown history `z`, fixed observed inputs `x`, and scale weights `y`, the
target density is

```text
pi(z | y, x) ∝ p(z | pre-gap history, x) * product_t p(y_t | z, x)
```

For v2 prior-SNIS, `q(z) = p(z | pre-gap history, x)` and the prior/proposal
terms cancelled. In v3 let `r` be log nutrition regime, `u` all other regime
variables, donor choices, and daily noise, and `a(r | pilot, y)` the fitted
normal proposal. The final proposal is

```text
q(r,u) = [alpha p(r) + (1-alpha) a(r | pilot,y)] p(u)
alpha = 0.10
```

All nuisance behavior stays distributed as `p(u)` and therefore cancels
exactly. The final generic importance equation is

```text
log w = log likelihood + log p(z) - log q(z)
```

or, after cancelling `p(u)`,

```text
log w = log likelihood + log p(r)
      - log[alpha p(r) + (1-alpha) a(r | pilot,y)]
```

The normal, Bernoulli, singular centered-macro prior, and defensive-mixture
densities are directly tested. Every final particle persists proposal component,
regime, log prior, log proposal, and correction. Pilot particles are never
silently included in the final ensemble.

## Prior distribution and support

The proposal is a documented engineering prior, not a claim about vacation
behavior.

1. Select transition-complete, directly observed donor days before the first
   gap from a configurable recent lookback.
2. Sample one persistent trajectory-level regime before sampling days. It
   contains a nutrition multiplier, centered macro-composition multipliers,
   walking multiplier, activity-exploration flag, strength/no-strength regime,
   and structural no-work regime. Sharing it across the gap gives sustained
   behavioral changes non-negligible probability; independent daily donor
   sampling made such regimes exponentially unlikely.
3. Within that regime, sample a whole donor day with exponentially decaying
   recency weight and a configurable same-weekday preference. A bounded robust
   day-level calorie perturbation preserves realistic within-regime variation.
4. Apply centered log-scale macro shocks in addition to the shared nutrition
   factor. This supports high- and low-carbohydrate composition without forcing
   `4P + 9F + 4C` equality or fixing historical macro ratios.
5. Walking retains empirical support but has a structural exploration mixture.
   If every donor is sedentary, the exploration branch uses a configurable
   positive reference (default 3 km), so zero history is not an absorbing
   state. Strength has explicit no-training and positive-training mixtures.
6. Occupational activity retains donor intervals, including break semantics,
   but has a persistent structural no-work mixture. Therefore a history in
   which every weekday was worked still supports a worker-to-vacation regime.
7. Any actually observed field on a partially missing day wins. Missing
   nutrition fields use the donor vector scaled by the robust median ratio of
   available observed components to their donor components.

Recovery fails when no transition-complete, directly observed donor exists; it
does not silently manufacture a baseline donor.

Initial configurable engineering defaults:

- 42-day donor lookback;
- 14-day recency half-life;
- same-weekday weight multiplier 2;
- 512 particles;
- nutrition log-scale floor 0.18, ceiling 0.45, vacation widening 1.5;
- persistent nutrition-regime log spread 0.4 and macro-composition spread 0.5;
- walking log-scale 0.35;
- activity exploration probability 0.2, positive walking reference 3 km;
- no-strength probability 0.25, strength exploration probability 0.1;
- structural no-work probability 0.25;
- 512 discarded pilot particles and 512 final particles when observations exist;
- pilot likelihood temperature 1.0;
- defensive prior mixture weight 0.10;
- fitted log-nutrition variance inflation 1.5 plus 0.05 prior-variance regularization;
- 90% empirical interval (5th and 95th percentiles).

These values require sensitivity and performance tests and can change under a
new recovery algorithm version without changing deterministic physiology.

## Observation model and no double counting

For particle `i` and observed weight `y_t`, the latent prediction is the
deterministic physiological end weight `mu_it`, reconstructed from Fat,
LeanTissue, glycogen-associated water, baseline ECF, and ECF deviation.

The likelihood is a separately configured Student-t observation model:

```text
y_t | trajectory_i ~ StudentT(nu, location = mu_it, scale = s)
s² = V_recovery * (nu - 2) / nu
```

Thus for `nu > 2` its variance equals `V_recovery`, not the online Kalman
measurement-noise parameter. `V_recovery` is an effective scale-to-physiology
residual: scale error plus day-to-day water/gut variation and deterministic
model mismatch. Published free-living measurements found typical daily body
mass variation around 0.4 kg while scale error was around 0.1 kg
([euvolemic body-mass variability](https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/));
day-to-day BIA studies also report measurable mass and body-water variation
([BIA day-to-day variability](https://pmc.ncbi.nlm.nih.gov/articles/PMC11649400/)).
The initial variance 0.25 kg² (SD 0.5 kg) and `nu = 4` are conservative,
configurable engineering assumptions, not fitted constants or claimed scale
precision.

Candidate physiology always runs with `measuredWeightKg = null`; scale evidence
therefore enters physiological inference exactly once through the external
likelihood. Fat, LeanTissue, glycogen, ECF, and proposal selection are unchanged
by the auxiliary filter. Separately, each candidate replays normal filter
prediction/update steps and stores that coherent auxiliary `WeightFilterState`
in the final state. This avoids leaving the scalar filter stale without counting
its update as another physiological likelihood. Tests compare same-seed runs
with and without observations and verify bit-identical physiological
compartments and proposals while only filter state and posterior weights differ.

BIA body-fat percentage is ignored for recovery in v3 because its hydration-
sensitive error model has not been specified.

## Numerical stability and degeneracy

Joint log weights are sums of Student-t log densities. Normalization uses
log-sum-exp. If every candidate is invalid or non-finite, recovery fails without
persisting a partial run.

For normalized weights `w_i`:

```text
ESS = 1 / sum(w_i²)
normalizedESS = ESS / N
```

Initial configurable diagnostic policy combines three independent signals:

- no weight observations: `prior-only` / `awaiting-observations`;
- normalized ESS: healthy >= 0.5, degenerate < 0.1;
- maximum normalized particle weight: healthy <= 0.05, degenerate > 0.25;
- valid proposal fraction: healthy >= 0.95, degenerate < 0.5.

Any severe signal yields `degenerate`; otherwise any non-healthy signal yields
`degraded`. Diagnostics persist exact ESS, normalized ESS, maximum weight,
valid fraction, invalid-reason counts, threshold reasons, and support warnings.
Every threshold is configurable through the API and is explicitly an
engineering gate, not a calibrated biological boundary. No resampling is
performed: duplicating weighted full trajectories would not create information
or improve effective diversity.

For Phase 14B's future internal contract, `recovered` and `degraded` ensembles
are `allowed-with-quality-label`; `awaiting-observations` is
`prior-predictive-only`; and `degenerate` is `refuse-degenerate` with
`posteriorIntervalsTrustworthy=false`. Phase 14A.2 defines and persists this
contract but does not implement Forecast. “Computationally usable” in the
evaluation below means non-degenerate under all three existing severe gates:
normalized ESS >= 0.10, maximum weight <= 0.25, and valid fraction >= 0.50.
It does not mean scientifically certain or healthy.

## Reproducibility

A small tested 32-bit seeded PRNG is used behind an explicit interface; global
`Math.random()` is forbidden. Same episode inputs, deterministic model version,
`bodycast-recovery-v3`, configuration, source fingerprint, and seed reproduce
the same proposal trajectories, weights, and summaries.

## Persistence and invalidation

Phase 14A persists one recovery-run record containing:

- episode and gap range;
- algorithm version, seed, configuration and hashes;
- SHA-256 source/model/personalization fingerprint;
- lifecycle/quality status and diagnostics;
- posterior summaries;
- the weighted latest-state ensemble needed by Phase 14B.

Full daily sampled paths are regenerated from seed/config/fingerprint when
needed; storing every day of every 90-day particle would add large redundant
JSON. Normal APIs expose summaries, not particle arrays. Internal Forecast code
can load the persisted latest ensemble directly.

Recalculation or recovery recomputes the fingerprint from current inputs,
breaks, work intervals, model version, fixed parameters, and personalization.
Any mismatch makes earlier recovered records stale. Complete deterministic
backfill leaves recovery not required and stale posterior data is not reused.
Writes are transactional and never modify deterministic `DailyModelState`.

## v2 failure diagnosis and strategy decision

The evidence does not support one generic “low ESS” explanation:

- **Insufficient finite prior support:** not observed for body weight in the 48
  stress runs; every truth lay within the sampled prior min/max.
- **Support with small probability:** present; 2/16, 2/16, and 3/16 truths for
  7/14/30 days were only in the sampled outer 1% prior tail.
- **Observation concentration:** dominant as gap/observation count grows. Median
  log-weight SD rises from 7.12 to 10.08 to 11.30 across 7/14/30-day stress
  cases. One canonical weight has ESS 0.4252, eight have 0.1220.
- **Finite-particle error:** affects max weight and endpoints, but 512→2,048
  raises absolute ESS while leaving normalized ESS nearly constant. The 8,192
  reference confirms the target summaries rather than a 512-only artifact.
- **Likelihood too informative relative to proposal:** yes for aggregate energy;
  v2 prior-SNIS had no observation-informed coordinate. The adaptive
  log-nutrition marginal materially improves the central case.
- **Invalid particles:** not causal in the stress panel (minimum valid fraction
  1.0); a single 90-day benchmark proposal was invalid and is reported.

Compared approaches:

| Approach | Result / decision |
| --- | --- |
| v2 prior-SNIS | Exact but canonical repeated-weight ESS 0.0983 at N=512 |
| More prior particles | N=2,048 gives ESS 0.1019; normalized mismatch remains |
| Full regime adaptive mixture prototype | Adapted weakly identified macro/activity modes; p/q variance offset benefit; rejected |
| Tempered/sequential weighting without rejuvenation | Same final weights as SNIS; resampling alone duplicates paths and is not counted as diversity |
| Tempered SMC with MCMC rejuvenation | Defensible but requires a full trace-space kernel/Jacobian design; disproportionate for 7–14 days now |
| PSIS/stabilized weights | Useful diagnostic research ([Vehtari et al. 2024](https://www.jmlr.org/papers/volume25/19-556/19-556.pdf)), but modifying weights changes the estimator and cannot manufacture missing paths; not used |
| Defensive adaptive log-nutrition mixture | Chosen: exact density, original support floor, canonical ESS 0.1220, stable against high-compute reference |

The highest-weight origin diagnostics persist likelihood and p/q correction
separately with nutrition/walking/structural modes. This prevents attributing a
large weight to “good physiology” when it actually came from a large proposal
correction.

## Reference benchmark

The checked-in `npm run benchmark:recovery` harness counts both 512 pilot and
512 final particles when observations exist. On Node 22.14, one representative
single-process run measured:

| Gap | Transitions | Elapsed | Valid | normalized ESS | max weight | status |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 days | 10,240 | 321.5 ms | 512 | 0.2593 | 0.0149 | degraded/usable |
| 14 days | 17,408 | 505.2 ms | 512 | 0.1463 | 0.0271 | degraded/usable |
| 30 days | 33,792 | 1,015.4 ms | 512 | 0.0786 | 0.0485 | degenerate/refuse |
| 90 days | 95,232 | 3,168.5 ms | 511 | 0.0240 | 0.1394 | degenerate/refuse |

The added cost is practical for an explicit retrospective recovery action. A
long gap is still allowed to fail the computational-quality contract.

On the fixed 14-day case, 128/512/2,048 final particles took
327.3/537.8/1,273.5 ms; normalized ESS was 0.1571/0.1463/0.1408 and medians
were 77.0365/77.0029/76.9596 kg. Absolute ESS and max weight improve with `N`,
but normalized ESS does not. Brute force therefore is not used to conceal
proposal mismatch.

For the central seven-day gap followed by eight weights, prior-SNIS at 512 and
2,048 particles produced normalized ESS 0.0983 and 0.1019. Adaptive v3 produced
0.1220 at 512 and 0.1163 at 2,048, with absolute ESS 62.4 and 238.2. The 512
adaptive run took 268.9 ms versus 141.7 ms for prior-SNIS. Four fixed seeds all
remained degraded rather than degenerate (ESS 0.1106–0.1520); median weight
ranged only 77.0002–77.0404 kg.

An 8,192-final + 2,048-pilot reference run took 2.77 s, normalized ESS 0.1142,
and max weight 0.0036. Relative to it, the default 512 run differed by -0.0094
kg at the weight median, -0.0070 kg at the fat median, and 0.000017 kg at the
glycogen median. Interval-endpoint differences were at most 0.0334 kg for
weight and 0.0220 kg for fat in this case. This separates stable posterior
summaries from the still-modest normalized ESS.

One observation gives ESS 0.4252. Eight consistent observations give 0.1220
and an interval 76.8345–77.2022 kg; the outlier case gives 0.1266 and
76.8437–77.2690 kg. Repeated observations add concentration but no longer make
this canonical run degenerate.

## Generative calibration / SBC-style validation

`npm run validate:recovery-calibration` samples each hidden 7/14-day trajectory
from the exact recovery prior, samples four withheld scale observations from
the exact configured Student-t likelihood, and then runs recovery normally.
Weighted posterior ranks are accumulated into ten bins. With 96 deterministic
replications and 256 final particles:

| Quantity | central 50% | high 90% | 95% binomial interval for high |
| --- | ---: | ---: | ---: |
| Body weight | 0.4583 | 0.8750 | 0.7941–0.9270 |
| Fat mass | 0.4479 | 0.8750 | 0.7941–0.9270 |
| Glycogen | 0.3958 | 0.8750 | 0.7941–0.9270 |
| Lean tissue | 0.4583 | 0.8750 | 0.7941–0.9270 |

The weighted-rank Kolmogorov distances from uniform were 0.0700 for weight,
fat, and lean and 0.1198 for glycogen. The panel contained 88 degraded and 8
degenerate finite-particle runs; median normalized ESS was 0.1669 and median
max weight 0.0497. The nominal 0.90 value lies inside the reported binomial
uncertainty. Glycogen central coverage/ranks remain the weakest signal and are
reported as a limitation, not tuned away.

By gap, 7-day draws had median ESS 0.2348, median max weight 0.0415, and only
1/48 degenerate runs; 14-day draws had median ESS 0.1270, median max weight
0.0678, and 7/48 degenerate runs. Thus the default is normally usable for the
central seven-day product case and usually usable/degraded at 14 days, while
the per-run refusal gate remains necessary.

## Adversarial product stress panel

`npm run validate:recovery-support` is a checked-in, deterministic validation
harness rather than a one-off notebook. Its default panel has 24 base scenarios
and two seeds (48 runs), varying gap length (7/14/30 days), calories
(1,900/2,700/3,500 kcal), carbohydrate composition (100/220/380 g), walking
(1/6/14 km), strength (0/75 minutes), work (0/8 hours), and explicit
history-to-gap regime mismatches. It reports 50% and 90% empirical coverage for
body weight, fat mass, and glycogen, every quality status, and every failed
quantity/scenario/seed combination.

These fixed truths are not prior draws, so their inclusion frequency is not a
nominal Bayesian calibration statistic. At 256 particles the final panel reports:

| Quantity | central 50% | high 90% |
| --- | ---: | ---: |
| Body weight | 0.5625 | 0.7708 |
| Fat mass | 0.5625 | 0.7708 |
| Glycogen | 0.1875 | 0.5208 |

It includes 12 worker-to-no-work cases and two sedentary-to-high-activity
cases. Status counts are 11 degraded and 37 degenerate. Every truth was inside
the finite prior weight support; 2/16, 2/16, and 3/16 truths lay beyond the
sampled 99% prior interval for 7/14/30 days. Valid fraction was 1.0 throughout,
so invalid-particle loss is not the cause. Median ESS by gap was
0.0971/0.0507/0.0254, median max weight 0.1406/0.1771/0.3152, and median
log-weight SD 7.12/10.08/11.30. The panel therefore distinguishes broad prior
support from low prior probability and strong repeated-observation
concentration. It remains intentionally harsh and often degenerate.

## Open gaps and evidence levels

An open gap, or a closed gap with no post-gap weight, can produce a uniform
prior-predictive ensemble. Its lifecycle is `awaiting-observations`, never
`recovered`. One weight produces a conditioned posterior but commonly broad and
possibly degenerate. Multiple consistent weights generally add information;
surprising observations may instead reveal proposal mismatch.

## Scientific boundaries and limitations

- Deterministic model parameters and personalization are fixed per particle.
- Production `hold-ecf` remains unchanged. Unknown sodium-related water is not
  reconstructed, so posterior tissue inference may remain biased after unusual
  sodium exposure. Wider trajectory support and robust likelihood do not solve
  that missing compartment forcing.
- Carbohydrate sampling does produce glycogen and glycogen-water uncertainty.
- The empirical prior is user-specific but cannot know that a vacation belongs
  to a genuinely new behavioral regime.
- Posterior particles are inferred, never observed, never baseline donors, and
  never calibration-complete days.
- Phase 14A performs no future forecast, scenario planning, goal probability,
  or target solving.

## Phase 14A acceptance decision

Phase 14A is accepted as a conditional initial-state uncertainty source for a
future Phase 14B only under the persisted downstream quality contract. The
central seven-day case is reproducibly non-degenerate across tested seeds and
particle counts, p/q accounting is exact, SBC-style ranks are broadly coherent,
and deterministic physiology/persistence boundaries are unchanged. This is not
blanket acceptance of every recovery: 30/90-day cases and many deliberately
adversarial regimes remain degenerate and must be refused. Eight of 96 exact
generative runs also crossed the severe finite-particle gate, demonstrating why
per-run diagnostics remain mandatory.

## Phase 14B interface

Phase 14B will load the current, non-stale weighted ensemble of full
`PhysiologicalSimulatorState` values and propagate every particle under explicit
future assumptions. It must not replace that ensemble with a single posterior
mean because the physiological transition is nonlinear.
