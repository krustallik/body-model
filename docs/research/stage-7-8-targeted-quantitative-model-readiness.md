# Stage 7/8 targeted quantitative model readiness

Status: research only, 2026-09-18. This is the focused follow-up to the
[master research memo](./stage-7-8-quantitative-blocker-rescue-master-research.md)
and its
[completeness audit](./stage-7-8-quantitative-blocker-rescue-completeness-audit.md).
It changes no production code, scientific claim status, response contract,
schema, migration, or Stage-7/8 behavior.

## Executive decision

None of the four physiology areas is implementation-ready from current inputs.
The personal MS100 model is the closest: its algorithm can become READY-B for
an individual only after it passes a chronological, same-machine,
device-target validation gate and product owners supply explicit usefulness
limits. Until those limits and data exist it is RESEARCH-C, not an active
fallback.

| Area | Present grade | Highest defensible next state | Decisive reason |
|---|---|---|---|
| Xiaomi/consumer-scale observation | **RESEARCH-C** | READY-B after exact-device, protocol-specific repeated criterion calibration | No peer-reviewed criterion or repeated-measure validation specific to Mi Body Composition Scale 2 was found. Comparable foot-to-foot BIA has material person-dependent bias and very wide change limits. |
| Baseline total skeletal muscle | **RESEARCH-C** | READY-B after predictor policy and in-domain MRI calibration | Lee is the only direct-MRI equation matching most current predictors, but race is unavailable and external residuals are biased, asymmetric by subgroup, and too wide to infer a BodyCast prediction density. |
| Longitudinal skeletal-muscle change | **RESEARCH-C**; detraining is DIRECTIONAL-D | READY-B only after compatible whole-body outcomes support a hierarchical residual model | Direct whole-body outcomes are sparse; regional MRI, D3-creatine, DXA and ultrasound disagree or cannot be converted to whole-body kg. |
| Joint fat/muscle forecast | **RESEARCH-C** | READY-B first for fat trend after observation and energy-input calibration; muscle remains broader | Hall/Forbes supplies a mechanistic aggregate fat/lean mean, not calibrated individual intervals or a split between skeletal muscle and other lean tissue. |
| Personal MS100 energy fallback | **RESEARCH-C now; READY-B conditionally after self-validation** | READY-B for Garmin-device semantics, never calorimetry truth | Exact MS100 calorimetry validation was not found, but a personal model can be accepted or rejected from its own out-of-sample device-target errors without importing an unsupported physiological coefficient. |

The current BodyCast health-data path stores paired `weightKg` and
`bodyFatPercent`; it does not currently ingest Apple Health lean body mass.
Therefore lean observations below are a future-input analysis, not a claim
about the present production contract.

## Search accounting and evidence saturation

Twenty-eight new unique sources were substantively reviewed for this follow-up,
in addition to the 37-source ledger in the completeness audit. A source was
counted only when an official page, abstract, table, or relevant full-text
result was read for a concrete parameter, validation, or rejection decision.

| Target area | New unique sources | Important earlier-ledger sources reused | Saturation decision |
|---|---:|---|---|
| Scale observation | 8 | S06–S09, S25 | **A/C:** direct-Xiaomi searches repeatedly found support/product material but no criterion study; independent consumer-BIA studies converged on good duplicate precision but poor individual agreement and noisy change. More generic BIA papers stopped changing the decision. |
| Baseline SM | 2 | S03–S05 | **A/B:** MRI equations converged on the same blocker: models with smaller error require ALM, circumference, skinfold, waist/hip, or raw resistance. Current-input Lee transport remains uncalibrated. |
| Longitudinal SM | 7 | S10, S13–S21 | **B:** direct methods and proxies disagree, populations/horizons differ, and no source supplies a transferable individual whole-body-kg distribution. Additional regional studies refine heterogeneity but do not close the conversion gap. |
| Joint fat/muscle and fat forecast | 5 | S06–S08, S18, S30–S31 | **A/B:** mechanistic models agree at the aggregate-fat/lean level; modern validation and intake-error evidence prevent individual interval parameterization and expose non-identifiability. |
| Personal MS100 fallback | 6 | S01, S34, S36–S37 | **A/C:** no exact-device calorimetry validation emerged. Personalization literature consistently favors held-out personal calibration, but no universal absolute error threshold or fixed session count exists. |

“A/B/C” above refers to the saturation stop condition in the task: conclusion
stabilized, contradictory evidence prevents implementation, or further sources
no longer materially changed parameters. It is not the READY grade.

## 1. Xiaomi Mi Body Composition Scale 2 observation model

### Exact-device finding

No peer-reviewed, criterion-method validation of Xiaomi Mi Body Composition
Scale 2 / XMTZC05HM was found for body-fat percentage, lean mass, or repeated
change scores. Xiaomi states 50 g load-cell *resolution* and documents that
food, exercise, time of day, posture, and floor placement can change readings;
resolution is not accuracy, bias, RMSE, or repeatability. Xiaomi's later S400
support material also describes a different algorithm from Scale 2, so results
must not be pooled across product generations or firmware algorithms.

### Best comparable quantitative evidence

