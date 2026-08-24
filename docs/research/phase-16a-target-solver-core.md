# Phase 16A — Target Solver Core

## Scope and scientific interpretation

The target solver answers an inverse planning question by repeatedly evaluating the existing Phase 14B forward Forecast. It changes a future planning assumption; it does not estimate physiology, calibrate personalization, persist a plan, or make a clinical recommendation.

V1 supports only the extensible target union member `weightKg`. Fat mass is deferred because it needs separate product semantics and validation. Consumer-BIA body-fat percentage is explicitly deferred: it is an observation, not interchangeable with latent model-derived tissue composition.

## Why the full forward model is inverted

Body-weight response is dynamic. Energy expenditure adapts as tissue, dynamic RMR, adaptive thermogenesis, activity cost, glycogen and associated water change. Hall et al. describe why accurate weight trajectories require dynamic energy-imbalance modeling and why response times and outcomes vary with the starting state [1, 2]. Consequently, the solver contains no fixed energy-per-kilogram conversion and no linear fallback.

Two people with the same current scale weight, target and horizon can receive different modeled candidates because their latent fat/lean tissue, glycogen, AT, RMR, activity and personalization differ. These are properties of the existing Forecast and are not duplicated in this module.

## Identifiable v1 control

Allowing calories and multiple activity dimensions to vary together produces a family of solutions to one scalar target. Phase 16A avoids presenting that underdetermined family as a unique answer. It solves only:

`daily-calorie-center`, with caller-supplied activity held fixed.

The scenario must be `fixed` or `target-centered` and must contain a complete default future day. Recent-behavior mode and by-date nutrition overrides are rejected because they do not define an unambiguous scalar nutrition transformation. Occupation (including breaks and work walking), outside-work walking, walking speed, strength and stochastic adherence settings are deep-copied unchanged.

## Explicit nutrition adjustment policy

The only v1 policy is `proportional-template`. For reference calories `C0`, explicit reference macros `(P0, F0, H0)`, and candidate calories `C`:

```text
s = C / C0
(calories, protein, fat, carbs) = (C, s·P0, s·F0, s·H0)
```

This is a planning assumption, not physiological truth. Nothing is inferred from historical missing nutrition. Optional caller constraints on every macro are checked after transformation. Violating candidates are rejected with a reason; they are never clamped. Calorie bounds are caller constraints, not clinical limits.

## Objective and predictive uncertainty

The v1 numerical objective is:

```text
f(C) = median[terminal latent physiological weight | scenario(C)] - targetWeightKg
```

The median is robust, is already a first-class Forecast statistic, and does not make a tail-probability policy decision that belongs in Phase 16B. The final result retains the full Forecast, including mean, 50% interval, 90% interval, starting-state quality and numerical-quality classification.

Target attainment is an internal equality-band diagnostic:

```text
P(target - tolerance <= terminal weight <= target + tolerance)
```

Phase 16B supersedes this temporary Phase 16A approximation. The solver now consumes internal equally weighted terminal samples and computes direction-specific empirical probabilities directly; the public Forecast response still contains summaries only. See `phase-16b-target-feasibility-and-robustness.md`.

Forecast uncertainty (predictive interval width) and solver numerical uncertainty (residual, calorie bracket width, resolution and final verification stability) remain separate.

## Common random numbers

Every search candidate uses the same request seed, horizon, starting posterior, path count, stochastic scenario structure and Forecast configuration. The only changed field is the proportional nutrition center. Phase 14B initializes its seeded stream from that seed and consumes random draws in the same path/day order. Thus starting-particle resampling, nutrition deviations, walking deviations and adherence events align path-for-path across candidates. This is the common-random-number strategy: paired candidate differences contain substantially less unrelated Monte Carlo noise. CRN is a standard variance-reduction technique for comparing simulated alternatives [3, 4]. The final higher-path evaluation uses the same seed and domain structure but necessarily has a larger ensemble.

## Bounded search

The deterministic algorithm is:

```text
validate explicit bounds and template
→ evaluate an evenly spaced coarse grid (including both bounds)
→ reject macro-invalid candidates
→ classify response as monotonic / approximately monotonic / non-monotonic
→ detect a sign-changing target bracket
→ refine a valid bracket by bisection until target or calorie resolution
→ for non-monotonic data, use deterministic bounded local grid refinement
→ rerun the best candidate with finalPathCount
→ if ensemble strengthening moves the median, apply up to four bounded CRN secant corrections
```

