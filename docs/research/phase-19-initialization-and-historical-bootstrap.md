# Phase 19 — Initialization and historical personalization bootstrap

## Scope

Phase 19 replaces the v1–v4 maintenance-only initializer with a quality-ranked
historical bootstrap. Loss, approximate maintenance, and gain are equally
eligible. The implementation reuses the deterministic simulator, one-step
weight innovations, Student-t objective, bounds, prior, and chronological
validation; it does not introduce a second physics or optimizer.

## Previous behavior

Phase 13 selected the newest 28-day window with at least 21 complete nutrition
days, 14 weights spanning 21 days, and absolute Theil–Sen trend no greater than
0.25%/week. Median calories and carbohydrate were simultaneously treated as
observed typical nutrition and as physiological equilibrium references. The
window, counts, and trend threshold were BodyCast engineering policy, not Hall
physiological constants.

## Scientific evidence

- Hall KD et al., *Quantification of the effect of energy imbalance on
  bodyweight*, Lancet 2011, and its peer-reviewed web appendix define the
  dynamic fat/lean, glycogen, fluid, expenditure, and adaptive-thermogenesis
  model: https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf
- Hall KD, *Estimating changes in free-living energy intake and its confidence
  interval*, AJCN 2011, supports longitudinal dynamic inference rather than an
  endpoint 7700-kcal rule: https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/
- Nunes CL et al., *Does adaptive thermogenesis occur after weight loss in
  adults?*, BJN 2022, documents heterogeneity and attenuation after neutral
  energy balance: https://pubmed.ncbi.nlm.nih.gov/33762040/
- Shiose K et al. measured intracellular water change after carbohydrate
  loading and reports the commonly used 2.7–4 g water/g glycogen range:
  https://pubmed.ncbi.nlm.nih.gov/27231310/

The existing Phase 4–12.1 documents remain authoritative for individual model
components and their limitations.

## Existing BodyCast model

Carbohydrate is stored in API and persistence as grams/day. `glycogen.ts`
converts it once using 4 kcal/g. Thus `baselineCarbEnergyKcalPerDay = 4*CI0`
and `quadraticOutflowKcalPerKgSquaredPerDay = (4*CI0)/Gref^2`. Hall's `CIb`
statement is dimensionally preserved in the energy units used by BodyCast; no
second factor of four is applied during a transition.

AT retains `beta=0.14` and `tau=14 days`. The positive surplus response is a
BodyCast symmetric model adaptation with weaker evidence than the deficit
case, not an equally validated biological constant.

## New BodyCast model adaptation: E0(delta)

Observed reference nutrition describes behavior only. For a complete macro
vector, BodyCast scales its macro proportions with candidate neutral intake.
Because current TEF is linear, `TEF(E)=qE`, and the internally neutral reference
is:

```text
E0(delta) = (RMR0 + ActivityRef + delta) / (1 - q)
```

This is not a Hall equation. It is a BodyCast adaptation that makes the
existing RMR, net-Activity, macro-TEF, and absolute offset components balance
at `AT=0`. A valid macro vector has `0 <= q < 1`, giving a unique positive
fixed point. Every optimizer candidate rebuilds this reference.

`ActivityRef` is the robust median raw net Activity of complete reference days,
including outside-work walking, reconstructed work activity, and strength, all
evaluated with `activityCalibration=1`. Daily simulation still uses each full
schedule. A simultaneous diet/activity intervention requires preceding
activity evidence; otherwise confidence is downgraded.

## Glycogen reference and pre-roll

`CI0` is not fitted. Pre-transition observed carbohydrate history supplies it
when available. Without that history, BodyCast does not invent a population
carbohydrate intake. It uses sensitivity or returns weak/insufficient support.

AT convergence uses `exp(-days/tau)`. Glycogen convergence is evaluated by
replaying the existing nonlinear equation from 0.2 and 0.8 kg. Initial-state
influence is practically negligible when the resulting glycogen-associated
mass difference is below 0.05 kg. That tolerance is engineering policy.

## Window and calibration policy

Candidate lengths are 28, 42, 56, 70, and 84 days. Trend remains a Theil–Sen
diagnostic (`loss`, `stable`, `gain`) and is not an eligibility gate. Ranking
uses observed coverage and span, then a documented length/recency tie break.
These lengths, counts, ordering, the 25/50 kcal sensitivity limits, prior,
bounds, Student-t `nu=5`, and validation gates are engineering policy.

Bootstrap fits only the one absolute `personalOffsetKcalPerDay` with Activity
fixed at one. Later calibration refines that parameter; insufficient new
history retains the initialization value rather than resetting it to zero.

