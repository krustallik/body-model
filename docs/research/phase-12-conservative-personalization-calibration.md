# Phase 12 — Conservative personalization and calibration

## Scope

This phase adds a pure deterministic calibration layer around the Phase 11
simulator. It fits at most two residual parameters and does not persist them,
forecast future dates, alter the fixed physiological constants, or infer a
separate food-intake correction.

## Scientific and statistical sources

- Hall KD. *Estimating changes in free-living energy intake and its confidence
  interval*. Am J Clin Nutr. 2011;94:66–74.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/
  Daily longitudinal weights over periods longer than 28 days were needed in
  the authors' free-living simulations to estimate energy-intake change with a
  95% interval narrower than 300 kcal/day. This supports a minimum time span,
  but not direct transfer of that precision to BodyCast expenditure fitting.
- Hall KD. *Predicting metabolic adaptation, body weight change, and energy
  intake in humans*. Am J Physiol Endocrinol Metab. 2010;298:E449–E466.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
  The validated mechanistic model demonstrates why longitudinal weight is an
  integrated consequence of intake, expenditure, tissue, glycogen, and fluid
  dynamics rather than a direct daily expenditure measurement.
- Hall KD et al. *Quantification of the effect of energy imbalance on
  bodyweight*. Lancet. 2011;378:826–837.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/
- Raue A et al. *Structural and practical identifiability analysis of partially
  observed dynamical models by exploiting the profile likelihood*.
  Bioinformatics. 2009;25:1923–1929.
  https://pubmed.ncbi.nlm.nih.gov/19505944/
  A unique mathematical mapping does not guarantee that noisy finite data can
  estimate each parameter. Flat profiles and correlated parameter directions
  are practical non-identifiability diagnostics.
- White A et al. *The limitations of model-based experimental design and
  parameter estimation in sloppy systems*. PLoS Comput Biol. 2016.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC5140062/
  Model discrepancy limits how literally fitted biological parameters may be
  interpreted, even when a numerical fit is good.
- Burrows TL et al. *Validity of dietary assessment methods when compared to
  the method of doubly labeled water*. Front Endocrinol. 2019.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6928130/
  Most included adult studies found self-reported energy under-reporting, with
  large method- and person-dependent variation.
- Shcherbina A et al. *Accuracy in wrist-worn, sensor-based measurements of
  heart rate and energy expenditure in a diverse cohort*. J Pers Med. 2017.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC5491979/
  Consumer devices were substantially less accurate for energy expenditure
  than for heart rate, supporting a bounded Activity correction but not an
  unconstrained one.
- Frankenfield D et al. *Comparison of predictive equations for resting
  metabolic rate in healthy nonobese and obese adults*. J Am Diet Assoc. 2005.
  https://pubmed.ncbi.nlm.nih.gov/15883556/
  Mifflin–St Jeor was the most reliable reviewed equation but still had
  noteworthy individual error; a residual correction is plausible but must not
  be called measured metabolism.
- Tashman LJ. *Out-of-sample tests of forecasting accuracy: an analysis and
  review*. Int J Forecasting. 2000;16:437–450.
  https://doi.org/10.1016/S0169-2070(00)00065-0
  Time-series evaluation should preserve chronology; random splitting leaks
  future information and does not represent deployment.

## What weight can and cannot identify

The two fitted expenditure terms enter a day as:

```text
effectiveCorrection(t)
  = personalOffsetKcalPerDay
  + rawNetActivity(t) * (activityCalibration - 1)
```

If Activity is constant, only this sum is visible to the energy-balance model.
The intercept and multiplier are structurally confounded. Varying Activity can
make them structurally distinguishable, but finite noisy weight data may still
leave a practical ridge. Weight is also an integrated, lagged response: fluid,
glycogen, tissue partitioning, and measurement error can dominate the small
daily tissue signal.

Even a well-identified numerical correction is not a direct measurement of
metabolism. A mismatch can come from unlogged food, portion errors, Activity
error, initial BIA state, incomplete water/sodium modeling, RMR prediction
error, or adaptive-thermogenesis mismatch. In particular, systematic intake
under-reporting and systematic expenditure over-prediction have similar weight
effects. Phase 12 deliberately does not add an intake-calibration parameter;
weight alone would not reliably distinguish it from the allowed expenditure
terms.

## Parameter semantics and simulator integration

Defaults are:

```text
personalOffsetKcalPerDay = 0
activityCalibration = 1
```

`activityCalibration` multiplies the single sum of walking, strength, and
occupational net Activity exactly once. `personalOffsetKcalPerDay` is then added
once as an **effective residual expenditure correction**. Positive offset means
the longitudinal record behaves as if expenditure were higher than the fixed
model predicts; it does not mean that measured metabolism is higher.

The simulator now evaluates:

```text
personalized ordinary expenditure
  = dynamic RMR
  + TEF
  + raw net Activity * activityCalibration
  + mean adaptive thermogenesis
  + personalOffsetKcalPerDay
```

This expenditure enters `intake - expenditure` before glycogen energy and the
implicit Fat/LeanTissue remodeling closure are solved. Therefore the existing
daily chemical-energy identity remains exact. The unpersonalized expenditure
and raw Activity remain separately observable in diagnostics.