Bisection is preferred over an unguarded secant step because it preserves caller bounds and the bracket under mild residual Monte Carlo noise. Brent-style interpolation can reduce evaluations for smooth functions, but offers less value at the current Forecast cost/noise level. Coarse bounded evaluation also detects practical monotonicity instead of assuming it. General stochastic optimization is unnecessary for this one-dimensional control; sample-average and simulation-optimization literature nevertheless supports fixed samples/CRN for stable comparisons [4, 5].

If the target is outside both endpoint outcomes, the result is `not-bracketed`; bounds are never expanded. A best candidate exactly at a caller bound is `solved-at-boundary`. Non-monotonicity is exposed in quality diagnostics. Maximum evaluations, endpoint tolerance, calorie resolution and monotonicity tolerance are engineering settings, not physiological constants. Internal decimals are retained for reproducibility; product rounding is deferred to Phase 16C.

Defaults are 5 coarse points, 24 maximum search evaluations, 10 kcal candidate resolution, 0.05 kg endpoint tolerance, 0.02 kg monotonicity tolerance, 128 search paths and 512 final paths. Long-horizon numerical limitations are propagated unchanged from Forecast. If the stronger final run moves the endpoint, a bounded local secant correction uses the observed search slope and is rechecked at `finalPathCount`. If four corrections still leave tolerance, the result reports `final-verification-outside-tolerance`; it does not hide the shift.

## State quality, provenance and side effects

The application service delegates state loading to Phase 14B. Deterministic, recovered and degraded states are allowed, with provenance retained. Awaiting, degenerate, missing/stale or invalid recovery states remain blocked exactly as Forecast reports; the solver cannot substitute a median, MAP particle or pre-gap state.

The solver version is `bodycast-target-solver-v1`. Model, Forecast and recovery versions come from the evaluated Forecast. Same state/fingerprints, request, seed and configurations produce the same trace and result. The service is read-only and creates no model, history, recovery, profile, personalization, nutrition or work rows.

Goal dates are local calendar dates. Horizon calculation uses validated calendar-day indices after determining the latest completed date in the episode timezone (`Europe/Bratislava`), avoiding elapsed-millisecond division across CET/CEST transitions.

## Validation and limitations

Tests include analytic search functions, exact hits, boundaries, unreachable targets, non-monotonic response, evaluation limits, macro rejection, DST transitions, blocked initial states, aligned CRN streams and a full deterministic forward → inverse → forward recovery. That synthetic inverse test also observes changes in tissue, glycogen, dynamic RMR and AT, demonstrating use of the full physiology rather than a static conversion.

The benchmark script measures 30/90/180/365-day solves with the production defaults and reports evaluations, runtime, hidden-control recovery, endpoint residual and Forecast numerical quality. Runtime is synchronous in Phase 16A; background execution is explicitly deferred.

Phase 16B owns feasibility, robustness, calibration and decision semantics. Phase 16C owns public API, persistence decisions, safety/product wording and UI. Phase 16A emits a modeled hypothetical scenario, never “you should eat” guidance.

## Primary sources

1. Hall KD et al. *Quantification of the effect of energy imbalance on bodyweight*. Lancet. 2011. https://doi.org/10.1016/S0140-6736(11)60812-X
2. Hall KD. *Predicting metabolic adaptation, body weight change, and energy intake in humans*. Am J Physiol Endocrinol Metab. 2010. https://doi.org/10.1152/ajpendo.00559.2009
3. Kleinman NL, Spall JC, Naiman DQ. *Simulation-based optimization with stochastic approximation using common random numbers*. Management Science. 1999. https://doi.org/10.1287/mnsc.45.11.1570
4. Nelson BL, Matejcik FJ. *Using common random numbers for indifference-zone selection and multiple comparisons in simulation*. Management Science. 1995. https://doi.org/10.1287/mnsc.41.12.1935
5. Kleywegt AJ, Shapiro A, Homem-de-Mello T. *The sample average approximation method for stochastic discrete optimization*. SIAM J Optim. 2002. https://doi.org/10.1137/S1052623499363220
6. Charnes A, Cooper WW. *Chance-constrained programming*. Management Science. 1959. https://doi.org/10.1287/mnsc.6.1.73