## Limitations

Weight cannot causally distinguish expenditure correction from systematic food
error. Incomplete activity can imitate an offset. Persistent unmodeled water
change can imitate tissue change. Unknown pre-transition carbohydrate and a
short AT pre-roll weaken initialization. The fitted value is therefore an
effective personalized energy-balance correction, never measured RMR.

## Implemented v5 safeguards

Historical fitting state is now anchored at the beginning of the candidate
interval using BIA and weight available on or before that date. The precedence
is nearby historical weight+BIA, pre-roll from that state, compartment
estimates derived from that measurement, then an insufficient fallback. A
current episode-start state is never used to fit an older interval.

The production AT equation remains `beta=0.14`, `tau=14`. Gain-history
initialization additionally tests positive AT beta `0.07` and `0` without
changing deficit behavior. Initialization also replays alternative initial AT
and glycogen states. Diagnostics retain base and alternative offsets, extrema,
spread, and the confidence cap. The explicit BodyCast engineering policy is:
spread `<=25 kcal/day` permits strong, `>25` through `50` caps at weak, and
`>50` or an unavailable alternative is insufficient.

Persistent water shifts, unidentifiable CI0 after a carbohydrate transition,
simultaneous diet/activity intervention without pre-change activity, and the
full candidate-window benchmark still require their dedicated safeguards and
synthetic validation before a production release can be claimed.

## Quantitative synthetic validation

The Phase 19 harness generates scale weight and BIA with the production
simulator and then passes the reported observations through the real v5
initializer. It covers 23 clean and ambiguous scenarios. Each truth is replayed
with fixed 28/42/56/70/84-day selection and the variable selector. These are
deterministic in-model validation results, not population clinical validation.

### Strategy benchmark

| strategy | median absolute error | mean bias | worst clean error | false strong | insufficient | contamination | median spread |
|---|---:|---:|---:|---:|---:|---:|---:|
| 28 | 14.96 | 3.65 | 18.44 | 0% | 100% | 0% | 170.08 |
| 42 | 19.90 | 4.97 | 24.87 | 0% | 100% | 0% | 97.74 |
| 56 | 24.07 | 6.28 | 30.87 | 0% | 100% | 26.1% | 65.88 |
| 70 | 21.83 | 3.93 | 29.18 | 0% | 48% | 26.1% | 49.11 |
| 84 | 25.80 | 4.84 | 31.56 | 0% | 43% | 26.1% | 44.01 |
| variable | 25.80 | 4.84 | 31.56 | 0% | 43% | 26.1% | 44.01 |

The quality tie-break now prefers 84, 70, 56, 42, then 28 days. Fixed 28
had the smallest point error but no usable initialization because its absent
pre-roll made every sensitivity result insufficient. Eighty-four days had zero
false strong results and the largest usable fraction while keeping worst clean
error below 32 kcal/day.

### Variable-selector scenario results

| scenario | truth | inferred | absolute error | interval | spread | confidence |
|---|---:|---:|---:|---:|---:|---|
| maintenance | 0 | 0 | 0 | 84 | 44.07 | insufficient |
| deficit | 0 | 9.38 | 9.38 | 84 | 31.35 | weak |
| surplus | 0 | -17.64 | 17.64 | 84 | 87.24 | insufficient |
| offset +150 | 150 | 181.56 | 31.56 | 84 | 44.01 | weak |
| offset -150 | -150 | -175.80 | 25.80 | 84 | 44.13 | weak |
| low/high-carb transition | 0 | -12.11 / 19.00 | 12.11 / 19.00 | 84 | 34.04 / 41.14 | weak |
| simultaneous interventions | 0 | 50.54 / -19.39 | 50.54 / 19.39 | 84 | 44.01 / 53.67 | weak / insufficient |
| activity-only | 0 | 40.47 | 40.47 | 84 | 43.92 | weak |
| unknown pre-carb / short pre-roll | 0 | 0 / 0 | 0 / 0 | 42 | 97.74 / 97.76 | insufficient |
| persistent water retention/release | 0 | -106.42 / 113.99 | 106.42 / 113.99 | 84 | 42.20 / 42.15 | weak |
| food under-reporting | 0 | -344.91 | 344.91 | 84 | 44.19 | weak |
| missing activity | 0 | 0 | 0 | 84 | 0 | insufficient |
| scale outlier | 0 | 0 | 0 | 84 | 43.99 | insufficient |
| contaminated long regime | 0 | 17.48 | 17.48 | 84 | 39.57 | weak |
| insufficient history | unknown | 0 | n/a | n/a | n/a | insufficient |
| historical composition differs | 150 | 181.56 | 31.56 | 84 | 44.01 | weak |

