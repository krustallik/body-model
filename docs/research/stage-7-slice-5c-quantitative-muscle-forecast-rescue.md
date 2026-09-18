# Stage 7 Slice 5C — quantitative muscle-forecast rescue research

Status: research only, 2026-09-18. This document changes no physiology
contract, production code, scientific-claim status, or database schema.

## Decision

**Decision: A — retain Level 1 for the currently deployable BodyCast v7
skeletal-muscle transition.** A population range forecast is a credible *future
research architecture* (called “Level 2.5 candidate” below), but the evidence
currently does not identify a general, calibrated, longitudinal whole-body
skeletal-muscle-kg prior for BodyCast users. It therefore cannot supply
parameters without inventing them.

This is not a finding that muscle mass cannot change. It is a finding that the
available evidence does not yet support a portable, user-level quantitative
transition from BodyCast's observations. The direct studies demonstrate why
skeletal muscle, FFM, and DXA lean outcomes must remain separate.

## Search and evidence rules

Searches covered PubMed, PMC, DOI/publisher records, and citation trails for
whole-body MRI, D3-creatine dilution, DXA/MRI validation, RT intervention,
protein, energy deficit, detraining, and dynamic body-composition models. The
priority was direct whole-body skeletal muscle, then longitudinal paired-method
evidence, and only then FFM/lean proxies. Literature found through September
2026 was considered; a 2026 RT-dose meta-regression was included.

`direct SM` below means whole-body MRI or D3-creatine skeletal-muscle mass, not
DXA lean/ALM, local CSA, ultrasound thickness, or FFM. A useful source is not
automatically an acceptable BodyCast parameter: it must match the target
population, measurement definition, time horizon, covariates, and uncertainty.

## Evidence matrix