| Outcome | Quantitative result | Interpretation for BodyCast |
|---|---|---|
| Weight, three smart scales versus calibrated scale | Median signed errors were about 0.30 kg (IQR −0.10 to 0.70), 0.00 kg (−0.40 to 0.30), and 0.25 kg (−0.10 to 0.50). | Weight is the strongest channel, but this is not Xiaomi-specific and does not provide a repeated Xiaomi likelihood. |
| Immediate duplicate BF% precision, 15 BIA devices | Precision error 0–0.49 percentage points; least significant change 0.38–1.36 points for ten plausible devices. Five extremely small values appeared affected by data dependence/rounding. | Duplicate precision must not be confused with day-to-day repeatability or criterion accuracy. |
| Cross-sectional BF%, same study | Constant error ranged from −3.5 ± 4.1 to +11.7 ± 4.7 points; SEE 3.1–7.5 points; total error 3.3–12.6; CCC .48–.94. Forty percent showed significant negative proportional bias, mostly foot-to-foot devices. | A universal zero-mean Normal error is contradicted. Device intercept and slope are needed. |
| Longitudinal BF% change over 12–16 weeks | Constant error −0.4 ± 2.1 to +1.3 ± 2.7 points; SEE 1.7–2.6; total error roughly 1.9–2.9; CCC .37–.78. Individual change limits were commonly about ±4.2 to ±5.1 points, with change compression. | Group-average tracking can look acceptable while individual change remains too noisy for a narrow latent-fat update. |
| One comparable foot-to-foot device (RENPHO) | Cross-sectional constant error −1.4 points and total error 7.2; longitudinal constant error −0.3 ± 2.5, total error 2.5, SEE 2.6, CCC .37, limits about ±5.0 points. | Useful as a sensitivity benchmark, not a Xiaomi parameter source. |
| Consumer-scale fat and muscle mass, three smart scales | Median fat-mass errors −2.2, −4.4 and −3.7 kg; median muscle-mass errors +4.5, −6.6 and +4.0 kg, with broad IQRs. | Vendor-derived lean/muscle outputs are not interchangeable with criterion compartments. |
| Bipedal BIA versus MRI/DXA, n=106 | Extreme individual limits included BF% −14.54 to +8.58 points and skeletal muscle −9.52 to +3.92 kg. | Generic bipedal evidence supports heavy caution, not a Xiaomi correction. |
| Consumer BIA versus four-compartment model review | BF% bias across studies −3.5 to +4.4 points, typically 15–20-point-wide limits; FFM bias −3.9 to +1.8 kg, limits often beyond ±6 kg. | Cross-device pooled residuals are too broad and heterogeneous for a fixed product likelihood. |
| Acute water intake | In 39 adults, 2 L water shifted BIA BF% by about +1.3 to +2.6 points and fat mass by 1.3–2.2 kg, depending on device. | Hydration can move the estimate without equivalent tissue change. |
| Longitudinal BIA versus DXA in collegiate athletes, 7 weeks | Body-mass change was similar at group level, but arm/leg FFM changes differed by method. | Even higher-grade BIA group tracking does not validate Xiaomi individual total-SM change. |

### Defensible likelihood structure

No numeric Xiaomi-specific density is ready. The most specific defensible
research form is:

`w_obs[t] = W[t] + b_w(device, person) + epsilon_w[t]`

`bf_obs[t] = a_d(person) + b_d(person) * 100*F[t]/W[t] + epsilon_bf[t]`

`lean_obs[t] = c_d(person) + d_d(person) * (W[t]-F[t]) + epsilon_lean[t]`

where the residual vector has an empirically learned covariance and temporal
correlation under a standardized protocol. `a_d/b_d` represent persistent
intercept/proportional error, not physiology. `G_w` and the joint BF/lean
residual law must be fitted from repeat and criterion data; choosing Normal or
Student-t parameters now would be invention.

If Xiaomi/Apple lean is algebraically derived from the same weight, impedance,
and vendor algorithm as BF%, it is not an independent third observation.
Model BF% and lean jointly with their covariance, or omit the redundant field.
Only an independently measured, definition-compatible lean value may receive
an independent likelihood. Present production should continue to treat lean as
unavailable because it is not in the ingestion contract.

### Does serial averaging help?

Yes for independent random error, not for persistent or correlated error. If
`n` standardized replicates have variance `sigma²` and correlation `rho_k`,

`Var(mean) = sigma²/n * [1 + 2*sum((1-k/n)*rho_k, k=1..n-1)]`.

An independent component falls approximately as `1/sqrt(n)`. Device/person
bias, proportional compression, hydration shared across adjacent days, and
algorithmic error remain. A robust median or state-space trend can reduce
isolated noise; it cannot turn a biased BIA estimate into a criterion measure.
The current seven-observation median/MAD heuristic is therefore an engineering
filter, not a calibrated likelihood.

**Readiness: RESEARCH-C.** Required calibration: exact device/firmware,
standardized morning fasted/voided repeats across days, duplicate measures,
DXA plus preferably a four-compartment criterion for fat, a definition-matched
lean criterion, and held-out intercept/slope/residual/change calibration.

## 2. Baseline total skeletal-muscle prior

### Equation audit

