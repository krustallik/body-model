# Research 6.2 — independent strength-session active-kcal estimator

Status: research/design only, 2026-09-18. This document changes no production
physiology, Stage 9B persistence, scientific manifest, or workout-energy code.

## Decision

**RESEARCH-C — insufficient evidence for a defensible production numeric
implementation across BodyCast strength sessions.**

Human criterion studies establish that resistance-session energy expenditure is
measurable and that body size, elapsed time, exercise selection, and work/rest
structure matter. Two studies published session-level regressions, but neither
is externally validated for BodyCast's domain. One requires DEXA fat and lean
mass and a fixed pneumatic-machine protocol; the other is an in-sample model in
15 trained young men performing one fixed 75%-1RM-to-failure protocol. Their
load/volume coefficients do not transfer cleanly to BodyCast's heterogeneous
load-accounting semantics, bodyweight movements, bands, or retrospective data.

No production coefficient, kcal-per-set/rep/tonnage constant, HR equation, MET
fallback, or Garmin calibration is authorized by this review.

## Exact estimand

The future target is **net/active energy during the recorded strength session**:

`session gross energy - individually measured resting energy over the same time`

The interval includes sets and genuine intra-session recovery between
`sessionStart` and `sessionEnd`. It excludes energy before the start and after
the end. In particular, **EPOC/recovery energy is a separate estimand** and must
not be imported from Stage 6.1 or added to exercise active energy.

Criterion labels should combine breath-by-breath indirect calorimetry during the
entire session with an explicit resting baseline. Because resistance exercise is
non-steady-state and has anaerobic contributions, the preferred research label
also measures blood lactate and immediate oxygen recovery under a prespecified
method. This improves the criterion estimate; it does not redefine post-session
EPOC as exercise active energy.

## Criterion-study ledger

