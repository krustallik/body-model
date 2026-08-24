# Phase 16B — Target feasibility, robustness, and probability

## Scope and scientific boundary

The solver answers a conditional model question: under the supplied scenario and caller bounds, which daily calorie center makes the terminal *median* weight approach the target? It is neither a prescription nor a guarantee. A numerical root, feasibility under caller constraints, predictive support, Monte Carlo precision, and biological truth are different concepts.

No clinical calorie or macro limits are embedded. No physiology equation, `src/model` source, database schema, Goal API, or Goal UI is changed.

## Repository checkpoint

Phase 16B was completed from the uncommitted Phase 16A/16B worktree above local checkpoint `6e29a0f3efe8e59fbabc4b5d1d3a370703871e30`. That checkpoint is intentionally empty: its tree `23378073dc7cedafb69708431a5cd889aa39669c` is identical to parent/origin commit `1cc34fb0af9c5d6956f68a42e1039e63694f26fe`. Accepted Phases 13–15.1 therefore reside in `1cc34fb` and earlier history; the solver work remains uncommitted and unpushed.

## Research basis

- Charnes and Cooper introduced chance-constrained planning as satisfaction of constraints at specified probability levels. BodyCast reports probabilities diagnostically and deliberately sets no policy threshold: <https://doi.org/10.1287/mnsc.6.1.73>.
- Kleinman, Spall, and Naiman describe common random numbers as variance reduction for differences in simulation optimization. Every candidate within a solve uses the same seed, including the local `C* ± Δ` panel: <https://doi.org/10.1287/mnsc.45.11.1570>.
- Wilson's score construction supplies the 95% interval for a binomial proportion used here to describe numerical Monte Carlo uncertainty: <https://doi.org/10.1080/01621459.1927.10502953>. Brown, Cai, and DasGupta's finite-sample comparison supports Wilson over the unstable Wald interval: <https://doi.org/10.1214/ss/1009213286>.
- The empirical-distribution foundation traces to Dvoretzky, Kiefer, and Wolfowitz, *Annals of Mathematical Statistics* 27 (1956), 642–669. BodyCast does not currently expose or label a DKW band; it uses the exact observed path fraction for the requested event.
- The dynamic energy-balance context remains Hall and Chow's validated physiological planning model, while BodyCast retains its own documented simulator scope: <https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/>.

These sources motivate architecture and numerical diagnostics; they do not validate an individual outcome or create a medical policy.

## Authoritative empirical probability

The old five-quantile piecewise-linear CDF has been retired. It could distort tails, narrow bands, skewness, and multimodality. `runForecastWithInternalArtifacts` now returns the ordinary public `ForecastResult` plus internal initial/terminal weight samples. `runForecast` unwraps only `result`, so particle arrays do not enter the public Forecast API.

Forecast paths are stratified-resampled to equal weights. Invalid paths are excluded consistently with Forecast summaries. With `N` valid terminal weights:

- loss: `p̂ = count(W_T <= target) / N`;
- gain: `p̂ = count(W_T >= target) / N`;
- maintenance: `p̂ = count(|W_T - target| <= goalTolerance) / N`.

Direction is based on initial physiological weight, never calorie control. A target below `initial - goalTolerance` is loss, above `initial + goalTolerance` is gain, otherwise maintenance. `goalAttainmentToleranceKg` defaults to 0.5 kg as an explicit engineering configuration. It is distinct from `targetToleranceKg` (default 0.05 kg), which controls numerical root acceptance.

The result reports event definition, direction, successes, valid sample count, probability, and a 95% Wilson interval. The Wilson interval is uncertainty in the computed Monte Carlo proportion, not predictive/physiological uncertainty. The forecast p05–p95 interval remains the latter. No probability is converted to “safe”, “good”, or “feasible”. A median-matched loss target will commonly have about 50% probability below target; that is expected.

## Feasibility dimensions and status

The result retains separate dimensions:

- caller constraint validity and whether any macro-valid candidate exists;
- target bracket inside the caller's calorie bounds;
- final high-path convergence and residual;
- terminal p05–p95 width;
- deterministic/recovered/degraded initial-state provenance;
- Forecast numerical classification, including `limited-long-horizon`;
- response monotonicity and the full non-persisted evaluation trace with stage/path count;
- targeted high-path confirmation when the cheap CRN curve appears materially reversed;
- caller-boundary flag/reason;
- local CRN sensitivity and practical search resolution.

Statuses are `feasible`, `feasible-at-boundary`, `numerically-limited`, `not-bracketed`, `constraint-limited`, `forecast-unreliable`, and `search-failed` in the feasibility object, with existing initial-state blocks propagated separately. `not-bracketed` means only “not crossed within these modeled scenario/control bounds”; it is not biological impossibility. A cheap-search root is never sufficient: the final-path re-evaluation and bounded final-quality refinements control `solved`; otherwise the result is `numerically-limited`.

## Local robustness and resolution

