# Phase 16C — Goal Planning API/UI

## User problem and product boundary

The planner answers a conditional question: under an explicit nutrition/activity scenario and caller-supplied bounds, which modeled daily calorie center puts the Forecast median near a target weight on a calendar date? It is a hypothetical scenario, not a guaranteed outcome, medical prescription, safety screen, or saved observation.

Phase 16C adds no physiology, recovery, Forecast, or inverse-solver science. It reuses `bodycast-physiology-v4`, `bodycast-recovery-v3`, `bodycast-forecast-v1`, and `bodycast-target-solver-v1`. It does not use a static kcal/kg inversion.

## Architecture and API contract

`/goal` builds an explicit fixed or target-centered scenario and submits it to `POST /api/goal`. The route validates a strict Zod request, maps it to the accepted `daily-calorie-center` solver with `proportional-template` macro scaling, resolves the active episode/current state through the existing service, and serializes the authoritative final Forecast returned by the solver.

The public response contains the goal and effective horizon; domain status; exact internal solved center when available; caller-boundary metadata; terminal p05/p25/median/p75/p95 and residual; empirical target-attainment probability and its Wilson interval; separate goal and solver tolerances; practical calorie resolution; local sensitivity; numerical/current-state provenance; assumptions and warnings; and the compact Forecast trajectory. Search traces, terminal samples, recovery particles, and internal path arrays are never serialized.

The endpoint is read-only. Goal requests do not write Profile, source health/nutrition, WorkInterval (including `breakMinutes`), ModelEpisode, DailyModelState, or ModelRecoveryRun records, and there is no goal-plan persistence table.

## Input, defaults, and calendar semantics

Required inputs are target weight and a future goal date. Editable calorie bounds, optional supported macro bounds, a reference macro template, walking, strength schedule, optional weekday work, and fixed/target-centered behavior are exposed. Missing optional bounds remain absent; explicit zero remains zero where the solver schema permits it.

The initial `1500–3300 kcal` bounds and the reference/activity values are engineering UI conveniences, explicitly labeled as editable and non-medical. They are not physiological or clinical constants. Target defaults to current modeled weight minus 3 kg only when a real current weight exists; otherwise the field stays empty. No missing observed history is fabricated.

Dates remain `YYYY-MM-DD` calendar values. Horizon arithmetic uses UTC-noon calendar helpers while the product meaning remains Europe/Bratislava local dates, avoiding instant conversion and DST shifts. Malformed/impossible dates, non-future dates, non-finite or non-positive required values, reversed calorie bounds, negative/reversed macro bounds, and structurally invalid scenarios are rejected.

## Feasibility and recovery semantics

| Status | Product meaning |
| --- | --- |
| `solved` | The modeled final median is within numerical tolerance; no guarantee is claimed. |
| `solved-at-boundary` | The result lies at an edge supplied by the caller, not a physiological boundary. |
| `numerically-limited` | Monte Carlo/search resolution does not justify a precise center. |
| `not-bracketed` | The target was not crossed inside this scenario and caller range; it is not biological impossibility. |
| `constraint-limited` | Caller macro/calorie constraints leave no valid candidate. |
| `forecast-unreliable` | Forecast quality, rather than nutrition constraints, prevents a trustworthy solve. |
| `non-monotonic` | The evaluated response does not support normal monotonic search. |
| `search-failed` | The accepted compute budget did not yield a reliable result. |
| `initial-state-unavailable` | Awaiting or stale current-state evidence blocks planning; no fallback center is invented. |
| `initial-state-unreliable` | Degenerate recovery uncertainty blocks planning. |

Deterministic and recovered states are allowed. Degraded states are allowed with provenance and warning. Awaiting, degenerate, and stale states stay blocked, with no recovery median, MAP particle, or pre-gap anchor fallback.

## Probability, uncertainty, and numerical display

Target probability is the accepted empirical event frequency from final terminal Forecast samples: at/below for loss, at/above for gain, and within `±goalToleranceKg` for maintenance. The UI never reconstructs it from chart quantiles.

The p05–p95 weight interval describes variability among modeled future physiological outcomes. The 95% Wilson interval describes only finite-path Monte Carlo uncertainty in the estimated event probability; it is not a weight interval, biological uncertainty interval, or probability that the model is correct. Solver residual tolerance and product goal-attainment tolerance remain separate, and goal tolerance is labeled as an engineering setting.

The exact solved float stays in the API, while the displayed plan center is rounded using the solver's returned practical resolution. Long-horizon `limited-long-horizon` provenance is propagated rather than hidden, and 365-day plans remain allowed.

## UI and visualization

The mobile-first `/goal` page reuses the Forecast chart and request-race helpers. It shows historical context, forecast boundary, median, p25–p75 and p05–p95 bands, plus a distinct target date/weight reference that is explicitly described as user-entered rather than observed. Submitted assumptions, explicit zeros, provenance, limitations, loading, field-associated errors, and status-specific copy remain visible without hover-only diagnostics. The client aborts the previous request and accepts state only from the latest request id.

## Explicit non-goals and known limitations

There are no new clinical limits, safety classifications, coaching rules, automatic replanning, plan history, simultaneous activity optimization, body-composition targets, parameter uncertainty, or ECF/sodium changes. The only optimization control is calories; activity is fixed by the caller scenario. Long solves can take seconds and server computation may finish after a client abort, although obsolete responses cannot update the UI. The current chart remains weight-focused, and numerical quality does not establish biological or clinical validity.

## Validation performed

- API/UI consistency fixture (`78.4 kg`, `2027-01-17`, 90 days): API center `1668.75 kcal/day`, practical resolution `60 kcal`, terminal median `78.41423161586039 kg`, residual `+0.014231615860381908 kg`, p05/p95 `77.17332250542664–79.53560404881486 kg`, probability `0.48828125`, Wilson interval `0.4452323527485954–0.5315046857449096`, numerical quality `standard`. The UI intentionally displayed `~1,680 kcal/day`, `78.4 kg`, `+0.01 kg`, `77.2–79.5 kg`, `49%`, and `45–53%`. Form, API goal, terminal, Forecast endpoint, and chart all used `2027-01-17`.
- Unit/API/UI/regression: 98 files, 1,226 tests, 0 failed.
- Real PostgreSQL 17: all 13 migrations and 26 integration tests, 0 skipped; deterministic, recovered, degraded, blocked and no-side-effect behavior covered.
- Coverage: 98.74% statements/lines, 91.51% branches, 99.14% functions; deterministic `src/model` remains 100%.
- Browser: populated desktop and 390×844 mobile happy path; dark theme; field validation; solved-at-boundary, not-bracketed, constraint-limited and degraded flows; 365-day quality warning; target marker; DST endpoint agreement; latest-request-wins race; no console warnings/errors.
- Representative solver runtimes (128 search / 512 final paths): 30d 703.72 ms, 90d 2490.74 ms, 180d 5250.26 ms, 365d 10895.19 ms. The 365-day result reported `limited-long-horizon`.
