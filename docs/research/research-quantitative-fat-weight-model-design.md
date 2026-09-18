# Quantitative fat / scale-weight model — research and design gate

**Scope:** research/design only, 2026-09-18. No production physiology formula,
scientific-manifest change, or test activation is made by this document.

## Repository audit

- Legacy BodyCast already implements a closed daily Hall/Forbes mean partition:
  `p=C/(C+F)`, `C=10.4*rhoL/rhoF=2.001012658 kg`, with `rhoF=39.5 MJ/kg`,
  `rhoL=7.6 MJ/kg`, and Hall synthesis costs solved in the same energy closure.
  It is a slow `fatMassKg` / `leanTissueKg` model, not skeletal muscle.
- The legacy scalar weight filter is a measurement filter (`R=0.25 kg²`, process
  `Q=0.01 kg²/day` engineering defaults), not evidence that each scale reading
  is biological truth.
- v7 state explicitly separates fat, skeletal muscle, other lean, glycogen,
  glycogen water, ECF and transient water. Its fat transition and required
  initialization remain unavailable; reconstructed v7 mass is unavailable when
  any required compartment is unavailable. `observedWeightKg` is labelled an
  observation, not reconstructed mass.
- Stage 9B persists the derived v7 daily result/lifecycle; Stage 9C writes
  isolated shadow diagnostics. Neither provides a fat-transition observation
  model or feeds v7 into production forecast/TDEE.
- Durable inputs presently include daily calories/macros, scale weight, optional
  body-fat %, activity/workout sources, profile context and historical state.
  They do not include criterion serial body composition, numerical fast
  glycogen/water states, or a defensible skeletal-muscle observation.

### Manifest impact

Potentially related blocked claims are C-MV01/02/03/05 (measurement semantics
and longitudinal uncertainty) and flow blockers V7-LONGITUDINAL-COHORTS,
V7-RECALC-NUTRITION, V7-FORECAST, V7-E2E. C-MV04 and mass-conservation claims
are already green. This research supplies no executable v7 fat initialization,
transition, criterion cohort, or calibrated observation oracle; **none are
unblocked**. Scientific status remains **22 GREEN / 55 BLOCKED**.

## Primary quantitative literature