After selection the solver evaluates `C* - Δ` and `C* + Δ`, default `Δ = 100 kcal/day`, using the same seed and final path count. When both are valid and locally ordered:

`localSensitivityKgPer100Kcal = 100 * (median(C*+Δ)-median(C*-Δ)) / (2Δ)`.

This is a local derivative of the full dynamic simulator, not a universal kcal/kg conversion. A one-sided panel is `boundary-limited`; invalid or reversed panels are `unavailable`. Practical numerical resolution is the coarsest supported scale from configured candidate spacing, the remaining bracket width, target-tolerance-equivalent control width, and search-to-final Monte Carlo median shift converted through the local slope. The component diagnostics remain visible; the result does not claim one-kcal precision. A diagnostic marks neighboring candidates effectively equivalent when their endpoint difference is smaller than the larger of root tolerance and 10% of terminal p05–p95 spread. That 10% comparison is an explicitly documented engineering heuristic, not a hypothesis test or biological threshold.

## Apparent non-monotonicity

The cheap search curve uses an explicit engineering reversal tolerance (`monotonicityToleranceKg`, default 0.02 kg). When it appears non-monotonic, only the points forming material reversals are re-evaluated with aligned CRN at an explicit higher path count (`monotonicityConfirmationPathCount`, default at least 512 and four times search paths). If ordering returns, the result records `monte-carlo-artifact` and may proceed. If the reversal persists it returns top-level/feasibility `non-monotonic`; if confirmation cannot be completed it is `numerically-limited`. Candidate rejections inside a suspicious span are reported as a constraint discontinuity rather than a physiological claim.

## Validation policy

`validate:target-solver` performs independent-seed stability, 64/256 through 256/1024 path-count sensitivity, a 512/2048 high-compute solve, 30/60/90/180/365-day bound curves, and exact-model probability bins near 0.2/0.5/0.8 with independent generated truths and Wilson intervals. Its forward→inverse→forward matrix also includes dedicated protein-heavy and fat-heavy proportional templates, alongside high/low carbohydrate cases. `benchmark:target-solver` covers 30/90/180/365-day runtime and reports empirical probability/CI and local sensitivity.

The 2026-08-24 validation run produced these engineering observations:

- three independent 90-day default solves returned 2217.19–2260 kcal/day, residuals -0.0849 to +0.0276 kg, and local slopes 0.967–0.989 kg per 100 kcal/day;
- 64/256, 128/512, and 256/1024 solves returned 2280, 2259.375, and 2260 kcal/day, respectively; the 512/2048 reference returned 2259.375 kcal/day with a +0.0942 kg residual;
- the maintenance-band probability ranged 0.117–0.147 across the path-count panel while Wilson intervals narrowed with `N`; this is predictive spread plus numerical sampling, not solver failure;
- independent exact-model truth frequencies were 0.250, 0.490, and 0.833 for predicted bins 0.200, 0.500, and 0.800 (96 trials each), all inside their Wilson intervals. This is a small implementation check, not a formal calibration claim;
- the chosen target was bracketed at all tested 30/60/90/180/365 horizons for the supplied 1500–3300 caller bounds;
- fixed-scenario 30/90/180/365 benchmarks took approximately 0.72/2.57/5.91/12.40 seconds on the validation machine. The 365-day result remained solved and propagated `limited-long-horizon`.
- the expanded 15-regime forward→inverse→forward panel covered moderate and larger loss, maintenance, gain, high/low carbohydrate, protein-heavy and fat-heavy templates, altered Fat/Lean and AT states, personalization, high activity, recovered, and degraded ensembles across 30/90/180/365 days. Thirteen cases solved with endpoint residual magnitude at most 0.099 kg; hidden-control differences ranged from -50 to +100 kcal/day. The gain stress case returned `numerically-limited` at +0.112 kg, and the degraded 365-day case propagated `limited-long-horizon` and returned `numerically-limited` at +0.117 kg rather than claiming a solved target.

Forward→inverse→forward tests prioritize terminal endpoint recovery. Hidden calorie recovery is secondary because nearby controls can generate practically indistinguishable stochastic endpoints. Tests cover loss/gain/maintenance semantics, quantile/sample disagreement, probability boundaries, final drift, exact bounds, macro rejection, CRN alignment, non-monotonic fallback, evaluation limits, deterministic/recovered/degraded provenance, and awaiting/degenerate blocks.

Long-horizon results are not prohibited. They propagate Forecast's `limited-long-horizon` diagnostic. Recovered and degraded ensembles remain usable with provenance; awaiting, degenerate, and stale recovery remain blocked without fallback.

## Remaining Phase 16C product decisions

- user wording and rounding of calorie centers;
- any product/clinical constraint defaults;
- whether a user chooses a near-target or directional probability as primary;
- probability or uncertainty policies, if any;
- display of target-date/bound curves and equivalence wording.

Those decisions must not be inferred from Phase 16B's numerical diagnostics.
