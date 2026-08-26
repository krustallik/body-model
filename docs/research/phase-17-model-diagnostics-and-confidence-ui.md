# Phase 17 — Model Diagnostics & Confidence UI

## Product question and boundary

Phase 17 answers several narrower questions instead of inventing one universal “confidence” score: Is the current latent state usable? How continuous are recent inputs? Which personalization parameters were actually accepted? Was a historical gap recovered? Can Forecast use the current state? What uncertainty remains outside the model?

The page is interpretability and provenance UI, not a health score, clinical assessment, model-accuracy percentage, prediction guarantee, or new calibration system. It adds no physiology, recovery, Forecast, target-solver, persistence, or schema behavior. The authoritative versions and statuses remain those already stored by Phases 12–16.

## Research basis for uncertainty communication

The communication design follows these evidence-backed choices:

- Numeric ranges and explicit point estimates can communicate uncertainty without a meaningful trust penalty, whereas vague verbal qualifiers can reduce trust. This supports showing actual counts, thresholds, and Forecast ranges beside plain-language explanations instead of using “high confidence” alone. Source: van der Bles et al., [The effects of communicating uncertainty on public trust in facts and numbers](https://pmc.ncbi.nlm.nih.gov/articles/PMC7149229/).
- Explaining uncertainty before evidence changes can protect trust when later estimates move. This supports durable limitation copy and explicit conditionality, rather than presenting the current state as settled truth. Source: Kreps and Kriner, [When evidence changes: Communicating uncertainty protects against a loss of trust](https://pubmed.ncbi.nlm.nih.gov/38414113/).
- Uncertainty has distinct dimensions and numeric ranges can be interpreted differently depending on their source and framing. This supports separating data continuity, personalization, recovery, numerical quality, and future-behavior uncertainty. Source: van der Bles et al., [Dimensions of uncertainty communication](https://pmc.ncbi.nlm.nih.gov/articles/PMC9660216/).
- People can use both distributional uncertainty and forecaster-confidence information, but additional dimensions increase cognitive burden. This supports a short card overview with progressive disclosure for ESS and particle weights. Source: Joslyn and LeClerc, [Uncertain About Uncertainty](https://pmc.ncbi.nlm.nih.gov/articles/PMC7868089/).
- Distributional displays can improve decisions compared with point-only presentation. Forecast continues to own the quantile visualization; Diagnostics links to it and explains what those ranges omit rather than creating a second chart. Source: Fernandes et al., [Uncertainty Displays Using Quantile Dotplots or CDFs Improve Transit Decision-Making](https://idl.uw.edu/papers/uncertainty-bus).

These studies guide communication, not the physiological validity of BodyCast.

## Architecture and read-only API

`GET /api/diagnostics` composes a compact projection from the active `ModelEpisode`, its current `DailyModelState` status, a 28-calendar-day evidence window, current `ModelUnknownInterval` summary, and the latest persisted `ModelRecoveryRun` status. The endpoint performs only reads. It does not call the existing recovery-status service because that service may mark fingerprints stale during status resolution; Diagnostics must have no write side effect.

The response includes:

- episode/model provenance and local timezone;
- current-state availability, source, and compact physiological estimates;
- recent observed/imputed/unresolved nutrition counts, complete/incomplete modeled days, weight-observation count, and unresolved intervals;
- exact persisted calibration status, accepted parameters, evidence, gates, next gate, and warnings;
- recovery status plus compact quality aggregates;
- Forecast readiness and starting-state provenance;
- stable identifiers for explicit limitations.

It excludes recovery ensembles, particles, raw calibration observations, Forecast paths, search traces, source payloads, and raw WorkIntervals. There is no new database table or migration.

## Data continuity semantics

The up-to-28-day window is a UI recency window, not a physiological threshold. Its start is bounded by the episode start so evidence from before the modeled episode is not counted. Calendar arithmetic uses the existing `YYYY-MM-DD` helpers and therefore does not convert local dates through midnight instants across DST.

Nutrition provenance is separated into observed, locally/baseline-imputed, and unresolved. A missing weight measurement is reported as reduced weight evidence but does not make an otherwise simulatable day incomplete. A day with no `WorkInterval` means zero occupational work; it is not missing activity. Existing `DailyModelState.status`, `nutritionSource`, and unknown intervals remain authoritative.

## Personalization gates and acceptance

Diagnostics reads the persisted calibration diagnostics and the same `DEFAULT_PERSONALIZATION_CALIBRATION_CONFIG` used by calibration:

| Gate | Required |
| --- | ---: |
| Offset weight observations | 20 |
| Offset observation span | 28 days |
| Two-parameter weight observations | 35 |
| Two-parameter observation span | 56 days |
| Activity standard deviation | 75 kcal/day |
| Activity coefficient of variation | 0.20 |

The thresholds are conservative engineering safeguards, not biological norms. Crossing them permits evaluation; it does not itself accept parameters. Identifiability, parameter bounds, robust Student-t fitting, and held-out validation can still retain defaults. `personalOffsetKcalPerDay` is an effective residual term, not a metabolism diagnosis. `activityCalibration` is an accepted scale multiplier, not activity measurement accuracy.

Statuses remain exact: `insufficient-history`, `invalid-history`, `defaults-retained`, `offset-only`, and `fully-calibrated`. Only the latter two activate personal parameters.

## Recovery and Forecast readiness

Recovery states are shown independently:

| Diagnostics state | Forecast use |
| --- | --- |
| `not-required` | Allowed from deterministic current state. |
| `recovered` | Allowed from recovered posterior state. |
| `degraded` | Allowed with an explicit quality warning. |
| `awaiting-observations` | Blocked; no fallback state is invented. |
| `degenerate` | Blocked because recovery support is unreliable. |
| `stale` | Blocked until recovery is refreshed. |

For `recovered` and `degraded`, current weight/fat/lean values come from compact posterior medians rather than the deterministic pre-gap row. Derived RMR/TDEE are left unavailable because the persisted posterior summary does not contain them. Awaiting, degenerate, and stale states expose no fallback current values. Normalized ESS, maximum particle weight, valid-particle fraction, recovery algorithm version, and persisted warnings appear only in technical disclosure. No MAP particle or ensemble is exposed.

## UI hierarchy and accessibility

`/diagnostics` and the “Стан моделі” / “Model status” navigation item provide:

1. a no-score introduction and four independent overview cards;
2. current latent state and recent data provenance;
3. every personalization gate with current and required values;
4. recovery state and actionable links to Forecast/History;
5. explicit interpretation limits;
6. native `<details>` technical disclosure.

Status never relies on color alone. Text labels, semantic headings, lists, definition lists, focus-visible outlines, native disclosure keyboard behavior, responsive layouts, dark-mode tokens, and non-hover explanations are part of the contract.

## Explicit limitations

- The current modeled weight is a latent physiological estimate, not the next scale reading.
- Forecast intervals are conditional on modeled future behavior and starting-state uncertainty.
- Future scale-measurement noise, parameter uncertainty, all structural model error, sodium/gut-content effects, and arbitrary future behavior are not included.
- The current `hold-ecf` policy holds extracellular-fluid deviation constant.
- A 365-day Forecast can report limited numerical quality; Diagnostics does not pre-claim quality before a concrete run.
- The diagnostics page reports model evidence and readiness, not whether a plan is medically safe or advisable.

## Validation performed

- Unit/API/UI/regression: 103 files, 1,258 tests, 0 failed after the final implementation edits.
- Coverage: 98.77% statements/lines, 91.63% branches, 99.16% functions; the new diagnostics module has 100% statements/lines/functions and 94.07% branches, while deterministic `src/model` remains 100%.
- Real PostgreSQL 17: all 13 migrations and 27 integration tests, 0 skipped. The Diagnostics integration assertion compares episode data and model/recovery row counts before and after the read.
- Populated browser fixture: deterministic current state, 28/28 complete recent days, 28 recent weights, `offset-only` accepted personalization, no recovery required, and Forecast ready.
- Limited browser fixture: deterministic state and Forecast remain usable while a 10-day episode reports 10/10 complete days, 10 relevant weights, six unmet personalization gates, and `insufficient-history` without conflating the axes.
- Recovery unit matrix: `not-required`, `recovered`, `degraded`, `awaiting-observations`, `degenerate`, and `stale`; only deterministic/recovered/degraded states permit Forecast.
- Browser: 1280×720 desktop and 390×844 mobile, dark color scheme, no horizontal overflow, Ukrainian content and document language, focus-visible native technical disclosure, and no console warning/error. The automation surface did not dispatch the native default toggle for synthetic Enter/Space, so keyboard focus and semantics—not a synthetic toggle event—are the verified evidence.
- DST fixture: Europe/Bratislava window `2026-09-29…2026-10-26` remains exactly 28 local calendar dates across the 2026-10-25 clock change.
- Warm local development requests returned a 2,603-byte JSON response; Next server timing was 11–26 ms. No ensembles or raw path arrays were serialized.