No ambiguous scenario received strong confidence. Water and systematic food
error remain causally indistinguishable from an effective expenditure offset;
the safeguard therefore downgrades confidence rather than claiming the fitted
offset is physiological.

### Engineering policy derived from synthetic validation

For this deterministic validation family, acceptance is median clean absolute
error at most 30 kcal/day, worst clean error at most 40 kcal/day, `+150/-150`
recovery error at most 40 kcal/day, and zero false-strong ambiguous scenarios.
Observed results were 25.80, 31.56, 31.56/25.80, and 0 respectively. These
limits are release engineering thresholds, not physiological constants.

## Independent audit: replicated and holdout validation

The initial 138 runs were exactly 23 scenarios times six interval strategies;
they were a deterministic grid, not an error distribution. A subsequent audit
used five deterministic development seeds and five separately numbered holdout
seeds. Each seed varied scale noise, observation days, intervention timing,
intake, activity, BIA noise/availability, and initial glycogen position.

| set | clean observations | median | p75 | p90 | p95 | worst | bias | strong coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| development | 30 | 45.15 | 51.13 | 81.20 | 81.99 | 120.54 | -1.70 | 0/115 |
| holdout | 30 | 45.61 | 67.55 | 106.12 | 106.12 | 214.66 | 9.80 | 0/115 |

On holdout, `+150` had median/worst absolute error 62.14/106.12 and `-150`
had 27.43/71.88. Clean surplus had 57.52/214.66. Consequently the earlier
30/40/40 release tolerances are not validated and are withdrawn. Ambiguous
false-strong remained zero, but this is not meaningful confidence calibration
because no clean or ambiguous replicate received strong confidence.

The audit also found that fixed-window comparisons confounded selection span,
pre-roll, and fitting span: the initializer derives pre-roll as selected window
minus 28 days, so fixed 28 received no preceding history. The variable selector
does not score regime contamination; with equally complete data its explicit
length tie-break selects 84 days. The earlier interval benchmark therefore does
not establish a fair optimal fitting length.

Persistent-water detection currently evaluates residuals after fitting the
offset. A fitted offset can absorb a coherent water shift before the detector
sees it. Weak initialization offsets are persisted as the operational absolute
offset and are consumed by forecast, recovery, and target solving. The UI labels
this value `Personal offset` without initialization confidence or explicit
effective-energy-correction provenance. These are release blockers.

## Audit remediation and final independent holdout

The audit findings above were treated as authoritative. The remediation did
not change AT, glycogen, TEF, RMR, the 25/50 kcal/day sensitivity policy,
water magnitude threshold, optimizer prior, or bounds.

Initialization now stores two distinct values. The estimated energy-balance
correction is retained for diagnostics and provenance. Only a `strong`
estimate is copied to the applied operational correction; `weak` and
`insufficient` estimates apply zero. Later calibration starts from the applied
value. Forecast and target solving therefore cannot consume the `-345`
kcal/day food-under-reporting estimate or a water-shift estimate merely because
it exists. Diagnostics and UI identify the value as an estimated energy-balance
correction and show confidence, applied value, and application reason.

A well-observed default-zero fit can be `validated-default`; this is positive
evidence for zero rather than an absence of calibration. Strong confidence is
practically reachable, but remains deliberately sparse. Extreme robust-fit
outlier evidence, internal or pre-roll-to-fitting regime changes, persistent
water, incomplete CI0 sensitivity, and large state sensitivity prevent strong
application.

Pre-roll is now independent of fitting length: every candidate can access up
to 42 preceding days. Water detection runs before and after fitting, and the
pre-fit detector sees the combined pre-roll plus fitting trajectory. Carb-only
changes are explicit regimes. The adaptive selector evaluates 28/42/56/70/84
days, rejects detected contamination ahead of confidence, prefers a shorter
post-change evidence window when pre-roll and fitting differ, then ranks by
confidence, sensitivity, validation NIS, observations, recency, and a
deterministic length tie-break.

The contamination metric below means that the selected fitting interval
crosses the known generator change point. It is separate from pre-roll. A
contaminated fixed interval can still yield a conservative weak estimate, but
the variable selector must choose an uncontaminated candidate when one is
available.

### Corrected fair fixed-window benchmark

All strategies below used the same available preceding history. These are the
single deterministic 23-scenario benchmark results after remediation.