| Model | Exact equation and units | Required predictors | Criterion and validation | Current-input decision |
|---|---|---|---|---|
| Lee model 2 | `SM_kg=.244*BW_kg+7.80*height_m+6.6*male-.098*age_y+race-3.3`; race −1.2 Asian, +1.4 African American, 0 White/Hispanic | Weight, height, sex, age, race | Multislice MRI; n=244 non-obese development/cross-validation, R²=.86, SEE 2.8 kg; validation SEE 2.6 kg. Separate obese n=80, R²=.79, SEE 3.0 kg and proportional bias. | Nearest current-input model, but race is missing and residual transport is unresolved. |
| Janssen BIA | `SM_kg=.401*height_cm²/R_ohm+3.825*male-.071*age_y+5.102` | Height, raw 50-kHz resistance, sex, age | Whole-body MRI, n=388, age 18–86; R²=.86, SEE 2.7 kg. | Unavailable. Xiaomi proprietary lean/muscle is not raw resistance. |
| Al-Gindan sex-specific | Men: `39.5+.665*BW_kg-.185*waist_cm-.418*hip_cm-.0805*age`; women: `2.89+.255*BW_kg-.175*hip_cm-.038*age+.118*height_cm` | Sex plus waist/hip and other listed predictors | MRI development n=423, validation n=197; validation SEE about 2.7 kg men and 2.1 kg women; fit weaker in women. | Unavailable waist/hip. Useful only as evidence that current predictors leave information out. |
| Kiel ALM conversion | Development: `SM_kg=1.12*ALM_kg-.67`; final refit: `SM_kg=1.12*ALM_kg-.63` | DXA appendicular lean mass | MRI reference; total n=475 Caucasian adults, development n=380 and validation n=95; validation R²=.93, RMSE 1.74 kg, limits about ±3.43 kg. | Unavailable. Total Apple/Xiaomi lean is not DXA ALM. |
| Kim ALM conversion, externally tested by Kiel | `SM_kg=1.18*ALM_kg-.03*age_y-.14` | DXA ALM, age | In Kiel validation: RMSE 2.01 kg, limits ±3.84 kg and proportional bias. | Unavailable ALM. |
| Rojano 2024 anthropometry | Published sex-specific DXA-derived equations require four skinfolds and wrist breadth. | Skinfolds, wrist breadth and demographics | n=206 healthy Caucasian adults, age 18–65, BMI <35; DXA-derived outcome. | Inputs unavailable; DXA-derived SM is not whole-body MRI criterion. |

### Statistically correct current candidate

Let `mu_Lee0` be the Lee estimate with the published neutral White/Hispanic
race term only as an explicitly declared reference convention, not an inferred
race. The candidate is:

`SM0 = mu_Lee0 + delta_domain(sex, age, BMI, ethnicity, training) + epsilon`

`delta_domain` and the residual distribution `epsilon` are unknown. They must
be estimated in a BodyCast-like MRI cohort. A race mixture cannot be fitted
without the target-population mixture and subgroup residuals; guessing those
weights would hide rather than solve the missing predictor.

Al-Gindan's external cohort found predicted-minus-observed mean 2.77 kg with
95% limits −2.4 to +8.0 kg. Expressed as observed-minus-Lee prediction, that is
a sensitivity envelope of mean −2.77 kg and limits −8.0 to +2.4 kg for that
cohort. It is not a BodyCast calibration. Adding the published Lee race-term
range as a simple missing-race sensitivity widens the envelope to roughly
−9.2 to +3.8 kg relative to a neutral-race calculation; this is not a 95%
prediction interval because the errors and race term are not independent and
the target mixture is unknown.

### What can be said about expected individual error?

- Validation SEE/RMSE-like magnitudes are approximately 2.6–3.0 kg for Lee.
  SEE is neither expected absolute error nor a 95% individual interval.
- The independent mixed-cohort limits span about 10.4 kg and show mean bias.
- In Lee's obese validation, MRI-minus-predicted was −2.33 ± 3.31 kg with
  proportional bias. Error therefore depends on body composition.
- The lower 1.74 kg RMSE from Kiel requires DXA ALM and cannot be transferred
  to weight/BF/total-lean inputs.

There is no defensible BodyCast-specific expected MAE or individual prediction
interval today. Reporting `estimate ±3 kg` would be false precision.

**Readiness: RESEARCH-C.** BodyCast can compute a clearly labeled population
approximation for research, but cannot present `skeletalMuscleKg` as a
calibrated Level-B prior until the missing-predictor policy and empirical MRI
residual distribution are validated.

## 3. Longitudinal skeletal-muscle change

### Direct and proxy evidence by horizon

