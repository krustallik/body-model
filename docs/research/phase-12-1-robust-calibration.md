# Phase 12.1 — Robust offline personalization calibration

## Scope and evidence

This phase changes only the likelihood used by the deterministic, offline
parameter fit. It does not alter the online Gaussian Weight Observation Filter,
physiology, parameter bounds, priors, staging, chronological validation, or
identifiability gates.

Relevant sources:

- Lange, Little, and Taylor, *Robust Statistical Modeling Using the t
  Distribution*, JASA 1989, develops Student-t likelihoods as a practical
  robust alternative to Gaussian errors and discusses estimation and
  diagnostics: https://doi.org/10.1080/01621459.1989.10478852
- Aravkin, Burke, and Pillonetto, *Robust and Trend-Following Student's t
  Kalman Smoothers*, SIAM Journal on Control and Optimization 2014, applies
  heavy-tailed Student-t penalties to state-space innovations while preserving
  model covariance structure:
  https://doi.org/10.1137/130927466
- Huber, *Robust Estimation of a Location Parameter*, Annals of Mathematical
  Statistics 1964, establishes the quadratic-center/linear-tail M-estimator:
  https://doi.org/10.1214/aoms/1177703732
- Aravkin et al., *Robust identification of nonlinear state-space models under
  Student's t-distributed uncertainties*, Neurocomputing 2019, uses a
  Student-t likelihood for robust dynamical-system parameter identification:
  https://doi.org/10.1016/j.neucom.2018.10.084

These sources support the architecture and robustness family. The exact
degrees of freedom and regression limits below are explicit BodyCast
engineering policy, not clinical constants.

## Why Gaussian NLL was sensitive

For innovation `e` and innovation variance `V`, Gaussian negative
log-likelihood contains `e² / (2V)`. Its score grows linearly without bound, so
one large but finite scale reading can exert disproportionate leverage on the
two global calibration parameters. In the regression episode, adding one
retained `+2.5 kg` measurement moved the Gaussian fit from
`(+118.916829 kcal/day, 0.8813273)` to
`(+71.634928 kcal/day, 0.9295858)`.

This is an offline objective issue. Replacing the runtime Kalman measurement
update would change online state semantics and is outside this phase.

## Alternatives considered

| Objective | Near zero | Large residual | Interpretation and trade-off |
|---|---|---|---|
| Gaussian NLL | Quadratic | Quadratic; unbounded influence | Proper, efficient likelihood under Gaussian data and simplest optimization, but fragile under contamination. |
| Huber loss | Quadratic | Linear; bounded but non-redescending score | Convex and stable. The cutoff is another tuning constant, and a bare Huber penalty is not the same explicit observation distribution as the innovation model. |
| Student-t NLL | Approximately quadratic | Logarithmic; score tends back toward zero | Proper heavy-tailed likelihood with continuous, nonzero influence and a directly reportable tail weight. It is non-convex, but BodyCast's small bounded deterministic grid/refinement avoids stochastic optimizer instability. |

Student-t is the production default. Gaussian remains configurable for
scientific comparison and regression testing. Huber is not exposed because it
would add a second production tuning policy without a demonstrated advantage
here.

## Exact likelihood and variance semantics

The existing one-step Kalman calculation supplies:

```text
e_t = measuredWeight_t - priorPredictedWeight_t
V_t = priorFilterVariance_t + measurementNoiseVariance
```

`V_t` remains the intended innovation **variance**. Student-t scale squared is
not variance when degrees of freedom `nu` are finite, so BodyCast converts it:

```text
s_t² = V_t * (nu - 2) / nu
V_t  = s_t² * nu / (nu - 2), nu > 2
```

The per-observation production loss is:

```text
NLL_t = logGamma(nu / 2)
      - logGamma((nu + 1) / 2)
      + 0.5 * log(nu * pi * s_t²)
      + ((nu + 1) / 2) * log(1 + e_t² / (nu * s_t²))
```

The regularized training objective remains:

```text
sum_t NLL_t
+ 0.5 * (personalOffset / 200)^2
+ 0.5 * ((activityCalibration - 1) / 0.25)^2
```

The priors were not retuned: they encode independent preference for the
scientific defaults, whereas the likelihood change models contaminated
observations. Retuning them to improve one synthetic case would confound these
roles.

## Degrees of freedom and diagnostics

The configurable default is `nu = 5`; Phase 12.1 does not estimate it. Values
near 2 have extremely heavy tails and unstable variance semantics; increasing
`nu` makes the likelihood progressively more Gaussian. Five is a conservative
middle choice with finite variance and finite fourth moment, while still
strongly reducing isolated multi-sigma leverage. Sensitivity can be studied by
configuring a fixed alternative, but production does not add per-user fitting.

For diagnostics only, each observation reports:

```text
absoluteStandardizedInnovation = abs(e_t) / sqrt(V_t)
observationWeight = 1 / (1 + e_t² / (nu * s_t²))
```

The weight is continuous, equals 1 at zero, and approaches 0 without ever
deleting an observation. It is a relative tail-influence diagnostic, **not** an
outlier probability. Calibration also reports the largest standardized
innovation and minimum observation weight across the accepted candidate's
training and validation evaluations.

## Regression policy and results

For one isolated `+/-2.5 kg` reading, the fit must move by less than
`10 kcal/day` in offset and `0.01` in Activity multiplier relative to the same
clean episode. These correspond to 5% and 4% of the unchanged prior scales:
large enough to avoid a microscopic test-only tolerance, but small enough that
one scale reading cannot rewrite a longitudinal fit. Two same-direction
outliers use limits of `15 kcal/day` and `0.015`.

Observed deterministic fits:

| Episode | Offset kcal/day | Activity multiplier | Movement from clean |
|---|---:|---:|---:|
| Robust clean | 120.381673 | 0.8796997 | — |
| Robust +2.5 kg | 119.120280 | 0.8810018 | 1.261393 / 0.0013021 |
| Robust -2.5 kg | 121.683757 | 0.8783569 | 1.302083 / 0.0013428 |
| Robust two +2.5 kg | 116.312663 | 0.8835856 | 4.069010 / 0.0038859 |
| Gaussian clean comparison | 118.916829 | 0.8813273 | — |
| Gaussian +2.5 kg comparison | 71.634928 | 0.9295858 | 47.281901 / 0.0482585 |

The clean robust fit remains close to the synthetic truth of
`(+120 kcal/day, 0.88)`. A persistent 42-day synthetic bias of
`-180 kcal/day` is still learned as `-181.803385 kcal/day`, demonstrating that
repeated coherent evidence is not treated as one outlier. The long, genuinely
changing synthetic trajectory also continues to recover both parameters.

## Preserved behavior and limitations

- Measurements are retained; there is no residual threshold or hard deletion.
- Missing weights contribute no likelihood and are not classified as outliers.
- Gaussian normalized innovation squared remains the existing conservative
  chronological holdout acceptance metric. Robust optimization does not force
  personalization when defaults lack meaningful validation improvement.
- History, Activity-excitation, ridge, bounds, and staged-calibration gates are
  unchanged. A robust objective cannot create identifiability.
- A persistent intake-reporting error remains confounded with expenditure
  correction. Heavy tails protect against isolated contamination, not model
  misspecification, long runs of biased measurements, regime changes, or causal
  ambiguity.
- Fixed `nu = 5` is an engineering compromise. A materially different device or
  observation process requires renewed validation rather than silent tuning.