| Mechanism | Exact equation / units | Population, horizon, calibration and error | Applicability/status |
| --- | --- | --- | --- |
| Dynamic mean body-weight response | Hall's adult model is coupled energy/mass differential equations, not `7700 kcal/kg`; published full equations/parameters are in the [2010 human model, PMID 19934407, DOI 10.1152/ajpendo.00559.2009](https://pubmed.ncbi.nlm.nih.gov/19934407/). | Obese and non-obese adult human validation sets; inputs are energy intake, activity, initial body weight/composition and diet composition. The [2011 Lancet model, PMID 21872751, DOI 10.1016/S0140-6736(11)60812-X](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/) reports slow population mean dynamics (about one-year half-time), not daily personal accuracy intervals. | **READY-B** as a mechanistic mean only. BodyCast lacks its full fuel-selection/input calibration and cannot import a population forecast interval as a personal one. |
| Forbes/Hall fat vs FFM partition | Infinitesimal relation `dL/dF = 10.4 kg/F`; energy form `p=C/(C+F)`, `C=10.4*rhoL/rhoF`. Macroscopic extension is given in [Hall 2007, PMID 17367567, DOI 10.1017/S0007114507691946](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376748/). | Human under-/over-feeding comparisons; valid as a relation between **fat mass and fat-free mass**, with limits for large changes and individual diet/training differences. | **READY-A** for the existing small-step aggregate mean partition, provided initial fat mass is defensible. It does not identify skeletal muscle or fast water. |
| Tissue storage/synthesis accounting | `R=B+etaF*dF+etaL*dL`; BodyCast uses `etaF=750 kJ/kg`, `etaL=960 kJ/kg`, separate from stored `rho`. [Hall 2010, PMID 20132585, DOI 10.1017/S0007114510000206](https://pubmed.ncbi.nlm.nih.gov/20132585/). | Whole-body deposition framework; requires net modeled tissue change. | **READY-A** in existing closure only; not a scale observation equation. |
| Consumer BIA body-fat observation | Recommended model is `b_t = alpha_device,person + beta_device,person * fatPercent(F_t,W_t) + eps_t`; `eps_t` is device/person/condition-specific, never zero. | Consumer BIA longitudinal validation found constant error about -0.4 to +1.3 percentage points, SEE 1.7–2.6 points and CCC 0.37–0.78 across devices ([PMID 36404739](https://pubmed.ncbi.nlm.nih.gov/36404739/)); cross-sectional 4C limits commonly span 15–20 points ([PMID 41718193](https://pubmed.ncbi.nlm.nih.gov/41718193/)). | **READY-B** as a noisy, same-device longitudinal observation design; not READY-A without personal calibration/held-out validation. Vendor muscle mass remains excluded. |
| Individual uncertainty/state-space | Latent state `x_t=[F_t,Lslow_t,G_t,Wfast_t]`; transition is mechanistic mean plus process noise; observations are scale weight and BIA likelihoods. | Existing recovery work already uses weighted trajectories; however no external BodyCast-matched cohort estimates process covariance, BIA bias/slope/noise, or predictive coverage. | **RESEARCH-C** for calibrated personal intervals. Architecture is ready; numeric uncertainty is not. |

## Required observation model

Scale: `yW_t = F_t + Lslow_t + G_t + Wfast_t + eW_t`. It is a strong
measurement of **total scale mass**, with robust/condition-aware measurement
noise. It must not overwrite fat mass, and `yW - reconstructedMass` must never
be assigned to fat, muscle, or water.

BIA: `yB_t = alpha + beta * 100*F_t/(F_t+Lslow_t+G_t+Wfast_t) + eB_t` only
when device/method identity and conditions are retained. Estimate or retain
`alpha`, `beta`, and `Var(eB)` as uncertain; missing BIA provides no update.
Hydration/exercise and device changes widen uncertainty or break the series.

## Architecture choice

| Candidate | Decision |
| --- | --- |
| A. Deterministic Hall/Forbes mean | Retain as the mean transition, but insufficient for daily scale/BIA reconciliation. |
| B. Mean plus ad-hoc uncertainty bands | Reject: fixed bands conceal source/device/personal covariance. |
| C. Mechanistic state-space model | **Recommended staged design.** It preserves existing fast v7 compartments, uses Hall/Forbes only for `F` and aggregate `Lslow`, and assimilates observations probabilistically. |

Initial v7 implementation must leave `G_t/Wfast_t` unavailable rather than
inventing them. In that condition scale weight updates only a total-mass
likelihood/diagnostic; it cannot resolve fat. No skeletalMuscleKg transition is
created.

## Calibration and acceptance design

Calibrate expenditure bias, scale noise, BIA intercept/slope/noise and latent
state uncertainty jointly only when a same-device, standardized longitudinal
series has enough variation to distinguish them. Require identifiability checks
(well-conditioned posterior/profile likelihood), chronological held-out
prediction and calibrated interval coverage/width. Do not use a fixed day
count, one desired outcome, or a single BIA reading. Hold back a later segment;
compare weight MAE/bias and BIA residual calibration against no-update and
constant-bias baselines before allowing a personal parameter update.

## Implementation contract after a future gate

Required inputs: initial fat posterior (not a point truth), aggregate slow
non-fat posterior, daily calorie/macros, current defensible expenditure,
profile context, scale weight + timestamp/conditions, BIA value + device/method
identity, and explicit v7 fast-compartment availability. Outputs: posterior
fat/slow-non-fat/total-mass distributions, observation residuals, source and
model fingerprints, and unavailable—not zero—when identifiability fails.

## Decision

- **Weight mean:** READY-B; observation semantics READY-A; personal uncertainty
  RESEARCH-C.
- **Fat mass transition:** READY-A for existing Hall/Forbes aggregate mean with
  defensible initialization; v7 longitudinal posterior integration READY-B.
- **Recommended next step:** design a non-production v7 fat/weight shadow
  inference harness using recorded source identities and synthetic known-truth
  tests first, then validate against a criterion longitudinal cohort. Do not
  activate blocked scientific claims or write production transition formulas
  until that oracle supplies held-out calibration and coverage.