| Horizon/source | N and population | Training/context | Method | Change and dispersion | Limitation |
|---|---|---|---|---|---|
| 3 weeks, early RT imaging | Young untrained adults in the Damas program | Resistance training; early versus later phase | Ultrasound/edema-sensitive measures | Early apparent hypertrophy included edema; edema was evident around week 3 and not at week 10. | Establishes a minimum-horizon warning, not whole-body SM. |
| 7-day creatine wash-in before 12-week RT | 63 adults | Creatine loading then resistance training | DXA lean body mass | Creatine produced about +0.51 ± 1.79 kg more LBM before training; after 12 weeks both groups gained about 2 kg with no between-group difference. | Water/lean measurement confounding; not SM gain. |
| 8 weeks | 26 men and women | Quadriceps RT; study-specific loading | Complete quadriceps MRI | +5.1 ± 5.5% complete-volume change; partial-volume estimates +6.0 ± 5.0% manual and +4.8 ± 8.3% automated. | Regional %, not total-body kg; method changes apparent spread. |
| 10 weeks | 18 young men | Unilateral knee extension under three loading conditions | Quadriceps MRI | Baseline roughly 1,529–1,602 cm³ to 1,633–1,676 cm³, approximately 3–7% depending condition. | Local muscle group; nutrition/energy do not yield a transferable moderator. |
| 12 weeks | 9 young men | Isokinetic knee extension three times/week | Vastus lateralis MRI and ultrasound | VL volume +5.0 ± 6.9%; mid-CSA +5.2 ± 5.0%; thickness +7.5 ± 6.1%. Thickness change did not correlate with volume change (`r=.33`). | Shows proxy disagreement and large responder spread. |
| 12 weeks, FAMuSS | 43 men, 40 women; untrained, age about 25 | Unilateral elbow-flexor training | MRI biceps/brachialis volume | Men +85.7 ± 36.5 mL (about 15.2%); women +62.4 ± 33.3 mL (about 12.3%). Volume-load predicted response in women, not men; baseline strength was a negative predictor in men. | Strong local response but sex/moderator instability; no whole-body conversion. |
| 15 weeks | 21 low-functioning adults, mean age 82.1 | High-intensity RT three times/week versus control | D3-creatine; DXA ALM proxy | Between-group D3Cr muscle +2.29 kg (95% CI .22–4.36); DXA ALM +1.04 kg (.31–1.77). Change correlations were weak (`r=.19` ALM, `.40` LBM). | Small, very old cohort; methods disagree. CI is for group contrast, not individual response. |
| 16 weeks | 3 young men | Whole-body RT three times/week | Whole-body MRI | Total SM +4.2 kg; FFM +2.6 kg. | Direct outcome but no useful sample variance and `n=3`. |
| 24 weeks | 61 allocated, final sex cells about 8–9 | Age 50–79; no exercise, 40%, or 60% 1RM lower-body RT | Thigh MRI CSA and DXA | 60% group thigh CSA +7.0% versus −0.7% control; men +10.6 ± 10.5%, women +3.9 ± 5.4%. DXA leg lean +2.3%; DXA and MRI changes did not correlate (`r=-.045`). | Regional older-adult response and small final subgroups. |
| Mixed interventions, 111 studies | Healthy adult males | Heterogeneous duration, volume, status and nutrition | FFM/LMM/SMM mixed | Pooled FFM +1.56 kg, LMM +1.65 kg, SMM +1.11 kg; study means ranged 0–7.2 kg. Only 11 SMM groups/155 participants. | Not a time-indexed individual distribution and methods are mixed. |

Protein, deficit, volume and RIR papers add population context but do not make
the direct outcomes commensurable. Many primary imaging studies do not report
or standardize all requested protein intake, energy balance, proximity to
failure and whole-program hard-set volume; absence was retained as missing,
not imputed.

### Is `DeltaSM_12wk ~ distribution(mu(context), sigma(context))` defensible?

Only as an unparameterized hierarchical research model:

`DeltaSM_12wk[j,i] = alpha_study[j] + f_status + f_volume + f_protein + f_energy + f_RIR + u_person[i] + epsilon_method`

with method-specific observation equations and partial pooling by sex, age,
baseline size, training status and study. Whole-body MRI/D3Cr must be modeled
separately from DXA ALM/FFM and regional volume. No reviewed evidence identifies
the joint coefficients, person variance, cross-method conversion, or tails.

The minimum potentially useful horizon is **12 weeks** for a personal total-SM
posterior. Regional signal can appear by 8 weeks, but early edema, creatine
water, BIA/DXA disagreement and observation noise make 4-week total-SM change
unreliable. Even at 12 weeks, no defensible numeric 50% or 90% prediction
interval in whole-body kilograms can be copied from these studies. Group SDs
and confidence intervals above are not individual prediction intervals.

### Moderators retained

- Training status: retain as a hierarchical intercept/variance, not a fixed
  novice multiplier.
- Weekly hard-set volume: retain as a monotone, diminishing context feature.
  The meta-regression result of +0.023 effect-size units, about +0.37 percentage
  gain per additional set, is local/heterogeneous and must not become kg/set.
- Protein: retain as a bounded continuous context feature. Supplementation
  added about 0.30 kg FFM on average; the 1.62 g/kg/day breakpoint is uncertain
  and concerns a proxy, not direct SM.
- Energy balance: retain deficit category/rate with wide interactions. A
  study-level meta-regression placed average zero lean gain near a 500 kcal/day
  deficit; it is not an individual rule and says nothing symmetric about
  surplus.
- RIR: retain observed session context without a numeric coefficient. The 2024
  meta-regression is exploratory and reconstructed RIR from study descriptions.
- Sex, age, baseline size, program and measurement method: mandatory
  stratification/partial-pooling factors where available.
- Detraining: separate model family. Cessation and immobilization are not
  interchangeable; no transferable whole-body kg decay was found.

**Readiness: RESEARCH-C; detraining DIRECTIONAL-D.** A credible next study must
assemble participant-level, time-indexed direct outcomes and perform
leave-one-study-out and external calibration. Do not derive kg/set or turn the
pooled mean into a weekly Normal prior.

## 4. Fat forecast and joint probabilistic architecture

### What the Hall/Forbes model actually provides

For fat mass `F` in kg and remaining energy `R` in kcal, the existing Hall-like
aggregate partition uses:

`rho_F = 39,500/4.184 kcal/kg`, `rho_L = 7,600/4.184 kcal/kg`

`eta_F = 750/4.184 kcal/kg`, `eta_L = 960/4.184 kcal/kg`

`C = 10.4*rho_L/rho_F = 10.4*7.6/39.5 kg` (about 2.001 kg)

`p = C/(C+F)`

`D = 1 + eta_F*(1-p)/rho_F + eta_L*p/rho_L`

`B = R/D`

`DeltaF = (1-p)*B/rho_F`; `DeltaL = p*B/rho_L`.