| strategy | median absolute error | bias | worst clean | false strong rate | insufficient rate | known-change contamination | median sensitivity spread |
|---|---:|---:|---:|---:|---:|---:|---:|
| fixed 28 | 19.92 | +5.25 | 25.72 | 0% | 43.48% | 0% | 49.05 |
| fixed 42 | 22.87 | +5.34 | 27.45 | 0% | 39.13% | 21.74% | 43.99 |
| fixed 56 | 24.95 | +4.30 | 29.81 | 0% | 39.13% | 21.74% | 39.67 |
| fixed 70 | 26.88 | +4.85 | 33.02 | 0% | 39.13% | 26.09% | 35.87 |
| fixed 84 | 29.52 | +5.54 | 36.91 | 0% | 39.13% | 26.09% | 32.71 |
| variable | 29.52 | +8.83 | 36.91 | 0% | 43.48% | 0% | 36.17 |

The variable selector is not a disguised fixed-84 strategy. Across 230
development runs it selected 28/42/56/70/84 days 79/27/16/5/93 times, with ten
insufficient-history cases having no interval. On untouched holdout it selected
them 83/23/11/10/93 times, again with ten no-interval cases.

### Replicated development distribution

Ten deterministic development seeds produced 230 end-to-end scenario runs,
including 60 clean known-truth observations.

| measure | result |
|---|---:|
| median absolute error | 32.41 kcal/day |
| p75 | 42.16 kcal/day |
| p90 | 50.97 kcal/day |
| p95 | 55.24 kcal/day |
| worst clean error | 58.50 kcal/day |
| mean signed bias | +9.46 kcal/day |
| clean strong coverage | 5.00% |
| clean strong-or-weak coverage | 83.33% |
| ambiguous false strong / applied | 0 / 0 |
| selector known-change contamination | 0% |

Strong occurred only in clean maintenance and deficit replicates. Persistent
water retention/release, unknown CI0, missing activity, and uncertain initial
glycogen were insufficient. Food under-reporting and clean post-change regimes
could remain weak, but applied zero. This gives false-strong=0 meaningful
context: strong coverage is low but nonzero and restricted to identifiable
clean evidence.

### Frozen release gates

The following are **Engineering policy derived from synthetic validation**,
not scientific constants. They were frozen from development results before the
new final holdout was run:

- median/p90/p95 clean absolute error at most 40/60/65 kcal/day;
- worst clean error at most 75 kcal/day and absolute bias at most 15 kcal/day;
- `+150` and `-150` p95 recovery error at most 70 and 55 kcal/day;
- clean strong coverage at least 3%, clean strong-or-weak coverage at least 75%;
- zero ambiguous false-strong and zero ambiguous applied corrections;
- zero selected known-change contamination and at least three distinct selected intervals.

### Untouched final holdout

The disjoint seeds `1001–1010` were not used for selector design, confidence
rules, or release tolerances. They were executed once after the gates above
were frozen. All 12 gates passed.

| distribution | n | median | p75 | p90 | p95 | worst | bias |
|---|---:|---:|---:|---:|---:|---:|---:|
| all clean known truth | 60 | 30.80 | 46.78 | 51.29 | 51.38 | 55.14 | +8.55 |
| true offset 0 | 30 | 12.35 | 25.41 | 37.03 | 37.66 | 42.34 | -2.09 |
| true offset +150 | 20 | 47.92 | 51.29 | 55.14 | 55.14 | 55.14 | +46.23 |
| true offset -150 | 10 | 34.55 | 35.55 | 48.71 | 48.71 | 48.71 | -34.85 |
| clean deficit | 10 | 13.49 | 25.41 | 30.80 | 30.80 | 30.80 | +16.51 |
| clean surplus | 10 | 28.83 | 37.03 | 42.34 | 42.34 | 42.34 | -26.09 |
| glycogen transitions | 20 | 14.42 | 18.66 | 22.03 | 29.74 | 29.74 | +4.23 |

Holdout clean strong coverage was 6.67% and strong-or-weak coverage was
83.33%. Strong appeared only for maintenance and deficit. Every ambiguous
scenario had zero strong results and zero applied corrections. Persistent
water retention and release were insufficient in all 20 runs; food
under-reporting was weak in all ten and applied zero; missing activity,
no pre-carb history, and uncertain initial glycogen were insufficient in all
30 relevant runs. Selected known-change contamination was 0%.

### Remaining limitations

The inferred value remains an effective energy-balance correction and cannot
separate metabolism from systematic intake error. Strong coverage is only
6.67% on clean holdout, so most valid initializations deliberately remain weak
and apply zero until later evidence supports calibration. The positive and
negative 150-kcal offsets retain directional bias of roughly 46 and -35
kcal/day. Synthetic validation establishes engineering behavior against the
implemented generator; it is not clinical or external-population validation.