| Study | Population | Protocol / timing | Criterion and outcome | Equation / error | BodyCast applicability and limitation |
|---|---|---|---|---|---|
| [Wilmore et al. 1978](https://pubmed.ncbi.nlm.nih.gov/692305/), PMID 692305 | 40 adults: 20 men, 20 women; 17–36 y; training status not reported in abstract | Three 10-station circuits; 30 s work/15 s rest; 22.5 min | Indirect calorimetry; gross EE 9.0 kcal/min men and 6.1 women; 7.0 and 6.0 kcal/kg/h | Body mass correlation `r=.84` men, `.67` women; no prediction error or external validation | Supports mass and duration for this dense circuit only. Not ordinary mixed-rest lifting; gross, not BodyCast active energy. |
| [Beckham & Earnest 2000](https://pubmed.ncbi.nlm.nih.gov/11034431/), PMID 11034431 | 30 adults: 12 men, 18 women; 25.1±6.6 y | 14-min free-weight video circuit; light vs moderate fixed loads | Metabolic-cart VO2; moderate-load EE 6.21±1.01 kcal/min men, 4.04±1.45 women | No portable equation/error model | Load condition changed EE, but HR met intensity criteria while VO2 remained <32% VO2max: direct evidence against HR-as-EE for resistance circuits. |
| [Robergs et al. 2007](https://pubmed.ncbi.nlm.nih.gov/17313290/), DOI [10.1519/R-19835.1](https://doi.org/10.1519/R-19835.1), PMID 17313290 | Previously trained men; bench `n=23`, squat `n=20` | Bench press or squat continuously for 5 min at steady-state low intensities; load and displacement varied | Indirect calorimetry / measured VO2 | Bench: `VO2=0.132+.031·loadKg+.010·distanceCm`, `R²=.728`, SEE .16 L/min. Squat: `VO2=-1.424+.022·loadKg+.035·distanceCm`, `R²=.656`, SEE .314 L/min | Useful isolated-exercise mechanism evidence, not a session model. Continuous steady state does not represent sets plus rests or mixed exercises. |
| [Lytle et al. 2019](https://pubmed.ncbi.nlm.nih.gov/30768553/), DOI [10.1249/MSS.0000000000001925](https://doi.org/10.1249/MSS.0000000000001925), PMID 30768553 | 52 healthy active adults: 27 men, 25 women; 20–58 y | Seven fixed pneumatic-machine exercises; warm-up plus 2–3 sets of 8–12 at 60–70% predicted 1RM; each set started on a 2-min turnover | Continuous metabolic cart; total **net** session kcal | `net kcal=.874·heightCm-.596·age-1.016·fatMassKg+1.638·leanMassKg+2.461·(reported TV scale)-110.742`; `R=.773`, SEE 28.5 kcal; individual-lift `R=.62–.83` | Closest published model. BodyCast lacks criterion lean/fat mass and equivalent pneumatic volume semantics. Derivation-only stepwise regression; no reported external/held-out validation or interval coverage. |
| [Morencos et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC5104360/), DOI [10.1371/journal.pone.0164349](https://doi.org/10.1371/journal.pone.0164349) | 29 adults: 15 men, 14 women; 18–28 y; moderately active with ≥1 y strength experience | Three equal 23.25-min circuits: machines, free weights, or resistance interleaved with running; 3 laps, 15-s transitions, 15 reps at 70% of 15RM | Whole-session portable metabolic cart plus blood-lactate estimate of anaerobic contribution | Total session EE: machine 173±48, free weight 203±58, combined 259±65 kcal pooled; no predictive error model | Shows exercise modality/class changes cost and aerobic-only EE undercounts. Protocol is dense circuit training and includes an aerobic condition, so values are not a general lifting prior. |
| [Brentano et al. 2016](https://pubmed.ncbi.nlm.nih.gov/29541117/), DOI [10.1016/j.jesf.2016.05.003](https://doi.org/10.1016/j.jesf.2016.05.003), PMID 29541117 | 20 physically active men; approximately 25–27 y | Four exercises, 5 sets of 8–10RM; grouped vs separated exercise sequence | Breath-by-breath VO2 during session plus 60-min recovery | Exercise EE 123.8±14.4 vs 131.8±20.9 kcal; exercise+recovery 148.9±18.7 vs 151.5±18.0; no prediction model | Exercise order shifted when energy occurred but not combined total. Small male-only comparison; EPOC values are not part of BodyCast's exercise target. |
| [Ramos-Campo et al. 2020](https://pubmed.ncbi.nlm.nih.gov/33171830/), DOI [10.3390/biology9110383](https://doi.org/10.3390/biology9110383), PMID 33171830 | 10 trained male amateur soccer players; 23.1±3.8 y | Same six exercises, 3 sets and 6RM loads; traditional 3-min rests vs high-intensity circuit with ~35-s transitions and structured recovery | Breath-by-breath indirect calorimetry during exercise; separately measured 20-min EPOC | Exercise energy rate 3.5±0.6 vs 5.8±1.0 kcal/min; no prediction model | Strong within-person evidence that work/rest architecture and density matter even with matched load/volume. Narrow male athletic domain. |
| [João et al. 2020](https://doi.org/10.1080/2331205X.2020.1794500), DOI 10.1080/2331205X.2020.1794500 | 15 trained men; 22.9±2.6 y; ≥12 months training | Eight exercises; 3 sets to concentric failure at 75% 1RM | Indirect calorimetry during effort and recovery intervals; aerobic EE only; mean measured session EE about 332±57 kcal | `EE=-473.595-1.211·repetitions+17.5723·sessionMinutes`; `R²=.61`; no external validation, RMSE, or interval coverage reported | Supports duration as important within one protocol, but the negative repetition coefficient and 39% unexplained variance warn against transfer. Authors state the equation loses validity outside their method. |
| [Nakagata et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9042340/), J Strength Cond Res 36:1290–1296 | 15 active men; 21–29 y | Heel raise, squat, and push-up at 1–6 reps/min, five-minute stages | Indirect calorimetry; aerobic cost | Per-repetition slopes differed: heel raise .13±.04, squat .50±.14, push-up .77±.20 kcal; within-exercise 95% CIs reported | Confirms bodyweight exercises cannot share a generic kcal/rep. Slow staged single exercises are not mixed sessions; extrapolation must not become BodyCast production coefficients. |
| [Núñez et al. 2021](https://doi.org/10.3389/fspor.2021.797604), DOI 10.3389/fspor.2021.797604 | 15 resistance-trained men; 22.9±2.6 y | Eight exercises; equal 30 reps/exercise delivered as 6×5 at 90%, 3×10 at 75%, or 2×15 at 60% 1RM | VO2 during session and EPOC plus blood lactate for aerobic/anaerobic contributions | Total session EE rose with longer high-load session, but kcal/min was higher in low-load than high-load; no estimator/error model | Shows load, sets, reps, duration and density interact; no monotonic load or tonnage coefficient is portable. |

The 2024 [systematic scoping review by Mitchell et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC11393209/)
found 136 resistance-exercise studies using indirect calorimetry, but methods
varied substantially. It recommends indirect calorimetry plus lactate and
immediate recovery measurement because gas exchange alone incompletely captures
glycolytic and phosphagen cost. This supports criterion-data collection, not a
new field equation.

## Predictor decisions

| Predictor available to BodyCast | Evidence decision |
|---|---|
| Body mass | **Retain for research.** Strong circuit correlations and routine normalization support it, but mass alone is not a transferable rate equation. |
| Elapsed session duration | **Retain, especially LIVE.** It captures real set/rest exposure and was dominant in João, but is confounded by rest structure and cannot be multiplied by a universal rate. |
| Exercise stableKey / class | **Retain as categorical structure.** Muscle mass and modality alter EE. Stable keys need criterion-backed grouping; no arbitrary exercise multipliers. |
| Sets and reps | **Retain as structure, not fixed kcal units.** Their effect depends on load, cadence, failure, rest, and exercise. |
| External load / tonnage | **Do not use as a universal linear driver.** Lytle found protocol-specific volume value; João did not retain absolute load; matched-work studies show density changes EE. BodyCast's unilateral factors are accounting semantics, not metabolic work. |
| Rest duration / work density | **High-priority LIVE predictors.** Controlled work/rest comparisons show material effects. BodyCast currently has set-completion timestamps, so inter-completion spacing is not pure rest unless set start/duration is also observed. Preserve that distinction and never reconstruct retrospective rests. |
| Exercise order | **Context only.** Evidence does not identify a stable independent session-total coefficient. |
| RIR / proximity to failure | **Context only.** No located criterion session model estimates an independent RIR coefficient, and self-reported RIR is missing and noisy. |
| HR | **Secondary context/quality signal only.** Resistance pressor response, breath holding, local muscular work, and intermittent kinetics disrupt a portable HR–VO2 mapping. Approximately 2-min sampling can miss sets and peaks; it cannot be the primary estimator or repair absent timing. |
| Sex, age, training status | **Domain and calibration variables, not universal corrections.** Lytle retained age and body composition; Wilmore's sex difference largely diminished after lean-mass normalization. Samples remain too small and narrow for portable coefficients. |

### Missing and heterogeneous inputs

- **LIVE:** use actual session and set-completion timestamps only after validation
  for clock pauses and edits. A gap between completions includes repetition time,
  transition, and rest; label it as an inter-completion interval rather than a
  directly observed rest interval unless future capture supplies set starts.
- **RETROSPECTIVE:** duration may come from a linked device workout, but set
  times/rests are unavailable. Do not synthesize them. Without a separately
  validated retrospective model, return unavailable rather than reuse LIVE
  coefficients.
- **Sparse/missing HR:** does not block a diary-structure research model. Mark
  coverage; never interpolate two-minute samples into set-level physiology.
- **Missing RIR:** omit the feature and widen uncertainty if a future model
  proves that RIR adds held-out value. Never substitute failure or zero RIR.
- **Bodyweight and bands:** external-load tonnage is not comparable. Require
  criterion-calibrated exercise classes or declare out-of-domain.
- **Mixed sessions:** aggregate predictions must be trained and validated at
  session level. Summing isolated-exercise equations risks missing shared rest
  and double-counting recovery.

## Candidate architectures

### 1. Published-equation adapter

- Inputs: Lytle requires height, age, criterion-quality fat/lean mass, and
  protocol-equivalent exercise volume.
- Supported domain: fixed 60–70% 1RM, 2-min turnover, seven pneumatic exercises.
- LIVE/RETROSPECTIVE: only if the recorded session truly matches that domain.
- Missing behavior: unavailable when any domain/input check fails.
- Uncertainty: at least the published SEE 28.5 kcal, but external calibration
  and interval coverage are unknown.
- Decision: **RESEARCH-C for BodyCast**. Current inputs and normal sessions do
  not satisfy the domain; adapting body mass or tonnage would alter the model.

### 2. Criterion-trained LIVE hierarchical session model

- Inputs: body mass; elapsed duration; set-completion timing and derived
  inter-completion intervals; exercise-class sequence; sets/reps; load semantics;
  optional RIR and HR coverage features.
- Form: partial-pooling model over participants and exercise classes with
  interactions for active-set time and observed rest/density. Predict net
  session kcal and a calibrated prediction interval, not kcal per set.
- Supported domain: only classes, timing quality, body-mass range, session
  duration, density, and loading modes represented in criterion data.
- Missing behavior: omit unvalidated optional predictors; reject missing core
  timing or out-of-domain sessions rather than impute false rests.
- Personal calibration: optional random intercept/slope only after repeated
  personal **criterion** sessions; Garmin cannot provide those labels.
- LIVE: scientifically plausible research path.
- RETROSPECTIVE: not applicable without a separately trained degraded model.
- Expected uncertainty: unknown until held-out criterion validation.
- Decision: **RESEARCH-C now; potential READY-B only after successful criterion
  collection and validation.**

### 3. Degraded RETROSPECTIVE session-envelope model

- Inputs: body mass, trustworthy session duration, exercise classes/order,
  sets/reps and load-mode indicators; no inferred rest, RIR, or HR trajectory.
- Form: a separate session-level model producing wider calibrated intervals and
  explicit `timing-unobserved` provenance.
- Supported domain: only retrospective protocols represented in criterion
  data, including bodyweight/band/mixed sessions if each is actually sampled.
- Missing behavior: unavailable without trustworthy duration or in unsupported
  load/exercise classes.
- Personal calibration: criterion-based only.
- LIVE: may serve as an intentionally degraded comparison baseline.
- RETROSPECTIVE: possible research path, but current literature does not report
  sufficient transportable coefficients or error distributions.
- Decision: **RESEARCH-C.** MET and Garmin may be evaluation baselines, never
  the preferred target/model.

## Validation gate for any future implementation

Acceptance is performance- and coverage-based, never a fixed session count.

1. Define net exercise active kcal before data collection and keep EPOC as a
   separate label.
2. Collect criterion sessions spanning the intended participant, exercise,
   timing, density, duration, resistance-mode, and missingness domains. Determine
   sample size from precision/power and effective participant clustering.
3. Split by participant and chronology. Use participant-held-out validation for
   population transport and walk-forward validation for any personal update.
4. Pre-register simple comparators: mass+duration, protocol-class rate, and MET
   baseline. Garmin is a disagreement diagnostic only.
5. Report MAE, median absolute error, bias with limits of agreement, interval
   coverage and width, and error by supported-domain strata. Report MAPE only
   where criterion kcal is safely away from zero.
6. Test stability under sparse HR, missing RIR, corrected set timestamps, and
   plausible diary edits. Optional features must improve held-out performance,
   calibration, or interval width—not merely in-sample fit.
7. Reject deployment if residuals show material dependence on sex, age, body
   mass, training status, exercise class, duration, density, or resistance mode.
8. Verify that session exercise kcal is counted once and that EPOC, resting
   expenditure, Garmin kcal, and downstream recovery energy are not added again.

No numeric acceptance threshold can be fixed from the current literature. The
threshold must be set prospectively against product use and criterion
repeatability, then met on held-out data with calibrated uncertainty.

## Garmin and HR diagnostic contract

Garmin active kcal may be stored alongside the future criterion/model output as
an independently labelled secondary observation. It must not determine model
coefficients, personal calibration, acceptance labels, or fallback values.
Agreement with Garmin does not establish accuracy; disagreement triggers source
and domain diagnostics.

HR at approximately two-minute spacing is suitable for coverage summaries,
implausibility checks, and perhaps an optional session-level feature in a future
criterion-trained model. It is not sufficient to resolve set/rest kinetics and
is not a defensible standalone kcal estimator.

## Executive summary and next action

- Science permits criterion measurement and supports body size, elapsed time,
  exercise class, and observed work/rest density as candidate predictors.
- Fixed kcal per set, rep, tonnage, load, RIR, or HR is not supported.
- Two-minute HR is contextual, not primary estimation evidence.
- LIVE has a plausible future criterion-trained hierarchical-model path.
- RETROSPECTIVE requires a separate degraded model with wider uncertainty; it
  must never receive fabricated rest intervals.
- Current decision: **RESEARCH-C**; estimator remains blocked.
- Next action: write a prospective criterion-data protocol and analysis plan for
  diverse LIVE and retrospective-like sessions, then collect metabolic-cart
  labels and evaluate the candidate models under participant-held-out and
  walk-forward validation. Do not implement numeric production behavior first.

## TODO — revisit experimental strength active-kcal estimator after data accumulation

**Revisit window:** approximately 1–2 months.

At the review, assess:

- the number of complete LIVE strength sessions and Garmin-linked sessions;
- timing quality and HR coverage;
- whether chronological hold-out or walk-forward validation is now possible;
- MAE, bias, interval coverage and interval width; and
- whether diary features materially improve the selected baseline on held-out
  data.

Until validation succeeds, do not connect the estimator to production
TDEE/physiology. Garmin remains a secondary reference, and estimated kcal may
remain unavailable (`null`). This TODO is a data-collection reminder, not a
scientific acceptance threshold.