This is ready as the already implemented mechanistic **mean partition of
aggregate fat and lean tissue**. It is not a validated personal fat forecast,
does not identify skeletal muscle within lean tissue, and has no calibrated
process or parameter posterior for BodyCast users. The Forbes relation came
from a cross-sectional population relation; longitudinal trajectories are
modeled on translated curves rather than an exact personal curve. Hall model
validation is strongest for controlled group means, not free-living individual
prediction intervals. Thomas-type relations add age/height/sex/race
population structure but do not solve personal composition or intake error.

Self-reported dietary energy is a noisy transition input. A 59-study review
found common, highly variable misreporting; one reported agreement interval
spanned roughly −1,371 to +1,174 kcal/day. Treating logged calories as exact
would dominate any sophisticated state filter with input error.

### Recommended research state

Use the smallest state that exposes uncertainty without assigning unsupported
physiology:

`x[t] = [F[t], S[t], O[t], U[t], a_d, b_d]`

- `F`: fat mass.
- `S`: skeletal muscle.
- `O`: other structural lean tissue.
- `U`: signed unresolved short-horizon mass. It is a nuisance/process term,
  not named glycogen, ECF, inflammation, or transient exercise water.
- `a_d, b_d`: persistent BIA intercept and proportional-error parameters.

Observation means:

`W[t] = F[t]+S[t]+O[t]+U[t]`

`w_obs[t] = W[t]+b_w+epsilon_w[t]`

`bf_obs[t] = a_d+b_d*100*F[t]/W[t]+epsilon_bf[t]`.

A future independent lean observation may target `S+O+U`; a vendor-derived
lean field sharing the BF algorithm must instead use a joint correlated
observation or be omitted.

Candidate transitions are `U[t+1]=phi*U[t]+omega_U` with a zero-centered,
empirically learned nuisance process; slow drift for `O`; the Hall expression
as a mean candidate for `DeltaF`; and a hierarchical 12-week transition for
`S` only after it is calibrated. `U` may be negative and positive; the tissue
states must remain non-negative.

There is an unresolved accounting constraint: Hall's `DeltaL` already includes
all lean tissue. Adding an independent `DeltaS` would double count unless a
validated allocation/reconciliation model maps aggregate lean change into
skeletal muscle, other lean, and nuisance mass. Forcing `O` to be the algebraic
remainder would make “other lean physiology” a residual. This is a hard blocker
to joint implementation.

### Architecture choice

| Architecture | Decision | Reason |
|---|---|---|
| Deterministic compartment model | Reject for product estimates | Cannot express device bias, intake error, unresolved mass, or muscle uncertainty. |
| Linear Kalman filter | Reject | BF% is a nonlinear ratio and persistent intercept/slope plus correlated observations violate the simple model. |
| EKF | Conditional runtime option | Only after local Gaussian/unimodal diagnostics and calibration; linearization may be fragile near correlated states. |
| UKF | Preferred compact runtime approximation after calibration | Handles the BF ratio without analytic linearization, but still assumes an approximately Gaussian state. |
| Particle filter | Conditional | Better for bounds, skew or multimodality, but current evidence does not identify its distributions well enough to justify added complexity. |
| Hierarchical Bayesian state-space smoother | Preferred **research/calibration** architecture | Can learn device/person bias, method-specific observation error, input error and horizon-specific posterior calibration retrospectively. A simpler runtime filter may later be distilled from it. |

### Identifiability and horizon limits

| Quantity | Learnable from present signals? | Main confounding | Defensible horizon statement |
|---|---|---|---|
| Total weight/trend | Yes, strongest | Small device bias; short-term `U` | Daily weight is observable; trend precision improves with standardized repeats. This does not identify compartments. |
| Fat mass/trend | Partly | BF intercept/slope, hydration, calorie-report bias, lean partition | Potentially useful at 8–12 weeks after exact-device calibration. Four weeks is a research horizon, not a promised accuracy horizon. |
| Total lean | Only as `W-F`, broadly | Same BIA algorithm and `U` | Vendor lean adds little if derived from BF/weight. Independent DXA ALM/lean is much more informative. |
| Skeletal muscle | No from weight/BF/lean alone | `S` and `O` are observationally interchangeable; `U` dominates short horizons | Minimum research horizon about 12 weeks, with broad uncalibrated intervals. Training data changes the prior, not identifiability. |
| Other lean tissue | No | Algebraic tradeoff with `S` | Must not be interpreted physiologically without an anchor. |
| Unresolved mass | Only its aggregate residual behavior | Fat/lean observation error and calorie error | Useful as a nuisance absorber, not a biological label or independently valid output. |
| Device bias | Not from serial device data alone | True fat level versus persistent bias | Needs a criterion anchor or strong externally calibrated prior. |

### Can fat be useful while muscle is broad?

Yes in principle: report a marginal fat posterior after integrating over broad
muscle/other-lean/nuisance uncertainty. It will be driven mostly by standardized
weight trend, calibrated BF observations and a noisy Hall mean. It must not
condition on a falsely precise SM path. No reviewed source provides a BodyCast
individual MAE or 50/90% interval at 4/8/12 weeks, so quantitative product
accuracy is not ready.

**Readiness: RESEARCH-C.** The Hall equation is equation-ready as an aggregate
mean, but observation variance, energy-input error, process variance, device
bias, Hall parameter transport, muscle/other-lean allocation and horizon
calibration remain open.

## 5. Personal DOMYOS MS100 energy fallback