| Source | Population / intervention | Outcome and quantitative result | Direct? | BodyCast use now |
|---|---|---|---|---|
| [Abe 2003](https://pubmed.ncbi.nlm.nih.gov/14665598/) | 3 young men; 16 weeks heavy RT, 3 d/wk | Whole-body MRI SM +4.2 kg; FFM +2.6 kg | Yes | Demonstrates non-interchangeability, but N=3, no variance/control; not a prior |
| [Cawthon et al. 2023](https://pubmed.ncbi.nlm.nih.gov/36752568/) | N=21, mean age 82.1, 64% female, low-to-moderate function; 15-week high-intensity full-body RT 3 d/wk vs education | Between-group D3Cr SM +2.29 kg (95% CI 0.22, 4.36); DXA ALM +1.04 kg (0.31, 1.77) | Yes (D3Cr) | Direct intervention signal, but the population and very wide CI are not generalizable to BodyCast |
| [Shankaran et al. 2023](https://pubmed.ncbi.nlm.nih.gov/37668075/) | N=24, age 68.0±4.4, 67% female, BMI 33.8±2.7; weight-loss trial ancillary sample, 6 months | Weight −10.3 kg (CI −12.7, −7.9); D3Cr SM +0.5 kg (CI −2.0, 3.0), while DXA/CT measures fell | Yes (D3Cr) | Direct evidence that weight loss and proxy changes do not identify SM change; pilot, treatment allocation blinded |
| [Cawthon et al. 2019](https://pubmed.ncbi.nlm.nih.gov/31621207/) | N=40 men, age 83.3±3.9; 1.6-y observational follow-up | D3Cr and DXA measures declined; DXA-change/D3Cr-change association only moderate | Yes (D3Cr) | Supports an observation-error model, not an RT gain prior |
| [Heymsfield et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC9929067/) | MRI/DXA development+validation sample N=475, 216 men/259 women; mean age ~50, BMI ~26 | Cross-sectional DXA-ALM to MRI-SM validation; Kim comparator is `SM kg = 1.18 × ALM kg − 0.03 × age − 0.14` | MRI reference | Candidate *baseline observation* only when actual DXA ALM exists; never apply to generic lean tissue |
| [Lee et al. 2000](https://pubmed.ncbi.nlm.nih.gov/10966902/) | Healthy adults; non-obese development/cross-validation N=244 | MRI-referenced anthropometry equations: limb-girth model R²=.91, SEE 2.2 kg; weight/height model R²=.86, SEE 2.8 kg | MRI reference | Population baseline estimator only; error is too large to resolve short-term gain and covariates are not present/reliable enough in current BodyCast |
| [Janssen et al. 2000](https://pubmed.ncbi.nlm.nih.gov/10926627/) | Multi-ethnic N=388, age 18–86, two labs | MRI-referenced BIA equation: `SM kg = 0.401×height²/resistance + 3.825×sex −0.071×age +5.102` | MRI reference | Potential future baseline observation when raw 50-kHz whole-body impedance and protocol metadata are available; not a conversion from app lean tissue |
| [Murphy & Koehler 2022](https://doi.org/10.1111/sms.14075) | RCT systematic review/meta-analysis/meta-regression; RT ≥3 weeks | Energy deficit vs control impaired **lean-mass** gain, ES −.57; meta-regression ~500 kcal/d prevented LM accretion | No—LM proxy | Directional/uncertainty modifier candidate only after a direct-SM prior; not a muscle-kg conversion |
| [Morton et al. 2018](https://doi.org/10.1136/bjsports-2017-097608) | RT protein systematic review/meta-analysis/meta-regression in healthy adults | FFM/lean outcomes; evidence is not direct total SM and cannot yield kg SM per protein gram | No—FFM proxy | Retain qualitative protein constraint; no numeric SM modifier |
| [Pelland et al. 2026](https://pubmed.ncbi.nlm.nih.gov/41343037/) | 67 studies, N=2,058, mean age 25.2; multi-level meta-regressions adjusted for duration/training status | Higher weekly volume associated with hypertrophy, diminishing returns; frequency-hypertrophy compatible with negligible effect | Predominantly hypertrophy proxies/local measures | Supports a dose descriptor and broad prior stratification research, not kg/set or an RIR curve |
| [Grgic 2022](https://pubmed.ncbi.nlm.nih.gov/36360927/) | 6 studies/8 groups, older adults; RT 9–24 wk, cessation 12–52 wk | Post-RT size change d=.99; cessation d=−.83; 12–24 wk cessation CI crossed zero; 31–52 wk negative | Mostly regional size, not total SM | Directional duration evidence only; no whole-body kg/day detraining prior |
| [Hall et al. 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/) | Population dynamic energy-balance model | Dynamic weight/energy-expenditure adaptation; fat/lean partition rather than muscle compartment | FM/FFM, not SM | Useful for v6/v7 energy and mass accounting; does not identify muscle |
| [Thomas et al. 2010](https://pubmed.ncbi.nlm.nih.gov/20459692/) | FFM–FM longitudinal model | Forbes-derived FFM/FM partition with population translate/calibration | FM/FFM, not SM | Cannot create an SM transition or split FFM into muscle/other lean |

## Baseline/state initialization

Validated baseline estimators exist, but only for their source variables and
target populations.

1. **DXA ALM → MRI total SM.** The 2023 MRI/DXA work evaluates an ALM-based
   route; the Kim equation above is explicit and uses ALM in kg plus age in
   years. The sample had a mean age near 50 and BMI near 26. ALM is a DXA
   appendicular lean-soft-tissue measurement, not a generic `leanTissueKg`.
   Adipose lean soft tissue can bias ALM-based estimates in obesity, and athlete
   relations may differ. Its reported total-SM equivalence region was 0.64 kg,
   which is already larger than many desired 4–8 week changes.
2. **BIA → MRI total SM.** Janssen's equation requires height in cm, whole-body
   50-kHz resistance in ohms, sex, and age. A BIA device's displayed lean mass
   is not the raw impedance measurement and cannot be substituted. Hydration,
   device equation, position, timing, and electrode protocol must be retained.
3. **Anthropometry → MRI total SM.** Lee's simplest MRI-referenced equation is
   `SM kg = .244×BW kg + 7.80×height m + 6.6×sex − .098×age + race −3.3`
   (race terms defined by the study). It was developed/cross-validated in
   non-obese adults and has SEE 2.8 kg. The more measurement-heavy
   skinfold/girth model has SEE 2.2 kg. These are group baseline predictors,
   not longitudinal muscle-change instruments.

**Current-source conclusion:** BodyCast's generic v6 `leanTissueKg` does not
contain DXA ALM, raw BIA resistance, validated protocol metadata, or calibrated
anthropometry. It cannot initialize a defensible SM value. A future opt-in
initializer needs, at minimum, either whole-body MRI/D3Cr, a DXA report with
ALM plus scanner/method metadata, or raw validated BIA measurements plus the
equation's required covariates and an explicit observation-error distribution.

## Longitudinal change and proxy validity

The most informative paired-method RT trial is Cawthon 2023. Its cross-sectional
correlations were high (D3Cr with ALM r=.79 and with total LBM r=.79), but
**change** correlations were weak: ΔD3Cr–ΔALM r=.19 (95% CI −.35,.64) and
ΔD3Cr–ΔLBM r=.40 (−.13,.76). This is direct evidence against using a
cross-sectional mapping to translate a person's DXA ALM or LBM change into
skeletal-muscle change. The weight-loss pilot similarly observed falling DXA/CT
metrics while D3Cr SM had a CI spanning substantial loss and gain.

Accordingly, neither ALM, total lean mass, FFM, BIA lean mass, body weight, nor
fat mass may become an observed `skeletalMuscleDeltaKg`. They could become
noisy observations in a future validated joint model only after paired-method
calibration of longitudinal error in the intended population.

## Measurement error and detectability

* Baseline MRI-prediction SEE is 2.2–2.8 kg for the Lee equations; it cannot
  discriminate a hypothetical +0.2 kg individual change.
* The 2023 DXA/MRI validation's 2.5% total-SM equivalence region was 0.64 kg.
* D3Cr direct-change studies show wide intervals: +2.29 kg (0.22,4.36) after
  15 weeks in N=21, and +0.5 kg (−2.0,3.0) after six months in N=24.
* DXA-to-D3Cr change correlations are weak/moderate, so precision of one method
  does not establish accuracy for the other method's change.

No reviewed source supplied a portable smallest-detectable-change distribution
for BodyCast's current sources. A model must therefore report `insufficient
signal` when its posterior interval is dominated by observation/parameter
error; it must not present small point changes as detected tissue change.

## Covariates: what can and cannot modify a future prior

**Training dose.** Pelland 2026 provides a modern population-level association:
weekly volume has a positive, diminishing association with hypertrophy after
adjusting for intervention duration and training status. It also finds
frequency's hypertrophy effect compatible with negligible effects. This supports
retaining qualified direct/fractional set structure as an exposure descriptor,
not multiplying kilograms by sets, frequency, tonnage, HR, or RIR. Proximity to
failure evidence remains insufficient for an individual numeric RIR curve.

**Training status.** The 2026 analysis adjusts for training status, but the
direct whole-body muscle studies above are too sparse and population-specific to
quantify separate untrained/recreationally trained/trained total-SM priors with
validated variance. Status can be a future hierarchical-stratification variable,
not an individual ordering or gain-rate rule.

**Protein.** Protein meta-regression is based primarily on FFM/lean or local
outcomes. It supports no hard 1.62 g/kg switch and no g-protein→kg-SM mapping.
At most it motivates study-level stratification/interaction research after a
direct-SM data set exists.

**Energy balance.** The energy-deficit meta-regression provides a direction for
lean mass, not total SM: prolonged estimated ~500 kcal/d deficit prevented LM
accretion in its included populations. It is not symmetric with surplus, does
not identify a SM energy density, and cannot be applied as a personal muscle
coefficient. Keep the effect as qualitative until direct outcome data support a
bounded probabilistic interaction.

**Detraining.** Evidence supports that cessation-associated regional size loss
is more credible over 31–52 than 12–24 weeks in older adults, but it does not
identify a whole-body, sex/training-status-specific SM loss curve. Short
cessation cannot be treated as an immediate negative step or a retraining bonus.

## Dynamic body-composition models and fat-mass implications

Hall-type models dynamically link intake/expenditure, weight, and **fat/lean**
partition. Thomas/Forbes-type models similarly partition FM and FFM. Neither
model makes skeletal muscle a separate measured compartment or contains an
RT-hypertrophy transition validated for trained users. Their FFM cannot be
silently assigned to SM: it includes water, organs, connective tissue, bone
mineral depending on definition, and glycogen-associated material.

For v7 mass accounting, a hypothetical posterior over muscle must coexist with
separate posteriors for `otherLeanTissueKg`, glycogen, glycogen water, ECF
deviation, and transient exercise water. Fat is not `weight − muscle`; instead,
the observation model must account for all compartments. Adding uncertain SM
therefore broadens fat uncertainty unless independent fat/lean observations
constrain the full state. Any apparent gain in lean/FFM can otherwise be water,
glycogen, or other lean tissue.

## Candidate architectures

| Model | Evidence / utility | Risk | Slice-5C result |
|---|---|---|---|
| A. Remain Level 1 | Fully aligned with current direct evidence limitations | No numeric product output | **Current decision** |
| B. Forecast FFM/lean only | Existing v6 models and body-composition literature address FM/FFM | Must label FFM, avoid muscle claim | Reasonable separate product track |
| C. Baseline SM observation + population longitudinal prior | Scientifically coherent if input is DXA ALM/raw BIA/MRI/D3Cr and a direct-SM longitudinal data set is assembled | Current direct data cannot parameterize general prior/variance | Research candidate, not ready |
| D. Latent Bayesian SM state updated by observations | Correctly represents missingness, measurement error, and individual updates | Requires C plus longitudinal paired-method calibration and external validation | Best eventual architecture, not ready |
| E. Deterministic muscle-gain equation | Easy to present | Pseudoprecision; conflates proxies and dose | Rejected |

## Proposed future Level-2.5 model (not a specification to implement)

If a curated direct-SM longitudinal data set becomes available, use a state
space model rather than `sets × coefficient`:

```text
M[t+Δ] = M[t] + ΔM[t]
ΔM[t] ~ StudentT(ν, μ_g,covariates(Δ), σ_g,covariates(Δ))
y_j[t] ~ ObservationModel_j(M[t], otherLean[t], hydration[t], device/protocol_j)
```

Units: `M`, `ΔM`, and observation errors are kg; `Δ` is weeks (not implicitly
days); energy balance is kcal/day only as a covariate; protein is g/kg/day only
if measured; dose is qualified direct/fractional sets per muscle group per
week. `g` is an explicitly declared population stratum (age/sex/training
status/body-size/method), not an inferred experience label. `μ` and `σ` must be
estimated from direct whole-body SM outcomes and their sampling covariance;
they are deliberately unspecified here. Heavy-tailed transitions protect
against underestimating between-person dispersion.

The output should be a distribution (median/mean only with 50% and 95%
prediction intervals), a source/method applicability label, and an
`insufficient-data` outcome. A carry-forward state remains simulator
bookkeeping—not a zero-valued draw from `ΔM`.

## Validation and data-collection plan

1. Assemble individual- or arm-level longitudinal data with whole-body MRI or
   D3Cr at 4/8/12/24-week horizons, including baseline SM, sex, age, BMI/body
   fat, training status, intervention adherence, sets by muscle group, protein,
   energy context, and method repeatability.
2. Obtain paired direct-SM and DXA-ALM/total-lean/raw-BIA measurements before
   and after intervention in the same population. Fit a **change** observation
   model; do not reuse cross-sectional coefficients.
3. Split by study (not random rows) for external validation. Report MAE and
   bias in kg, RMSE, calibration slope/intercept, 50% and 95% interval coverage,
   interval width, CRPS/log score, and failure/insufficient-data rates at
   4/8/12/24 weeks.
4. Validate separately in untrained, recreationally trained, trained, older,
   female, male, and energy-deficit groups. Do not pool away population shift.
5. Use repeated opted-in, method-consistent user measurements only for posterior
   updating after the observation model is validated. Do not tune to one user's
   later readings and call it prospective accuracy.

## Exact blockers to Level 2/3

1. No sufficiently large, diverse direct whole-body-SM longitudinal RT dataset
   with extracted means, variances/covariances, dose, nutrition, and training
   status to estimate `μ` and `σ` in kg.
2. No validated longitudinal observation model connecting BodyCast's current
   generic `leanTissueKg` to true total SM; direct evidence shows cross-sectional
   agreement does not solve change agreement.
3. No current validated SM baseline observable in the persisted source contract
   (DXA ALM or raw protocolled BIA/MRI/D3Cr are absent).
4. No external prediction-interval calibration by population/time horizon.
5. No joint observation/transition model allocating total-weight uncertainty
   among fat, SM, other lean, glycogen, and water.

Therefore Stage 7 remains Level 1 today. The appropriate next research work is
data curation and protocol-specific measurement calibration, not a new
skeletal-muscle equation.
