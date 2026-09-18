# Stage 7/8 quantitative blocker rescue — master research

Status: research only, 2026-09-18; completeness revision 3. No production
physiology, claim status, Prisma schema, migration, or Stage-7/8 behavior is
changed by this memo. The separate completeness audit is
[`stage-7-8-quantitative-blocker-rescue-completeness-audit.md`](./stage-7-8-quantitative-blocker-rescue-completeness-audit.md).
The five-area deep follow-up, equations, evidence-saturation record and final
A–K decisions are in
[`stage-7-8-targeted-quantitative-model-readiness.md`](./stage-7-8-targeted-quantitative-model-readiness.md).

## Executive decision

Approximation is useful only where its reference population, observation error,
and held-out calibration are explicit. The best research candidates are a
population estimate for total skeletal-muscle mass, a self-validating personal
stepper-energy fallback, and a probabilistic fat/weight observation model.
None is yet approved implementation. Glycogen compartments, exercise
water, ECF, and individual muscle change remain too weakly identified for a
consumer-facing numeric transition from current inputs.

| Blocker | Best level | Decision |
|---|---|---|
| Skeletal-muscle baseline | C with current inputs; B only conditionally | Lee is MRI-referenced, but BodyCast lacks race and has no in-domain residual calibration; never relabel it as measured muscle. |
| Muscle gain/loss | C — broad population transition | Research prototype only; whole-body SM outcomes are sparse and heterogeneous. |
| Volume, RIR, status, protein, energy | C/D moderators | Use only hierarchical/contextual modifiers, never kg/set or deterministic ranks. |
| Stepper energy | C now; B only after personal validation | Highest activity candidate if the same-machine model passes the complete walk-forward gate and explicit product usefulness caps. |
| Glycogen baseline/repletion/water | C/D | Split latent pools plausible; current personal calibration inadequate. |
| Glycogen depletion, transient water, ECF | D/E | Directional/unavailable; no whole-body calibration. |
| Fat mass / scale observation | C | State-space research is defensible, but exact-device error, input error and individual horizon calibration are unresolved. |
| Sleep/recovery | D | Context/risk only; no defensible daily kg modifier. |

## 1. Garmin → Apple Health compatibility audit