### Target and feature policy

The MS100 counter exposes repetitions, duration, rate and a displayed calorie
estimate, but no exact MS100 indirect-calorimetry validation was found. Garmin
active kcal is therefore retained as the target **device semantic**, not
physiological truth. Train only on sessions from the same assigned MS100,
stable source/configuration and Garmin target definition.

Candidate hierarchy:

1. `M0: y_hat = duration_min * median_prior(kcal/min)`.
2. `M1: y_hat = beta0 + beta1*duration_min`, robustly fitted.
3. `M2: y_hat = beta0 + beta1*duration_min + beta2*rate_spm` **or** duration
   plus steps. Steps equal rate times duration, so duration, rate and steps
   must not all enter an unpenalized regression.
4. `M3`: add prespecified HR features and body mass only when coverage,
   missingness and chronological validation support them.
5. Matched-session nearest neighbor is allowed only inside the observed
   duration/rate range; it is not an extrapolator.

Use a robust loss or shrinkage fit; choose complexity by design-matrix rank,
conditioning, predictor coverage and held-out performance, never by a fixed
session count. A hierarchical population prior could stabilize coefficients,
but no such MS100/Garmin cohort currently exists, so it is future work.

### Exact adaptive acceptance gate

For every prediction time, fit only earlier eligible sessions and predict the
next one. Let `e_mi=|y_i-yhat_mi|`, `p_mi=e_mi/max(y_i, epsilon)`, and
`r_mi=y_i-yhat_mi`. Compare each candidate with M0 on exactly the same
chronological holdouts.

Activate a candidate only when **all** conditions hold:

1. Every scored prediction is expanding-window walk-forward and uses no future
   data. Sessions are same-person, same assigned MS100, same Garmin active-kcal
   semantic, with positive duration and target.
2. Candidate predictors have adequate availability, full rank/acceptable
   conditioning, and the requested prediction is inside the supported
   duration/rate/body-mass/HR range. Otherwise step down to a simpler model.
3. A paired session bootstrap (block bootstrap if residual autocorrelation is
   material) gives a one-sided 95% confidence interval wholly above zero for
   `MAE(M0)-MAE(candidate)`.
4. `MAE(candidate) <= E_max_kcal` and
   `median(p_candidate) <= P_max`. These are explicit product usefulness caps,
   not literature-derived physiology.
5. The two-sided 95% confidence interval for mean signed residual lies wholly
   inside `[-B_max_kcal,+B_max_kcal]`.
6. Rolling split-conformal 80% and 95% intervals use only prior residuals.
   Their empirical coverage confidence intervals must contain the nominal
   levels, and median widths must be at most `W80_max` and `W95_max`.
7. Leave-one-training-session-out influence analysis changes deployment-range
   predictions, MAE and bias by no more than product cap `S_max`.
8. Learning curves show no material deterioration over the most recent
   prespecified window, and the effective number of independent holdouts is
   reported. If intervals/coverage cannot be estimated honestly, return
   unavailable; do not replace this with “use after N sessions.”

`E_max_kcal`, `P_max`, `B_max_kcal`, `W80_max`, `W95_max`, `S_max`, the recent
window and conditioning limit require product decisions or prospective utility
calibration. The 80/95% levels and alpha .05 are evaluation conventions, not
claims about physiology. Until those caps are set, this gate is exact in form
but cannot approve a model.

Commercial-wearable evidence supports this caution: energy-expenditure error
is materially worse than step/HR validity. Personal HR calibration can improve
group equations, but older work reports intra-individual coefficients of
variation around 11–20%, and free-living HR-only PAEE retains broad limits.
Indirect-calorimetry stepping studies are machine/protocol-specific and do not
provide a transferable MS100 coefficient.

**Readiness: RESEARCH-C now; READY-B for a particular user only after the full
gate passes.** Missing HR never invalidates M0–M2. Missing steps/rate selects a
simpler duration model. Extrapolation, source change, equipment reassignment,
or gate failure returns unavailable or M0 only if M0 itself passes its absolute
product caps.

## 6. Validation targets: evidence versus product policy

Literature measurements below are comparators, not automatically acceptable
product thresholds. Where evidence does not establish usefulness, the cap is
explicitly a product decision.

| Output | Evidence-derived benchmark | Future validation target | What remains product-defined |
|---|---|---|---|
| Weight | Comparable smart-scale median signed errors around 0–0.30 kg in one study; no Xiaomi repeat distribution. | Report bias, MAE/RMSE and 50/90% interval coverage for raw daily, 1-, 4-, 8- and 12-week trend estimates by device/protocol. | Maximum acceptable MAE/bias at every horizon. |
| Fat/BF% | Consumer-BIA longitudinal total error about 1.9–2.9 points and individual limits about ±4.2–5.1 points over 12–16 weeks; generic 4C limits much wider. | External chronological calibration of fat kg and BF points; calibration intercept/slope, 50/90% coverage, sharpness and CRPS at 4/8/12 weeks. | Whether any observed error is useful enough; no evidence supports copying the comparator as a pass threshold. |
| Baseline SM | Lee validation SEE 2.6–3.0 kg; external predicted-minus-observed limits −2.4 to +8.0 kg. Kiel RMSE 1.74 kg requires DXA ALM. | MRI criterion: bias, MAE/RMSE, subgroup calibration, 50/90% interval coverage and width. | Acceptable MAE/width. `±3 kg` is not a target interval. |
| SM change | Direct evidence lacks a compatible individual whole-body distribution. | Participant-level 12/24-week MRI or validated D3Cr change; report MAE, bias, 50/90% coverage and width with leave-one-study-out validation. | All numeric pass caps. No current evidence-derived MAE threshold exists. |
| MS100 Garmin target | No exact-device criterion; wearable EE lacks universal accuracy. | Gate in §5: walk-forward paired improvement, absolute MAE/MAPE/bias, conformal coverage/width and influence stability. | `E_max`, `P_max`, `B_max`, width, influence and recency caps. |

