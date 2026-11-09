# Adaptive scale-residual challenger

## Status

Implemented and tested in `research/physiology-adaptation/methods.ts` as an
isolated, disabled challenger. The active Forecast and Goal paths do not call
it. No database schema or persisted historical forecasts are available to
supply its required inputs safely.

## Method

The estimator is intended to consume residuals from 1-day forecasts issued
before their target weighing arrived. Its rolling-origin evaluation
reconstructs those predictions counterfactually from inputs available at each
origin; they were not persisted historical forecasts and must not be described
as forecasts actually issued by the serving system. The as-of runner excludes
outcomes not yet received and targets after the local issue date. It maintains
a slow exponentially weighted residual level (21-day time constant) and a
fast residual deviation (3-day time constant). The future total-scale
correction is `slow + fast * exp(-horizonDays / 3)`, bounded to ±2 kg.

This is an additive correction to a total-scale forecast only. It never changes
fat, lean, glycogen, fluid, nutrition, or energy state. It reports that
uncertainty calibration is unavailable; its correction must not be used to
claim calibrated prediction intervals.

## Why it is not active

The isolated causal rolling-origin evaluation found mixed results: the
challenger did not improve the one-day horizon, had only small-to-moderate
benefit on longer horizons, remained behind the last-known-weight baseline,
and did not establish calibrated uncertainty. The early segment had too few
eligible forecast errors to adapt; the later segment was short. Therefore it
does not meet the project criterion for replacing the active forecast. The
runner uses the legacy `calculateEpisodeHistory + simulateDays` replay and does
not replay the V7 daily runtime, so these metrics are not evidence of V7
forecast accuracy.

BodyCast does not persist as-issued forecast residuals with their issue and
outcome receipt times. Reconstructing them from retrospective physiological
state errors would change the candidate's meaning and could introduce delayed
input leakage. Until suitable causal residual evidence exists, only the
isolated estimator and its deterministic tests are retained; serving behavior
is unchanged. No Forecast/Goal, V7, database, migration, or release-gate code
was changed for this challenger.