Apple Health/HealthKit capability is not evidence that Garmin exports a value.
Garmin's current official Apple Health support page confirms Active Energy,
Body Fat Percentage, BMI, Flights Climbed, Heart Rate, Resting Energy, Sleep
Analysis, Steps, Walking + Running Distance, Water, Weight, and Workouts.
[Garmin official support](https://support.garmin.com/en-HK/?faq=lK5FPB9iPF5PXFkIpFlFPA)
also states all-day HR is synced, whereas timed activities receive only high/
low values. HealthKit exposes HRV SDNN, oxygen saturation, respiratory rate,
and body-temperature types, but this does not establish Garmin export.
[Apple HealthKit data types](https://developer.apple.com/documentation/healthkit/data-types)

| Metric | Garmin records? | HealthKit type? | Official Garmin export verified? | BodyCast decision |
|---|---|---|---|---|
| Active/resting energy, HR, sleep, steps, distance, workouts, flights, water, weight, body-fat % | Yes | Yes | Yes | Existing/possible automatic source; preserve provenance and device-estimate semantics. |
| Resting HR | Garmin records it | Yes | Not separately verified in Garmin export list | Do not require; ingest only if actual Health samples exist. |
| HRV SDNN | Some Garmin devices record HRV status | Yes | No | Unavailable without observed HealthKit samples; do not use Garmin HRV Status. |
| Stress / Body Battery | Garmin records | No standard equivalent for Garmin score | No | Unavailable. |
| Respiration / Pulse Ox / skin temperature | Device-dependent | Yes | No | Unavailable unless observed in HealthKit; no Garmin assumption. |
| Water | Garmin records | Yes | Yes | Audit actual populated samples first; potentially material only with sodium/fluid context. |

## 2. Skeletal-muscle baseline

The strongest low-burden population prior is Lee et al.'s MRI-derived,
cross-validated anthropometric equation for non-obese adults:

`SM_kg = 0.244*BW_kg + 7.80*height_m - 0.098*age_y + 6.6*male + race - 3.3`

where sex is 0/1 and the published race term is −1.2 Asian, +1.4 African
American, 0 White/Hispanic. Derivation n=244, R²=.86, SEE=2.8 kg; the
cross-validation summary reports about 3.0 kg SEE. A circumference model had
R²=.91/SEE=2.2 kg but needs corrected arm/thigh/calf circumferences.
[Lee et al., MRI model](https://pubmed.ncbi.nlm.nih.gov/10966902/)

The non-obese sample was 135 men and 109 women, age 20–81 years, randomly
divided into development (`n=122`) and cross-validation (`n=122`) groups. In
the non-obese cross-validation group the body-weight/height model difference
was −0.34 ± 2.73 kg and SEE 2.6 kg. A separate obese sample (`n=80`; 39 men,
41 women; mean BMI 33.8 and 34.8 kg/m²) had MRI-minus-predicted bias
−2.33 ± 3.31 kg, R²=.79, SEE=3.0 kg, and significant proportional bias.
Therefore “±3 kg” is not a 95% prediction interval: 2.8 kg is the pooled
development SEE, while 2.6/3.0 kg are validation SEEs. None establishes a
Normal residual distribution.

An independent MRI study evaluated the Lee equation in a validation cohort of
197 adults (105 women), age 19–83 and BMI 15.7–36.4 kg/m². Performance was
R²=.75/SEE 2.9 kg in men and R²=.63/SEE 2.1 kg in women; women had a
predicted-minus-observed difference of 2.6 ± 2.3 kg (95% limits −2.0 to 7.2).
Combined performance was R²=.85/SEE 2.6 kg, with mean difference 2.77 kg and
95% limits −2.4 to 8.0. This is external support for group-level association
but direct evidence against treating SEE as an unbiased individual interval.
[Al-Gindan et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6443297/)

**Conditional research prior:** `SM0 = mu_Lee + epsilon`. `epsilon` must be an
empirical, population- and domain-specific residual distribution. A Normal,
Student-t, asymmetric, or race-mixture likelihood cannot be selected from the
reported SEE alone. BodyCast has body weight, height, age, and sex, but race is
not a current input. Consequently the equation is Level C for current inputs;
it could become Level B only after a prespecified unknown-race treatment and
held-out calibration in a BodyCast-like cohort. Do not guess race. It is
unsuitable for edema, extreme obesity, muscular athletes, sarcopenic disease,
pregnancy, or interpreting a Xiaomi “muscle” output as an observation. A
single waist and mid-thigh/calf circumference may improve prediction, but its
incremental value must be established before asking users.

MRI-valid BIA offers another conditional model only if raw impedance `R` is
available: `SM_kg=(height_cm²/R*0.401)+(3.825*male)-(0.071*age)+5.102`.
[Janssen et al.](https://www.a-wave.it/wp-content/uploads/2024/10/janssen-et-al-2000-estimation-of-skeletal-muscle-mass-by-bioelectrical-impedance-analysis.pdf)
used whole-body MRI in 388 adults aged 18–86 years and reported R²=.86 and
SEE=2.7 kg (9%). Xiaomi's proprietary estimate is not the required 50-kHz raw
resistance and must not be substituted. Consumer scale weight may be a
low-error observation; BIA fat/lean estimates are hydration-sensitive, so
require device-specific repeatability/bias calibration before filtering.

## 3. Muscle transition and moderators

No source supports `kg gained per hard set`. A whole-body meta-analysis in
healthy adult males reported average changes of 1.56 kg FFM, 1.65 kg lean
muscle mass, and 1.11 kg skeletal-muscle mass, with study changes ranging from
0 to 7.2 kg. A small direct D3-creatine trial in 21 low-functioning adults
aged at least 70 years found a 15-week between-group muscle-mass difference of
2.29 kg (95% CI 0.22–4.36), versus DXA ALM 1.04 kg (0.31–1.77); longitudinal
changes by the two methods correlated weakly. These are evidence for broad
population priors, not a transferable individual weekly transition.
[Whole-body meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7068252/)
[D3-creatine trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC10848235/)

A defensible unparameterized research form is:

`ΔSM_12wk = mu_pop + b_volume(V) + b_status + b_protein(P) + b_energy(E) + b_RIR(R) + epsilon_person + epsilon_method`

with all `b` terms partial-pooled by sex, age, training status, measurement
method, and study; `sigma_process` must dominate individual prediction. Whole-
body MRI/D3-creatine should outrank DXA FFM; ultrasound/CSA is regional only.
Report 50/90% posterior intervals, not an individual ordering. Calibrate on
leave-one-study-out data and later walk-forward user data at 8/12/24 weeks.

- **Volume:** a 2017 meta-regression found each additional weekly set associated
  with 0.023 effect-size / roughly 0.37% percentage-gain increase, but outcomes
  were largely local/heterogeneous. [Schoenfeld et al.](https://pubmed.ncbi.nlm.nih.gov/27433992/)
  Use a monotone diminishing spline with wide high-volume uncertainty; do not
  use a universal cap or turn mapped sets into whole-body kg.
- **RIR:** failure is not demonstrably superior to nonfailure; continuous RIR
  meta-regression remains exploratory. Thus RIR 0–1, 2–3, and 4+ may be a
  posterior context category, not a hard effective-set cutoff. Keep observed
  2+ unresolved in production until a pre-specified calibration is validated.
- **Training status:** include as a hierarchical intercept/variance, not
  novice/intermediate labels or deterministic response ranking.
- **Protein:** protein supplementation meta-regression supports a saturating
  association with FFM in healthy adults undertaking RET, but FFM is not SM
  and non-energy-restricted results do not generalize to deficits.
  [Morton et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5867436/)
  Candidate: a bounded monotone spline of g/kg/day with uncertainty—not 1.62
  g/kg as a binary rule.
- **Energy:** resistance training during energy deficiency impairs lean-mass
  gains on average, but does not eliminate recomp or make strength a muscle
  proxy. [Murphy et al.](https://doi.org/10.1111/sms.14075) Use deficit-rate as
  a wide interaction with protein/training/status; no kcal-to-muscle law.
- **Detraining/retraining:** direct mass time courses are too context-specific.
  Separate strength from mass; start with a time-dependent mixture prior only
  after studies provide compatible MRI/DXA outcomes. Present decision: D.

## 4. Stepper/HR energy

The same fixed MS100 permits a personal *device-target* model, separate by
modality: `A_kcal = f(duration, stepRate, bodyMass, HR_features) + epsilon`.
The residual distribution and intervals must be learned chronologically from
that person's same-machine sessions. Garmin active energy is a noisy target, never
criterion truth. Fit only to sessions with observed device active energy and
stable assignment; do not transfer to strength or walking. The earlier fixed
minimum of 20 sessions was engineering judgment, not a published result,
power calculation, or simulation, and is withdrawn. Acceptance must instead
be based on a prespecified learning curve and walk-forward performance: add
sessions until MAE kcal, MAPE, bias, and 80/95% interval coverage stabilize
with adequate temporal/intensity coverage and outperform duration/body-mass
and no-HR baselines. Report the effective training/test sample and refuse the
model when the holdout is too small to estimate coverage. Commercial wearable
reviews find energy expenditure materially less accurate than steps or HR, so
the target retains device-estimate semantics.
[Wearable systematic review](https://pubmed.ncbi.nlm.nih.gov/32897239/)
MET/ACSM/HR formulae may be population priors only, widened substantially;
they do not rescue personal calibration.

## 5. Glycogen and water

The split state `Gm, Gl` remains physiologically preferable. A research-only
model would be:

`Gm[t+1]=clip(Gm-Dm+Rm,0,Cm); Gl[t+1]=clip(Gl-Dl+Rl,0,Cl)`

`Wg[t]=rho_m*Gm[t]+rho_l*Gl[t]`.

Priors must be calibrated from paired MRS/biopsy, meal timing, exercise,
hydration and body-water data. Daily carbs can be a day-level input only after
marginalizing unobserved meal timing; it cannot identify individual Rm/Rl.
Local resistance biopsies and stair/stepper energy do not validate aggregate
Dm/Dl. A 2025 resistance-exercise meta-analysis found an average local muscle
glycogen reduction of about 21% and a set-count meta-regression coefficient of
−11.2 mmol/kg dry mass per set (95% CI −18.0 to −4.3), but heterogeneity was
81.2% and the outcome was biopsied local concentration, not whole-body kg.
[Resistance glycogen meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC12717450/)
A short-term re-synthesis meta-analysis found carbohydrate versus control
increased re-synthesis by 23.5 mmol/kg dry mass/hour (95% CI 19.0–27.9;
I²=66.8%) across 29 trials/246 participants; protocols used timed post-exercise
intake, not un-timed daily totals.
[Re-synthesis meta-analysis](https://pubmed.ncbi.nlm.nih.gov/33507402/)
Paired 7-T MRS in 12 trained male cyclists found muscle glycogen fell 64% and
liver glycogen 34%; after 10 g/kg carbohydrate over 12 hours, liver reached
142% of baseline by 6 hours while muscle reached 69% by 12 hours.
[Paired MRS study](https://pubmed.ncbi.nlm.nih.gov/40836481/)

Human glycogen-water experiments support positive co-variation and cite an
estimated 2.7–4 g water per gram glycogen, but do not provide a calibrated
personal distribution or prediction error for BodyCast inputs.
[Carbohydrate-loading study](https://pubmed.ncbi.nlm.nih.gov/27231310/)
Thus local depletion and timed repletion are Level C candidates, while their
translation to whole-body pools from current data remains D/E. Transient
exercise water and ECF are D/E. No current Apple source supplies sodium,
fluid status, plasma volume, or ECF baseline; water intake alone is
insufficient without actual coverage and validation. Keep ECF unavailable,
never residual.

## 6. Fat mass, observations, and latent architecture

Fat forecasting can proceed more credibly than SM if energy, serial weight and
body-fat observations are modeled as noisy evidence rather than algebraic
truth. Candidate latent state:

`x=[fat, SM, otherLean, unresolvedShortHorizonMass, deviceIntercept, deviceSlope]`;
current observations are weight and body-fat %, with nutrition and activity as
noisy transition inputs. A future lean field is usable only with verified
provenance and a correlated observation model.

Use a hierarchical Bayesian state-space smoother for research calibration.
Represent unsupported short-horizon mass as a signed nuisance state rather
than falsely naming it glycogen, ECF, or transient water; a particle filter is
conditional on material non-Gaussian behavior, while EKF/UKF is conditional on
Gaussian/local-linearity diagnostics. Weight is identifiable rapidly, fat
trend is potentially useful over 8–12+ weeks after calibration, and SM and
named water compartments remain weakly identified. Validate each
horizon (1–3 d, 1, 4, 8, 12, 24 wk) using MAE/RMSE/bias plus interval coverage,
CRPS/log score, held-out studies, leave-one-study-out and user walk-forward
backtests. Do not compute fat as weight minus muscle.

Sleep restriction evidence is mechanistically relevant but does not justify a
daily kg modifier from consumer sleep stages/resting HR. Retain context/risk
only until an intervention-calibrated body-composition transition exists.

## 7. Priority and dependency graph

`device observation model + serial weight/fat%` → `fat/weight state-space` →
`SM baseline prior` → `hierarchical SM transition research calibration` →
`personal stepper device-target model` → `split glycogen/water calibration`.

1. Validate Xiaomi/observed weight/body-fat observation error and serial fat
   filter: highest expected weight/fat value, automatic, moderate effort.
2. Validate Lee SM prior in BodyCast-like adults: the published 2.6–3.0 kg
   SEE is not an individual interval; use MRI residuals to learn bias, tails
   and subgroup transport before exposing an estimate.
3. Personal MS100 device-target energy model: high energy/activity value, no
   fixed session minimum; activate only after chronological paired improvement,
   absolute-error/bias, interval-coverage/width and influence-stability gates.
4. Hierarchical SM gain/loss prototype: high value but high uncertainty and
   external calibration burden.
5. Split glycogen/water and exercise-water studies: defer until paired
   measurements/calibration; low current identifiability.

Material optional inputs: quarterly DXA (largest SM/fat calibration value),
standardized waist/calf/thigh circumference (potentially lowers SM-prior
error), and structured fluid+sodium logging only if a validation study shows
it improves water/ECF predictions. Timed meals help glycogen recovery but add
high burden; do not require daily manual hydration/sodium without demonstrated
forecast gain.

## 8. Claim and implementation consequences

No current BLOCKED claim should change status from this literature review.
Potential future executable work: baseline-prior provenance (not direct SM),
personal stepper energy calibration, and observation-model/state-space claims.
Remain blocked: individual SM response, RIR coefficient, whole-body glycogen
depletion/repletion/capacity, water ratio, transient-water kernel, ECF shift,
and residual allocation. Any implementation must publish population,
extrapolation gates, missing-input output, parameter posterior, and prediction
interval calibration first.

## 9. Complete A–T disposition after targeted follow-up

These levels describe the best defensible *research target*. They do not grant
implementation approval or change a scientific claim.

| Topic | Level | Revised finding |
|---|---|---|
| A. Skeletal-muscle baseline | C now; B conditional | Lee model 2 is a direct MRI-referenced population estimator, but race is missing and obese validation showed −2.33 ± 3.31 kg MRI-minus-predicted bias. It needs an empirical BodyCast-domain residual model. |
| B. Muscle gain/loss | C | Whole-body evidence supplies broad population distributions (SMM mean about +1.11 kg across interventions; 0–7.2 kg study range), not an individual weekly transition. D3-creatine evidence is promising but small and older-population-specific. |
| C. Training volume | C | A monotone population moderator is plausible; the published +0.023 effect size / about +0.37 percentage-gain per additional set is local/heterogeneous and cannot be converted to kg. |
| D. RIR 2+ | C research; unresolved production qualification | 2024 exploratory meta-regression supports a graded proximity relationship for hypertrophy, but RIR was estimated from study descriptions. Failure/nonfailure results and a small trained RCT do not identify set-level probabilities. |
| E. Training status | C | Hierarchical intercept/variance is plausible, but status definitions, methods, and interventions are confounded; no stable numeric multiplier was found. |
| F. Protein | C | Supplementation adds about 0.30 kg FFM on average (95% CI 0.09–0.52); the 1.62 g/kg/day breakpoint has a 1.03–2.20 CI, p=.079 in the detailed fit, and concerns FFM in energy-sufficient cohorts, not direct SM. |
| G. Energy balance | C | Meta-regression suggests roughly 500 kcal/day deficit prevented average lean-mass gain, coefficient about −3.5×10⁻⁴ effect-size units per kcal/day; recomp and individual gain remain possible, and LM is a proxy. |
| H. Detraining/retraining | D | Reviews show muscle size declines more slowly than strength and depend on age/disuse context. No transferable whole-body SM kg time course was found. |
| I. Stepper energy | C now; B after personal validation | Same-machine device-target regression is testable, but Garmin kcal is noisy, absolute product usefulness caps are unset, and no exact minimum session count is evidence-based. |
| J. HR personal calibration | B after modality-specific validation | Individual HR–energy calibration can outperform group curves, but must remain separate for stepper, walking, and strength and be held out temporally. |
| K. Glycogen baseline/capacity | C population pools; E individual current state | Separate muscle/liver priors are physiologically defensible, but body size, carbs, and training history did not yield a calibrated current-state predictor. |
| L. Glycogen depletion | C local; E whole-body kg | About 21% local depletion and −11.2 mmol/kg dry mass/set were found with I²=81.2%; anatomical aggregation and starting stores are missing. |
| M. Daily-carb repletion | C conditional | Timed short-term carbohydrate trials quantify local rates; daily total without meal timing may be marginalized only after validation against 24-hour paired measurements. |
| N. Glycogen-associated water | C association; E calibrated transition | 2.7–4 g/g is an estimated range, not a fitted individual distribution; no BodyCast-input prediction error was found. |
| O. Transient exercise water | D | Acute squat data show local CSA +10% in active vasti/+5% adductors with plasma volume −22%, not a whole-body kg amplitude/decay kernel. |
| P. ECF/hydration | E | Water intake can sync, but no sodium, plasma volume, or ECF measurement exists. BIS studies require a different sensor and controlled perturbation. |
| Q. Body-fat forecast | C | Hall/Thomas-style energy models plus a noisy serial observation layer support a research fat trend; exact-device bias, intake error, lean allocation and individual interval calibration remain unresolved. |
| R. Consumer scale observation | C | Exact Mi Body Composition Scale 2 criterion validation was not found. Comparable foot-to-foot BIA has wide individual limits and hydration bias; learn empirical within-device residuals rather than borrow a point correction. |
| S. Sleep/recovery | D | One-night total deprivation reduced acute MPS 18% in 13 adults; an 8-week diet trial was small and protocol-specific. Neither maps consumer sleep to chronic SM/fat kg. |
| T. Garmin extra data | A for documented exports; E otherwise | Only the current official export list is treated as reachable. HealthKit type presence alone does not establish Garmin export. |

## 10. Current Garmin → Apple Health matrix

Official documentation checked 2026-09-18:
[Garmin export list](https://support.garmin.com/fi-FI/?faq=lK5FPB9iPF5PXFkIpFlFPA) and
[Apple HealthKit data types](https://developer.apple.com/documentation/healthkit/data-types).
“No” in the export column means not listed by Garmin, not proof that no device
or future software version could ever export it.

| Metric | Garmin records? | HealthKit supports? | Garmin officially exports? | BodyCast value |
|---|---|---|---|---|
| Active Energy | Yes | Yes | Yes | Existing noisy activity observation. |
| Resting Energy | Yes | Yes | Yes | Potential audit/comparison input; avoid double counting. |
| Heart Rate | Yes | Yes | Yes; all-day HR, only high/low for timed activities | Useful with coverage/provenance limits. |
| Resting Heart Rate | Yes | Yes | Not separately listed | Use only actually observed Health samples; do not assume Garmin provenance. |
| HRV | Compatible devices | Yes (SDNN) | No | Unavailable through verified workflow. |
| Stress | Yes | No standard Garmin-score type | No | Unavailable. |
| Body Battery | Yes | No standard equivalent | No | Unavailable. |
| Respiration | Compatible devices | Yes | No | Unavailable unless independently observed in HealthKit. |
| Pulse Ox | Compatible devices | Yes | No | Unavailable unless independently observed. |
| Skin Temperature | Compatible devices | Body/wrist-temperature types exist | No | Unavailable from verified Garmin path. |
| Water | Yes/manual-capable | Yes | Yes | Potential coverage signal, not an ECF measurement. |
| Flights Climbed | Yes | Yes | Yes | Activity context, weak physiology value. |
| Sleep | Yes | Yes | Yes | Context only; stages are device-derived. |
| Steps | Yes | Yes | Yes | Existing activity input. |
| Distance | Yes | Yes | Yes (walking + running) | Existing activity input. |
| Workouts | Yes | Yes | Yes; GPS track excluded | Existing activity input; preserve source semantics. |

## 11. Strongest rejected Level B/C candidates

| Area | Strongest candidate found | Why it is not an executable BodyCast model yet |
|---|---|---|
| RIR 2+ | 2024 continuous RIR meta-regression | Exploratory; study RIR was reconstructed, outcomes mainly local, and no calibrated `P(effective set \| RIR)` was reported. |
| Training status | Status moderator in hypertrophy/protein evidence | Definitions and programs vary; trained-subgroup effects conflict with small direct trials and do not isolate status. |
| Protein | 1.62 g/kg/day segmented FFM breakpoint | Wide breakpoint CI, model p=.079, energy-sufficient cohorts, FFM/CSA proxies; usable as context, not a SM coefficient. |
| Energy balance | −3.5×10⁻⁴ ES per kcal/day; ~500-kcal zero-gain crossing | Study-level LM meta-regression is approximately linear over observed deficits and cannot be converted to individual kg or extrapolated to surplus. |
| Detraining/retraining | Older-adult detraining and disuse meta-analyses | Restricted populations, local size/strength outcomes, and cessation/disuse are not interchangeable; no whole-body SM kg transition. |
| Glycogen baseline | Published typical muscle/liver stores and MRS concentrations | Descriptive group values do not predict a user’s current stores from current inputs. |
| Glycogen depletion | ~21% local mean and −11.2 mmol/kgdm/set | High heterogeneity, one biopsied muscle, unknown active muscle mass and initial concentration. |
| Daily-carb repletion | +23.5 mmol/kgdm/hour carbohydrate-control difference | ≤8-hour, timed feeding and biopsy protocols; not a 24-hour un-timed total-carb transition. |
| Glycogen water | Estimated 2.7–4 g/g range | No fitted density, covariate model, or held-out individual error; a Uniform or Normal choice would be invented. |
| Transient exercise water | Local MRI CSA/plasma-volume response | Local geometric swelling and vascular redistribution cannot supply total-body kg amplitude or decay. |
| ECF | BIS change during controlled furosemide fluid removal | Requires a new impedance sensor and drug-controlled setting; current inputs cannot identify ECF. |
| Xiaomi/body-fat observation | Comparable foot-to-foot BIA empirical limits | Not the exact product/firmware; errors are person- and hydration-dependent. Must calibrate repeated paired observations. |
| Sleep/recovery | −18% acute MPS after one sleepless night | Acute MPS is not chronic SM change; tiny sample and extreme exposure do not map to consumer sleep-stage error. |

## 12. Quantitative-use rule and evidence limits

The only copied deployable equations in this memo are the published Lee and
Janssen cross-sectional estimators, and even those are conditional on predictor
availability and validation population. All other equations are structural
research notation. Numeric meta-analytic effects describe populations and
outcomes in their original units; none is transformed to daily kilograms.
The complete parameter provenance table, source ledger, rejection decisions,
and actual search log are in the linked completeness audit. The subsequent
28-source focused search, exact observation structure, Hall boundary, MS100
gate and implementation-readiness grades are in the targeted readiness memo.

This was a structured targeted search through PubMed/PMC, publisher full text,
Google-indexed scholarly results, and official Garmin/Apple documentation. It
was not a registered systematic review: Scopus/Embase/Web of Science were not
directly queried, dual independent screening was not done, and exhaustive
forward/backward citation chaining was not completed. That limitation prevents
this memo from being category A implementation evidence.

## 13. Revised decision

The original memo is category **C**: it was mostly synthesis with material
traceability gaps, an unsupported 20-session threshold, an incorrectly copied
Janssen equation, and an overconfident baseline level. After the targeted
follow-up and corrections above, this revision is category **B**: useful for
choosing research prototypes and validation studies, but not comprehensive
enough to copy coefficients into production. The focused readiness review did
not promote any physiology area to READY-A/B; the MS100 device-target design
can become READY-B only after its individual validation gate and product caps
are satisfied. No implementation approval is requested.