## 7. Exact equations ready versus parameters not ready

Ready to transcribe or already present as research equations:

- Lee, Janssen, Al-Gindan, Kiel and Kim equations with the predictor and
  population gates shown above. Only Lee can be evaluated from most current
  user fields; evaluation is not calibration.
- Hall aggregate fat/lean mean partition with the listed densities,
  remodeling terms and units. It does not output skeletal muscle.
- Scale and joint-state observation *structure*, with distributions left
  empirical.
- The MS100 candidate hierarchy and chronological acceptance-test logic.

Still requiring calibration or policy:

- Xiaomi-specific weight/BF/lean intercept, slope, covariance, autocorrelation,
  hydration effects, firmware/device effects and repeated-measure residuals.
- BodyCast Lee residual law, subgroup/domain correction and missing-race policy.
- Whole-body 12/24-week SM mean, process variance, moderator effects, method
  conversion and individual 50/90% intervals.
- Free-living calorie-intake error; Hall parameter transport; fat process
  variance; `U` persistence/variance; SM/other-lean allocation; every horizon's
  posterior calibration.
- All MS100 fitted coefficients and residuals, plus product usefulness caps.

## 8. Recommended research/implementation order and blockers

1. Extend the **research dataset**, not production behavior, with explicit
   device model/firmware/source, measurement time/protocol, duplicates and raw
   Apple field provenance. Confirm whether Apple lean is present and whether it
   is algebraically derived from the same scale result.
2. Run an exact-Xiaomi repeated calibration study: standardized serial repeats
   plus criterion weight, DXA/4C fat and definition-matched lean. Estimate
   persistent person/device bias separately from day-level noise.
3. Fit and externally validate the fat/weight hierarchical smoother, first
   without a numeric SM transition. Only then choose a UKF or particle runtime.
4. Validate Lee against whole-body MRI in the intended users or add a truly
   available criterion predictor such as DXA ALM. Do not silently add race or
   substitute vendor lean.
5. Build the MS100 unavailable-by-default learner after product owners set the
   absolute usefulness caps. Activate per user only through §5's gate.
6. Assemble participant-level direct muscle-change data and calibrate the
   12/24-week hierarchical model. Reconcile aggregate Hall lean with SM before
   any joint forecast.

Remaining blockers are exact-device scale data; a criterion anchor for device
bias; baseline-SM target-population residuals; compatible direct longitudinal
SM outcomes; energy-intake measurement error; aggregate-lean-to-SM accounting;
and MS100 product usefulness caps/data. Consequently the targeted research is
**decision-ready but not physiology-implementation-ready**.

## 9. Required final decisions A–K

**A. Can BodyCast initialize `skeletalMuscleKg` approximately today?** It can
compute a research-only Lee population estimate, labeled as an estimate with
unresolved calibration. It cannot expose a calibrated Level-B quantity today.

**B. With what expected individual error?** No BodyCast MAE is known. Published
validation SEE is roughly 2.6–3.0 kg; external observed-minus-predicted limits
are −8.0 to +2.4 kg in one cohort, before unresolved target-population/race
transport. These are not interchangeable.

**C. Can BodyCast forecast `Delta skeletalMuscleKg` probabilistically?** Only
as an unparameterized research hierarchy, not a calibrated product forecast.

**D. Over what minimum useful horizon?** About 12 weeks for research evaluation
of personal total SM; 24 weeks is safer. Four weeks is not supported, and an
8-week regional signal does not establish whole-body individual accuracy.

**E. With what prediction uncertainty?** No transferable kg interval is
available. Group CIs/SDs and mixed-method pooled means cannot supply a personal
50% or 90% interval.

**F. Can `fatMassKg` be forecast quantitatively despite muscle uncertainty?**
Potentially yes after scale/energy calibration, by marginalizing over broad SM,
other-lean and unresolved-mass states. It is not calibrated today.

**G. With what architecture?** A hierarchical Bayesian state-space smoother
for research calibration, then a UKF if Gaussian diagnostics support it or a
particle filter if bounds/skew/multimodality materially improve held-out scores.

**H. Can serial Xiaomi-derived Apple Health observations improve the latent
state?** Yes, especially standardized weight and longer-run BF trend, but only
random error averages down. Persistent bias and correlated hydration remain.

**I. Which fields contribute useful information?** Weight is strongest; BF%
is a noisy, biased fat constraint; lean is useful only if independently defined
and otherwise is correlated/redundant. Timestamp, device/firmware, protocol and
duplicate provenance are essential. Current production does not ingest lean.

**J. Can MS100 fallback energy become operational after self-validation?** Yes
for the personal Garmin active-kcal semantic, not physiological energy truth,
if a candidate passes the complete gate and remains inside its training domain.

**K. What exact acceptance gate controls it?** The eight-condition
walk-forward, paired-improvement, absolute-error, bias, conformal-coverage,
interval-width, influence-stability and domain gate in §5. There is no fixed
minimum session count; unresolved product caps keep it unavailable.