## Observation objective

Calibration uses raw measured scale weight through the existing one-step
Kalman innovations. It does not fit to the filter posterior, so a measurement is
never used both to create a target and to smooth that same target.

For each measured day `t`, Phase 12 first defined a Gaussian innovation
likelihood:

```text
v_t = measuredWeight_t - predictedPhysiologicalWeight_t
S_t = priorFilterVariance_t + measurementNoiseVariance

NLL_t = 0.5 * [log(2*pi) + log(S_t) + v_t^2 / S_t]
```

Phase 12.1 replaces the production **offline calibration objective** with the
documented variance-matched Student-t likelihood while retaining this Gaussian
mode for comparison. See
`phase-12-1-robust-calibration.md`. The online Weight Observation Filter remains
Gaussian and unchanged. A missing weight advances physiology and prediction
variance but contributes no likelihood term; observation noise is still fixed.

## Priors, bounds, and deterministic optimization

The regularized training objective is:

```text
loss = sum(NLL_t)
     + 0.5 * (personalOffset / 200 kcal/day)^2
     + 0.5 * ((activityCalibration - 1) / 0.25)^2
```

These are zero-centered Gaussian-prior-style engineering scales. They express
that the scientific defaults are preferred, not that population parameter
distributions have been measured with these exact standard deviations.

Default hard bounds are:

```text
-500 <= personalOffsetKcalPerDay <= 500
0.5 <= activityCalibration <= 1.5
```

The offset range is intentionally wider than the commonly cited approximate
10% individual RMR prediction error while rejecting implausible multi-thousand
kcal corrections. The Activity range acknowledges large individual device/MET
error but prevents an unconstrained multiplier. Both are configurable policy.
An optimum within 1% of either range edge emits `parameter-at-bound` and is not
accepted as trustworthy.

No optimizer dependency or randomness is used. Offset-only fitting evaluates a
13-point bounded grid and performs 12 deterministic half-step refinements. The
two-parameter fit evaluates a 13 by 13 grid and then a deterministic 3 by 3
local pattern while halving both steps for 12 iterations. Ties prefer the point
closer to defaults.

## Staging and data gates

The defaults are conservative and configurable:

| Stage | Required observed weights | Observation span | Fitted parameters |
|---|---:|---:|---|
| A | fewer than 20, or <28 days | — | none |
| B | at least 20 | at least 28 days | offset only |
| C candidate | at least 35 | at least 56 days | offset + Activity multiplier |

Stage A is grounded in Hall's finding that even daily weights need more than 28
days for useful energy inference. Counts prevent a sparse pair of endpoint
weights from passing solely because the calendar span is long. Stage C is a
deliberately stricter engineering requirement because two correlated parameters
need more information than the one-dimensional Hall example.

Stage C additionally requires, on training days:

```text
Activity SD >= 75 kcal/day
Activity coefficient of variation >= 0.20
```

These thresholds are scale and relative excitation checks, not clinical
cutoffs. Passing them is necessary but not sufficient. Around the fitted point,
the engine probes `activityCalibration +/- 0.1` while compensating offset by
`-/+ 0.1 * meanActivity`. If the regularized mean loss rises by no more than
0.001 per observation, the solution is marked ridge-like and calibration falls
back to offset-only. Synthetic tests show why: rapidly alternating Activity can
have a high CV yet average out into an offset-like cumulative trajectory,
whereas sustained Activity changes create distinguishable slopes/curvature.

## Chronological validation and acceptance

The last 20% of weight observations, with at least five observations, form a
chronological holdout. Earlier observations fit parameters. Simulation still
runs continuously from the fixed initial state through validation; no state is
reinitialized at the split and validation observations do not influence the
physiological compartments.

A candidate is accepted only when:

1. it passes its stage and identifiability gates;
2. no estimated parameter is at a bound;
3. holdout mean normalized innovation squared improves over defaults by at
   least both 2% and 0.01 absolute.

If a two-parameter candidate fails, the independently optimized offset-only
candidate is evaluated. If that also lacks holdout support, exact defaults are
returned. Training improvement alone is never sufficient.

## Missing data and episode validity

- Missing measured weight: the complete physiological day advances and does
  not contribute an observation term.
- Missing calories, macros, Activity inputs, or required sodium: the day is not
  simulatable, so the episode returns `invalid-history`; later states cannot be
  manufactured.
- ECF policy remains explicit and fixed for the calibration episode.
- Dates retain the simulator's strict real, consecutive, chronological policy.
- Initial body composition and all scientific episode parameters are fixed once;
  BIA is not reinitialized from daily observations.

## Known limitations

The result is a conservative effective correction for the supplied history,
not causal attribution. A food-error adversarial test deliberately generates
weight with correct expenditure but supplies calories 200 kcal/day too low; the
engine fits a negative expenditure offset. This is expected and documents the
fundamental confounding rather than hiding it. Independent intake biomarkers,
indirect calorimetry, doubly labelled water, or designed Activity interventions
would be needed for stronger causal identification.
