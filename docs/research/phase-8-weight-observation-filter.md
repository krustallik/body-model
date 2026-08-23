# Phase 8 — Weight observation / state-space filter

## Scope and sources

This phase treats scale weight as an observation of a latent weight belief. It
does not update Fat, LeanTissue, glycogen, ECF, energy expenditure, or forecasts.

Primary and established references:

- Kalman RE. *A New Approach to Linear Filtering and Prediction Problems*.
  Journal of Basic Engineering. 1960;82(1):35–45.
  https://doi.org/10.1115/1.3662552
- Durbin J, Koopman SJ. *Time Series Analysis by State Space Methods*, local
  level model chapter. Oxford University Press, 2012.
  https://academic.oup.com/book/16563/chapter-abstract/173375018
- Guo P et al. *State Estimation Under Correlated Partial Measurement Losses:
  Implications for Weight Control Interventions*. IEEE Trans Biomed Eng.
  2018;65(5):1041–1052. https://pmc.ncbi.nlm.nih.gov/articles/PMC5726602/
- Hall KD. *Predicting metabolic adaptation, body weight change, and energy
  intake in humans*. Am J Physiol Endocrinol Metab. 2010;298:E449–E466.
  https://doi.org/10.1152/ajpendo.00559.2009
- Hall KD, Chow CC. *Estimating changes in free-living energy intake and its
  confidence interval*. Am J Clin Nutr. 2011;94:66–74.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/
- Turicchi J et al. *Data Imputation and Body Weight Variability Calculation
  Using Linear and Nonlinear Methods in Data Collected From Digital Smart
  Scales*. J Med Internet Res. 2020;22:e17977.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC7519428/

The intervention paper demonstrates that Kalman state estimation naturally
supports noisy and missing weight-related observations. Hall and Chow show that
daily body weight contains realistic water and intake-driven fluctuations and
that repeated observations over time are needed for precise inference. Hall's
physiology model used 0.2 kg as a body-weight measurement-error scale when
weighting model residuals. Smart-scale literature also uses state-space/Kalman
methods for longitudinal missing data, while finding no single universal noise
parameter suitable for every device and context.

## Selected architecture

The selected primitive is a scalar local-level (random-walk plus observation
noise) Kalman filter. It is the smallest model that separates latent belief from
measurement, weights isolated residuals probabilistically, propagates uncertainty
through missing days, and exposes a clean seam for a later physiological model.

A local linear trend state was not selected. A hidden velocity would duplicate
trend already intended to arise from the future Fat + LeanTissue + Glycogen +
GlycogenWater + ECF simulator. An extended Kalman filter is also unnecessary for
this scalar linear observation equation. Later nonlinear physiology can calculate
`predictedWeightKg` externally and provide it as the prior mean.

State:

```text
x = estimatedWeightKg       [kg]
P = varianceKg2             [kg²]
```

Configuration:

```text
Q = processNoiseVarianceKg2PerDay  [kg²/day]
R = measurementNoiseVarianceKg2    [kg²]
```

## Equations

For elapsed time `Δt` days:

```text
x⁻ = predictedWeightKg, when provided by the physiological simulator
   = x, otherwise (local-level random walk)

P⁻ = P + Q × Δt
```

For a valid measured weight `z`:

```text
innovation               y = z - x⁻
innovation variance      S = P⁻ + R
Kalman gain              K = P⁻ / S
posterior mean           x = x⁻ + K × y
posterior variance       P = (1-K)²P⁻ + K²R
```

The last line is the scalar Joseph covariance form. It is algebraically equal
to `(1-K)P⁻` but better preserves non-negative variance in floating point.

When `z = null`, no observation equation is evaluated: `x = x⁻`, `P = P⁻`.
Missing is therefore not zero.

## Initialization

- First valid measurement only: initialize the mean from that measurement and
  variance from `R`; no fake history is required.
- External predicted weight only: initialize the mean from the prediction and
  use configurable initial prediction uncertainty.
- Both: treat the external prediction as the prior and perform a normal Kalman
  measurement update.
- Neither: initialization is rejected.

## Default assumptions

Defaults are deliberately exported and configurable:

```text
R = 0.25 kg²             (residual observation SD = 0.5 kg)
Q = 0.01 kg²/day         (residual process SD = 0.1 kg per sqrt(day))
initial P = 1 kg²        (external prediction SD = 1 kg)
```

Hall's 0.2 kg measurement-error scale corresponds to 0.04 kg² and is a useful
controlled-measurement reference, not a universal smart-scale residual. BodyCast
currently lacks a complete gastrointestinal and fluid predictor, so the default
`R` is intentionally inflated to 0.25 kg². This prevents a single plausible
water/noise excursion from dominating. `Q = 0.01 kg²/day` is a conservative
engineering assumption that allows sustained real movement while keeping the
latent state stable. These are not clinical constants and should later be tuned
or calibrated against device/user residuals after the physiological simulator is
available.

## Worked example

Given posterior `x=80 kg`, `P=0.25 kg²`, `Q=0.01 kg²/day`, one elapsed day,
measurement `z=80.8 kg`, and `R=0.04 kg²`:

```text
x⁻ = 80.000000 kg
P⁻ = 0.25 + 0.01 = 0.260000 kg²
y  = 80.8 - 80 = 0.800000 kg
S  = 0.26 + 0.04 = 0.300000 kg²
K  = 0.26 / 0.30 = 0.866666667
x  = 80 + K×0.8 = 80.693333333 kg
P  = (1-K)²×0.26 + K²×0.04 = 0.034666667 kg²
```

The golden test verifies these values directly.

## Behavioral diagnostics with defaults

For `80.2, 80.1, 80.3, 82.0, 80.4`, posterior estimates are approximately:

```text
80.200, 80.149, 80.203, 80.711, 80.635 kg
```

The isolated 82 kg measurement influences the belief but does not replace it;
there is no arbitrary outlier deletion.

For `80.0, 79.8, 79.6, 79.4, 79.2`, posterior estimates are approximately:

```text
80.000, 79.898, 79.792, 79.681, 79.564 kg
```

The sustained downward evidence moves the latent belief monotonically. The
mirrored upward series behaves symmetrically.

## Future physiological integration

The future simulator should first compose predicted scale weight from Fat,
LeanTissue, Glycogen, GlycogenWater, and ECF. That value becomes `x⁻` through
`predictedWeightKg`. The Kalman update then handles the residual between the
physiological prediction and the measured scale weight. Consequently, modeled
short-term water changes are retained in the prediction rather than blindly
smoothed away as noise.