## 10. New-source ledger

| ID | Source | Area | Concrete use |
|---|---|---|---|
| T01 | [Xiaomi Mi Body Composition Scale 2 product page](https://www.mi.com/nl/product/mi-body-composition-scale-2/) | Scale | Official 50 g resolution claim; not treated as accuracy. |
| T02 | [Xiaomi Scale 2 measurement-variation support](https://www.mi.com/global/support/faq/details/KA-13894/) | Scale | Official food/exercise/time/posture/floor cautions. |
| T03 | [Xiaomi S400 versus Scale 2 algorithm support](https://www.mi.com/uk/support/faq/details/KA-235535/) | Scale | Confirms product-generation algorithm differences. |
| T04 | [Accuracy of three commercially available smart scales](https://mhealth.jmir.org/2021/4/e22487) | Scale | Criterion weight, fat-mass and muscle-mass errors. |
| T05 | [Acute 2 L water and BIA body composition](https://pubmed.ncbi.nlm.nih.gov/37335581/) | Scale | Hydration sensitivity across devices. |
| T06 | [Passive hydration and DXA lean mass](https://pubmed.ncbi.nlm.nih.gov/41357162/) | Scale | Demonstrates hydration-related lean-mass measurement movement even with DXA. |
| T07 | [Longitudinal BIA versus DXA in collegiate athletes](https://pmc.ncbi.nlm.nih.gov/articles/PMC8402408/) | Scale | Seven-week change agreement and segment disagreement. |
| T08 | [2026 BIA methodology/standardization guide](https://www.sciencedirect.com/science/article/pii/S0002916526000924) | Scale | Device/software/population/protocol-specific interpretation. |
| T09 | [Kiel et al. MRI total-SM equations from DXA ALM](https://www.nature.com/articles/s41598-023-29827-y.pdf) | Baseline SM | External validation RMSE/limits and ALM requirement. |
| T10 | [Rojano et al. 2024 anthropometric equations](https://www.nature.com/articles/s41598-024-77965-8) | Baseline SM | Modern skinfold/wrist model and Lee transport evidence. |
| T11 | [Early resistance-training hypertrophy and edema](https://pmc.ncbi.nlm.nih.gov/articles/PMC7372125/) | Longitudinal SM | Three-week edema confounding versus later hypertrophy. |
| T12 | [Eight-week quadriceps MRI volume study](https://www.nature.com/articles/s41598-020-59267-x) | Longitudinal SM | Complete/partial volume means and responder dispersion. |
| T13 | [Ten-week quadriceps MRI loading study](https://pmc.ncbi.nlm.nih.gov/articles/PMC3404827/) | Longitudinal SM | Regional volume changes under different loading conditions. |
| T14 | [Twelve-week MRI versus ultrasound hypertrophy](https://pmc.ncbi.nlm.nih.gov/articles/PMC5873262/) | Longitudinal SM | Regional volume dispersion and proxy disagreement. |
| T15 | [FAMuSS MRI hypertrophy predictors](https://pmc.ncbi.nlm.nih.gov/articles/PMC4215195/) | Longitudinal SM | Sex-specific regional volume response and unstable moderators. |
| T16 | [Twenty-four-week MRI/DXA resistance-training trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC8977953/) | Longitudinal SM | Age/sex/load response and MRI–DXA change disagreement. |
| T17 | [Creatine wash-in before resistance training](https://pmc.ncbi.nlm.nih.gov/articles/PMC11944689/) | Longitudinal SM | Acute DXA LBM movement without greater 12-week training gain. |
| T18 | [Forbes theory revisited](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376748/) | Joint/fat | Cross-sectional relation and longitudinal partition assumptions. |
| T19 | [Hall 2010 dynamic body-composition validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/) | Joint/fat | Controlled group-mean validation and model scope. |
| T20 | [Individual body-weight model validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC3975626/) | Joint/fat | Individual final-weight errors; not fat-specific accuracy. |
| T21 | [2026 global anthropometric fat-mass validation](https://www.nature.com/articles/s44360-026-00196-w) | Joint/fat | Cross-country static FM miscalibration and RMSE. |
| T22 | [Dietary energy-intake validity systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6928130/) | Joint/fat | Magnitude/heterogeneity of self-report error. |
| T23 | [INTERLIVE wearable energy-expenditure validation recommendations](https://pmc.ncbi.nlm.nih.gov/articles/PMC9325806/) | MS100 | Bias/error/criterion/population/condition reporting requirements. |
| T24 | [Personalized HR normalization for energy estimation](https://pubmed.ncbi.nlm.nih.gov/25838531/) | MS100 | Evidence that personalization can improve group models. |
| T25 | [Individually calibrated HR with doubly labeled water](https://pmc.ncbi.nlm.nih.gov/articles/PMC4562631/) | MS100 | Free-living limits of individually calibrated HR estimation. |
| T26 | [Office mini-stepper indirect calorimetry](https://pmc.ncbi.nlm.nih.gov/articles/PMC2658993/) | MS100 | Direct stepping EE on a different device; non-transferability. |
| T27 | [StairMaster indirect-calorimetry equations](https://pubmed.ncbi.nlm.nih.gov/8455454/) | MS100 | Cadence-specific machine study and manufacturer underestimation; not MS100. |
| T28 | [DOMYOS MS100 official support](https://support.decathlon.co.uk/stepper-ms100) | MS100 | Counter fields and absence of criterion-validation evidence. |
