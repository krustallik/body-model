# BodyCast workout physiology v7 — independent scientific audit

**Audit date:** 2026-09-17  
**Auditor role:** independent/adversarial review  
**Documents audited:** `workout-physiology-v7-evidence.md`,
`workout-physiology-v7-parameter-contract.md`, and
`workout-physiology-v7-testable-claims.md` in full.  
**Original research modified:** no.

## 1. Executive verdict

**Overall decision: CONDITIONAL GO.**

The research architecture is broadly conservative and gets the most important
category separations right: acute responses are not chronic tissue, lean mass
is not skeletal muscle, local morphology is not whole-body muscle, and
wearable energy is not calorimetry. It is not ready for wholesale conversion
of all 81 claims into RED tests.

Before scientific test-first development, BodyCast must:

1. revise 7 of the 29 primary `IMPLEMENT` records;
2. downgrade 8 of the 29 primary `IMPLEMENT` records to `DEFER` (or explicitly
   relabel a product policy as an engineering assumption);
3. revise 28 claims and exclude 4 claims from scientific RED tests;
4. correct the citation metadata errors listed below;
5. stop treating 3–4 kg water/kg glycogen and 0.3–0.86 kg aggregate glycogen as
   hard physiological bounds; and
6. distinguish “absence of a validated effect” from “validated exact
   neutrality.”

The documents do **not** support exact whole-body muscle-gain, detraining,
glycogen-depletion, transient-water, sleep, HR, or EPOC coefficients. That
central conclusion is scientifically defensible.

## 2. Source verification summary

- The ledger has **123 Evidence IDs but 119 unique papers**. Four Evidence IDs
  are duplicate entries for papers already represented elsewhere.
- All **117 numeric PMIDs** in the ledger resolve in the official PubMed
  database. The two papers whose PMIDs were omitted were independently found:
  E-I02 is PMID 11903130 and E-I05 is PMID 36615811.
- Official PubMed metadata were checked for all 119 unique papers. No cited
  PMID was tagged as a retracted publication in the retrieved records.
- High-impact abstracts or open full texts were independently inspected for
  resistance dose, protein, energy deficit, glycogen depletion/repletion,
  glycogen-water, wearable energy, sleep, EPOC, and measurement validity.
- The reported source counts **123 / 43 / 57 are not reproducible as unique
  source counts**. The defensible paper count is 119. Thirty-two unique PubMed
  records carry a `Systematic Review` or `Meta-Analysis` publication type; the
  ledger text explicitly describes about 35 unique papers as systematic,
  meta-analytic, or umbrella reviews. The claimed 43 likely mixes narrative
  reviews or duplicate/category counting. The ledger text identifies about 53
  unique intervention/controlled/longitudinal/validation papers, not 57.
  Because publication-type indexing is incomplete and categories overlap,
  these two subtype counts should be reported as provisional, with an explicit
  counting rule.
- A hidden `.research-scratch` directory contains three Topic A recovery files:
  `topicA1.txt`, `A_volume2.txt`, and `A_load.txt`. All three were inspected.
  They are raw PubMed-style abstract dumps, not a structured search log or
  adjudicated ledger. They include useful volume/failure material but also
  out-of-scope or indirect cancer, stretching, hypoxia, and blood-flow-
  restriction studies. They do not justify a whole-body dose curve, exact
  frequency neutrality, or a load multiplier, and they do not change the Topic
  A verdict. No separate auxiliary ledger or independent-review queue was found.

Representative independent checks:

- The 2026 dose-response meta-regression exists and supports increasing volume
  with diminishing returns, but does not establish a universal production
  curve or exact frequency neutrality: [Pelland et al., PMID 41343037](https://pubmed.ncbi.nlm.nih.gov/41343037/).
- The 1.62 g/kg/day protein breakpoint and 1.03–2.20 confidence interval are
  reported population meta-regression results for FFM, not individual muscle
  requirements: [Morton et al., PMID 28698222](https://pubmed.ncbi.nlm.nih.gov/28698222/).
- The approximately 500 kcal/day energy-deficit crossover is a study-level
  meta-regression result for lean mass: [Murphy & Koehler, PMID 34623696](https://pubmed.ncbi.nlm.nih.gov/34623696/).
- The resistance-glycogen synthesis reports local vastus-lateralis
  concentration with a prediction interval that crosses zero, not whole-body
  glycogen kilograms: [Hamidvand et al., PMID 41420384](https://pubmed.ncbi.nlm.nih.gov/41420384/).
- The 3–4 water:glycogen statement is an approximate co-variation inference;
  directly bound water was not measured and hydration can produce much larger
  ratios: [Shiose et al., PMCID PMC9823884](https://pmc.ncbi.nlm.nih.gov/articles/PMC9823884/).
- The Apple Watch review cited as E-K01 is actually Lambe et al. in *npj Digital
  Medicine*, not Koerber et al. in *The Lancet Digital Health*:
  [PMID 41513748](https://pubmed.ncbi.nlm.nih.gov/41513748/).

## 3. High-risk errors found

1. **Null evidence is repeatedly promoted to exact invariance.** Examples are
   exact frequency neutrality (C-A02), an exact HR-independent hypertrophy
   pathway (C-L01), and the product source hierarchy (C-K02). A scientifically
   valid model could include small interactions and fail those tests.
2. **Qualitative relationships are labelled production `IMPLEMENT` while the
   required quantitative transition is `DEFER`.** This affects resistance and
   stepper glycogen (P-F02/P-G02), transient water (P-J03/P-J04), and the sleep
   partition interaction (P-M03). Such records are useful research constraints,
   but are not yet production parameters.
3. **The glycogen-water interval is over-bounded.** A 3–4 ratio is a useful
   central co-variation estimate, not a validated hard lower/upper biological
   bound or molecular constant. C-I03's “above 4” classification boundary is
   too precise.
4. **The glycogen capacity envelope is not an individual bound.** The
   0.3–0.86 kg value is derived by adding descriptive muscle and liver ranges
   from a narrative review. It is unsuitable as a production clamp and weak as
   a universal warning threshold.
5. **Citation attribution is unreliable in multiple records.** Real PMIDs are
   paired with the wrong first author and, in several cases, the wrong journal.
   This does not automatically invalidate the extracted result, but it prevents
   the current ledger from being treated as citation-clean.
6. **Cross-modality extrapolation remains too strong for a RED monotonicity
   test.** Stepper carbohydrate reliance is inferred mainly from five-person
   cycling physiology and a contested crossover framework. C-G02 is not safe
   as a strict stepper invariant.
7. **One small severe sleep-restriction diet trial cannot support a production
   sleep×partition behavior.** P-M03/C-M04 must remain deferred.

## 4. Topic-by-topic audit A–N

| Topic | Verdict | Independent audit |
|---|---|---|
| A — resistance dose | PARTIALLY SUPPORTED | Set volume is a defensible program descriptor and higher volume tends to improve local hypertrophy over studied ranges. Universal concavity and exact volume-equated frequency neutrality are stronger than the evidence. No kg/set or hard cap is supportable. |
| B — training status | PARTIALLY SUPPORTED | Greater prior adaptation plausibly lowers group-average headroom, but evidence is small, male-heavy, regional, and inconsistent across syntheses. Use an uncertainty-bearing prior, not a deterministic ordering or coefficient. |
| C — detraining | PARTIALLY SUPPORTED | Eventual size loss and reduced-dose maintenance are supported. Onset, rate, grace period, whole-body conversion, and retraining acceleration remain unknown. |
| D — protein | SUPPORTED | Bounded population-level adequacy and a retention benefit under deficit are defensible. The 1.62 breakpoint is FFM-based and not an individual threshold. Timing and very-high-protein bonuses are correctly excluded. |
| E — energy balance | PARTIALLY SUPPORTED | Deficit suppression and RT-associated retention are well supported directionally. Surplus partition is based heavily on one very small trained-lifter trial; P-E04 is not production-ready. |
| F — resistance glycogen | PARTIALLY SUPPORTED | Local depletion and set/session ordering are credible. Whole-body kg and an implemented transition are not. The prediction interval crossing zero and very high heterogeneity prohibit a universal coefficient. |
| G — stepper glycogen | OVERSTATED | Direct stepper glycogen evidence was not found. Energy intensity is direct; substrate and glycogen behavior are extrapolated. A strict monotonic stepper carbohydrate RED test is premature. |
| H — glycogen repletion | SUPPORTED | Carbohydrate-, depletion-, and capacity-dependent repletion is well supported locally. Aggregate kg/day and capacity remain uncalibrated. Short-recovery timing should not become a daily-model test. |
| I — glycogen water/capacity | PARTIALLY SUPPORTED | Co-variation and measurement confounding are strong. The 3–4 ratio is inferential and context-dependent, not a hard bound. The 0.3–0.86 aggregate range is a derived descriptive envelope, not a personal cap. |
| J — transient water | PARTIALLY SUPPORTED | Acute swelling, delayed eccentric damage, and repeated-bout attenuation are supported locally. No whole-body kilograms, universal kernel, or reliable workout-record modifier is available. |
| K — stepper energy/HR | PARTIALLY SUPPORTED | Wearable EE uncertainty and active/gross normalization are strong. The source hierarchy is a pragmatic engineering policy, not a scientifically demonstrated accuracy ordering. |
| L — resistance HR | SUPPORTED | HR/HRV are not validated anabolic-dose variables; program structure should remain primary. “No independent multiplier in v7” is defensible policy, but not proof of exact biological zero effect. |
| M — sleep | PARTIALLY SUPPORTED | Severe restriction affects acute MPS and may worsen diet partition. Chronic skeletal-muscle dose-response, single-night coefficients, debt kinetics, and consumer-stage effects are not established. |
| N — EPOC | SUPPORTED | EPOC exists, is heterogeneous, and is vulnerable to interval double counting. Rejecting an inferred v7 add-on is scientifically defensible. |

## 5. Parameter audit summary

All 70 parameter records were reviewed. The 29 primary `IMPLEMENT` records are
adjudicated in full below. Of them:

- **14 confirmed:** KEEP IMPLEMENT without a scientific-decision change;
- **7 require revision:** KEEP IMPLEMENT only after wording/representation is
  weakened;
- **8 should be DEFER:** insufficient directness or an engineering policy is
  being presented as a scientific parameter;
- **0 should be REJECT:** none of the 29 requires rejecting the underlying
  concept entirely.

Across all records, missing-data behavior is generally an engineering/data
validity policy, not a physiological finding. It should be labelled as such.

## 6. Full audit of all 29 IMPLEMENT decisions

| Parameter | Current confidence | Audit verdict | Evidence / representation / value / bounds / population | Recommended decision |
|---|---|---|---|---|
| P-A01 | MODERATE | PARTIALLY SUPPORTED | Hard sets are a reasonable dose descriptor; indirect weighting and whole-body aggregation are unvalidated. No numeric value/bound. Missing-program behavior is engineering. | KEEP IMPLEMENT |
| P-A02 | MODERATE direction; LOW shape | OVERSTATED | Positive dose direction is supported; universal concavity/saturation is not sufficiently invariant across muscles, status, and high volumes. | KEEP IMPLEMENT after revising to non-decreasing over an evidence-supported low-to-moderate range; do not require a global concave curve. |
| P-A04 | MODERATE/LOW | PARTIALLY SUPPORTED | Effort matters, but the product's “hard set” annotation is an engineering assumption and no RIR threshold is validated. | KEEP IMPLEMENT as metadata qualification, not physiology coefficient. |
| P-B01 | MODERATE ordering; VERY LOW magnitude | OVERSTATED | Group-average attenuation is plausible; deterministic novice≥advanced output is not established and populations are male/young-heavy. | KEEP IMPLEMENT only as a prior/uncertainty state with overlapping distributions. |
| P-C01 | MODERATE/LOW | PARTIALLY SUPPORTED | No same-day tissue step and eventual loss are defensible. Onset, monotonic shape, and rate are not. Unknown coverage must not imply cessation. | KEEP IMPLEMENT |
| P-C02 | MODERATE/LOW | PARTIALLY SUPPORTED | Reduced loading can maintain local/fiber outcomes in specific protocols; a generic “maintenance region” is uncalibrated and age-sensitive. | KEEP IMPLEMENT only as cessation/non-cessation distinction; no threshold. |
| P-D01 | MODERATE | PARTIALLY SUPPORTED | Saturating population response is credible, but 1.62 (1.03–2.20) is an FFM meta-regression estimate, not a personal skeletal-muscle parameter. | KEEP IMPLEMENT after removing any hard breakpoint behavior. |
| P-D02 | MODERATE direction; LOW amount | PARTIALLY SUPPORTED | Higher protein can improve lean retention in severe deficits; studies are short and proxy-based. Non-worsening within studied ranges is reasonable. | KEEP IMPLEMENT |
| P-E01 | MODERATE/HIGH direction; LOW curve | SUPPORTED | Deficit suppression is directionally supported; ~500 kcal/day is not a cutoff. Asymmetry and recomposition allowance are appropriate. | KEEP IMPLEMENT |
| P-E02 | HIGH FFM; MODERATE muscle | PARTIALLY SUPPORTED | RT improves FFM retention relative to diet only. Endpoint must remain proxy-labelled and magnitude deferred. | KEEP IMPLEMENT |
| P-E04 | MODERATE direction; LOW quantitative | OVERSTATED | One tiny, underpowered trained-lifter trial plus general mass accounting does not establish a production partition rule. | DOWNGRADE TO DEFER; keep only the separate invariant that muscle gain cannot be an unbounded linear kcal conversion. |
| P-F02 | MODERATE | PARTIALLY SUPPORTED | Study-level set meta-regression supports local ordering, not an aggregate transition. P-F01 itself is deferred. | DOWNGRADE TO DEFER until a production state transition exists; retain as research constraint. |
| P-G02 | MODERATE after extrapolation | OVERSTATED | Cycling/general substrate evidence is not direct stepper validation; strict monotonicity across all intensities is too strong. | DOWNGRADE TO DEFER. |
| P-H01 | HIGH direction; LOW aggregate amount | SUPPORTED | Carbohydrate and depletion drive local resynthesis and capacity bounds it. Exact kg/day remains deferred. | KEEP IMPLEMENT as qualitative state logic only. |
| P-I01 | MODERATE range; LOW individual | OVERSTATED | 3–4 is a derived/inferred central co-variation range. It is not a hard bound or directly measured molecular hydration ratio. | KEEP IMPLEMENT after treating 3–4 as uncertain prior/typical range, not clamp/classification cutoff. |
| P-I02 | MODERATE descriptor; LOW individual | OVERSTATED | 0.3–0.86 is derived from secondary descriptive muscle+liver ranges and can fail for body size/depletion/supercompensation. | DOWNGRADE TO DEFER as a scientific bound; optional soft diagnostic context only. |
| P-J03 | HIGH direction; LOW magnitude | PARTIALLY SUPPORTED | Repeated-bout attenuation is supported for local damage markers, less directly for whole-body water. Novelty cannot be reliably inferred from ordinary records. | DOWNGRADE TO DEFER as production modifier. |
| P-J04 | HIGH direction | PARTIALLY SUPPORTED | Eccentric damage direction is credible, but exposure coding and water quantity are absent. | DOWNGRADE TO DEFER as production modifier. |
| P-K01 | LOW/MODERATE | UNSUPPORTED | No evidence proves device kcal→HR estimate→MET is a universal accuracy order. This is a reasonable product fallback policy only. | DOWNGRADE TO DEFER scientifically; may IMPLEMENT separately as `ENGINEERING ASSUMPTION`. |
| P-K02 | HIGH | SUPPORTED | Wearable EE error is materially variable. No universal error distribution is supported. | KEEP IMPLEMENT |
| P-K03 | MODERATE ordering; LOW kcal | PARTIALLY SUPPORTED | HR can assist relative intensity for steady aerobic work, especially with personal calibration. It is not direct energy. | KEEP IMPLEMENT after restricting role to intensity/context. |
| P-K06 | MODERATE/LOW | PARTIALLY SUPPORTED | Direct stair studies support vigorous anchors, not a machine-wide MET bound. Net/gross semantics and broad uncertainty are required. | KEEP IMPLEMENT after labelling chosen MET/range engineering. |
| P-K07 | HIGH | SUPPORTED | Active/gross normalization follows conservation and prevents resting-energy double count. | KEEP IMPLEMENT |
| P-L02 | HIGH | SUPPORTED | Program-derived local dose should not depend on HR availability. Exact hypertrophy remains uncalibrated. | KEEP IMPLEMENT |
| P-L03 | MODERATE | SUPPORTED | HR is suitable as auxiliary cardiovascular/data-quality context outside anabolic dose. | KEEP IMPLEMENT |
| P-L04 | MODERATE | PARTIALLY SUPPORTED | Activity-specific wrist PPG uncertainty is real; −7.26 bpm is not a correction or universal ranking. | KEEP IMPLEMENT |
| P-M03 | MODERATE direction; VERY LOW muscle magnitude | OVERSTATED | Based mainly on one n=10, 14-day, severe-restriction DXA trial. No skeletal-muscle production interaction is established. | DOWNGRADE TO DEFER. |
| P-M04 | MODERATE context | SUPPORTED | Consumer total sleep duration can be retained with provenance/uncertainty; it has no validated direct physiology coefficient. | KEEP IMPLEMENT |
| P-N03 | HIGH | SUPPORTED | Counting an observed time interval once is an accounting invariant. | KEEP IMPLEMENT |

### Remaining 41 parameter records

| Parameter | Audit verdict | Recommendation |
|---|---|---|
| P-A03 | PARTIALLY SUPPORTED | KEEP REJECT for an independent causal multiplier; do not claim exact biological neutrality. |
| P-A05 | SUPPORTED | KEEP REJECT within sufficiently hard studied loads; preserve exclusions for very low/non-hard work. |
| P-A06 | SUPPORTED | KEEP DEFER. |
| P-A07 | SUPPORTED | KEEP DEFER. |
| P-B02 | SUPPORTED | KEEP DEFER for chronic gain. |
| P-B03 | PARTIALLY SUPPORTED | KEEP DEFER. |
| P-B04 | SUPPORTED | KEEP DEFER. |
| P-B05 | SUPPORTED | KEEP REJECT. |
| P-C03 | SUPPORTED | KEEP REJECT. |
| P-C04 | SUPPORTED | KEEP REJECT. |
| P-C05 | SUPPORTED | KEEP DEFER. |
| P-D03 | PARTIALLY SUPPORTED | KEEP DEFER. |
| P-D04 | PARTIALLY SUPPORTED | KEEP REJECT as a v7 independent multiplier; null evidence is not proof of no effect. |
| P-D05 | SUPPORTED | KEEP REJECT unbounded/continued bonus. |
| P-E03 | SUPPORTED | KEEP DEFER. |
| P-E05 | SUPPORTED | KEEP REJECT. |
| P-E06 | SUPPORTED | KEEP DEFER. |
| P-F01 | SUPPORTED locally; UNVERIFIABLE for kg | KEEP DEFER numeric transition. |
| P-F03 | SUPPORTED | KEEP REJECT simple positive load multiplier. |
| P-F04 | SUPPORTED | KEEP REJECT. |
| P-G01 | UNVERIFIABLE for stepper kg | KEEP DEFER. |
| P-G03 | SUPPORTED | KEEP REJECT. |
| P-H02 | SUPPORTED acutely | KEEP DEFER at daily resolution. |
| P-H03 | SUPPORTED | KEEP REJECT independent matched-energy bonus. |
| P-H04 | UNVERIFIABLE personally | KEEP DEFER. |
| P-I03 | SUPPORTED | KEEP REJECT ECF double count. |
| P-I04 | SUPPORTED | KEEP REJECT. |
| P-J01 | SUPPORTED locally; UNVERIFIABLE for kg | KEEP DEFER numeric implementation. |
| P-J02 | SUPPORTED locally; UNVERIFIABLE for kg/kernel | KEEP DEFER numeric implementation. |
| P-J05 | SUPPORTED | KEEP REJECT universal coefficient. |
| P-K04 | SUPPORTED | KEEP DEFER numeric sampling threshold. |
| P-K05 | SUPPORTED | KEEP REJECT. |
| P-L01 | SUPPORTED as v7 exclusion | KEEP REJECT; phrase as “not validated,” not biological zero. |
| P-L05 | PARTIALLY SUPPORTED | KEEP REJECT for v7; two small null RCTs are not equivalence proof. |
| P-M01 | PARTIALLY SUPPORTED | KEEP DEFER numerical production effect. |
| P-M02 | SUPPORTED | KEEP REJECT. |
| P-M05 | SUPPORTED | KEEP REJECT. |
| P-M06 | SUPPORTED | KEEP DEFER. |
| P-N01 | SUPPORTED | KEEP REJECT inferred add-on. |
| P-N02 | SUPPORTED | KEEP REJECT fixed percentage. |
| P-N04 | SUPPORTED | KEEP DEFER. |

## 7. Testable-claim audit summary

All 81 claims were reviewed against their cited evidence and against the
question, “Could a scientifically valid model fail this test?”

- **49 SAFE FOR RED TEST**
- **28 SAFE AFTER REVISION**
- **4 NOT SAFE FOR RED TEST**

The main unsafe pattern is not a false physiological direction; it is converting
an extrapolated association, a deferred feature, or a pragmatic product policy
into a compulsory scientific invariant.

## 8. Full table of all 81 Claim IDs

“Current wording” below preserves each claim's current heading; the replacement
column gives the minimum defensible change where needed.

| Claim | Current wording | Verdict | Minimal required correction |
|---|---|---|---|
| C-A01 | More effective weekly volume must not reduce predicted hypertrophy | SAFE AFTER REVISION | Over an evidence-supported low-to-moderate weekly-volume range, higher effective volume should not lower **group-expected** local hypertrophy; diminishing returns may be represented but global concavity is not required. |
| C-A02 | Volume-equated frequency neutrality | SAFE AFTER REVISION | When effective weekly volume is equated, frequency has no **required independent positive effect** in v7; do not require exact equality across every schedule. |
| C-A03 | Hard sets work without tonnage | SAFE FOR RED TEST | — |
| C-A04 | Momentary failure is not mandatory | SAFE AFTER REVISION | Near-failure and momentary-failure training can both be effective; do not require an exact equality or categorical failure bonus. |
| C-A05 | Load is not a standalone hypertrophy multiplier | SAFE AFTER REVISION | Within studied load ranges, with sufficient effort and comparable effective work, lower load must not automatically be assigned lower hypertrophy. |
| C-A06 | No unsupported hard volume cap | SAFE FOR RED TEST | — |
| C-B01 | Training status changes adaptive headroom | SAFE AFTER REVISION | Training status may shift the prior distribution of expected response; do not assert a deterministic novice≥advanced result for every matched pair. |
| C-B02 | No exact gain rate from experience | SAFE FOR RED TEST | — |
| C-B03 | Program novelty is not chronic muscle | SAFE FOR RED TEST | — |
| C-B04 | Acute MPS cannot directly set long-term gain | SAFE FOR RED TEST | — |
| C-B05 | Muscle memory receives no unsupported bonus | SAFE FOR RED TEST | — |
| C-C01 | Cessation does not instantly remove muscle tissue | SAFE FOR RED TEST | — |
| C-C02 | Longer cessation does not imply less loss risk | SAFE AFTER REVISION | In a modeled continuous cessation episode with other conditions fixed, longer duration must not create an artificial recovery/bonus; do not enforce a universal atrophy curve. |
| C-C03 | Reduced training differs from zero training | SAFE AFTER REVISION | A validated nonzero loading exposure must not be automatically classified as complete cessation; maintenance magnitude remains untested. |
| C-C04 | Age-specific maintenance uncertainty | SAFE AFTER REVISION | Preserve age-related uncertainty; do not require a directional age multiplier from the single protocol. |
| C-C05 | Strength loss is not muscle loss | SAFE FOR RED TEST | — |
| C-C06 | Resumption restores stimulus without invented memory gain | SAFE FOR RED TEST | — |
| C-D01 | Protein adequacy is monotonic then bounded | SAFE AFTER REVISION | Across low-to-adequate intakes at the population level, increasing protein should not worsen expected adaptation; plateau behavior is allowed, and 1.62 is not a switch. |
| C-D02 | Protein supports retention during deficit | SAFE AFTER REVISION | Within studied deficit/intake contexts, higher protein should not worsen **expected proxy-measured retention**; do not guarantee skeletal-muscle gain. |
| C-D03 | Adequate protein cannot override other bounds | SAFE FOR RED TEST | — |
| C-D04 | Missing protein is not zero | SAFE FOR RED TEST | — |
| C-D05 | Timing does not independently drive v7 hypertrophy | SAFE AFTER REVISION | v7 applies no separately calibrated timing/distribution coefficient; this is an omission for insufficient evidence, not proof of exactly zero biological effect. |
| C-E01 | Larger sustained deficit does not improve expected muscle gain | SAFE FOR RED TEST | — |
| C-E02 | Deficit does not make recomposition impossible | SAFE AFTER REVISION | The model must permit recomposition scenarios without asserting that DXA/LBM gain is skeletal-muscle gain. |
| C-E03 | Resistance training improves retention ordering | SAFE AFTER REVISION | Resistance training should not worsen expected **FFM retention** versus otherwise matched diet-only loss; skeletal-muscle magnitude remains uncertain. |
| C-E04 | Surplus is not required for all hypertrophy | SAFE FOR RED TEST | — |
| C-E05 | Larger surplus cannot yield unlimited muscle | SAFE FOR RED TEST | — |
| C-E06 | Deficit and surplus are not mirror images | SAFE FOR RED TEST | — |
| C-F01 | Strength workouts consume, not create, glycogen | SAFE FOR RED TEST | — |
| C-F02 | Depletion is store-bounded | SAFE FOR RED TEST | — |
| C-F03 | More matched hard sets do not reduce demand | SAFE AFTER REVISION | For an isolated session where the higher-set protocol contains the lower-set protocol plus additional comparable work and no intervening refeeding/recovery, cumulative demand should not be lower. |
| C-F04 | Muscle recruitment matters | SAFE FOR RED TEST | — |
| C-F05 | Resistance and aerobic glycogen conversions differ | SAFE FOR RED TEST | — |
| C-G01 | Stepper demand is nonnegative and state-bounded | SAFE FOR RED TEST | — |
| C-G02 | Relative intensity orders carbohydrate reliance | NOT SAFE FOR RED TEST | No strict stepper invariant is justified. Retain only a documented, low-confidence expectation that higher relative aerobic intensity often increases carbohydrate contribution; keep the production transition deferred. |
| C-G03 | Duration increases total demand but not at a fixed glycogen rate | SAFE AFTER REVISION | For one continuous matched bout, total energy demand is non-decreasing with duration; do not assert monotonic **muscle-glycogen** depletion or carbohydrate fraction. |
| C-G04 | Equal active kcal does not imply equal glycogen | SAFE FOR RED TEST | — |
| C-H01 | Carbohydrate increases refill opportunity | SAFE FOR RED TEST | — |
| C-H02 | Repletion slows at capacity | SAFE FOR RED TEST | — |
| C-H03 | Daily total can dominate timing | SAFE AFTER REVISION | At daily resolution and without a second near-term workout, v7 need not apply a meal-frequency effect; do not assert physiological equality. |
| C-H04 | Short recovery preserves timing relevance | NOT SAFE FOR RED TEST | The direction is credible, but the intra-day feature is explicitly deferred. Keep as research evidence, not a v7 RED specification. |
| C-H05 | Protein is not double-counted for glycogen | SAFE FOR RED TEST | — |
| C-I01 | Associated water co-moves with glycogen | SAFE AFTER REVISION | Associated water should co-vary with modeled glycogen; treat 3–4 kg/kg as a typical uncertain prior, not a hard bound. |
| C-I02 | No glycogen-water double counting | SAFE FOR RED TEST | — |
| C-I03 | Excess hydration is not all glycogen water | SAFE AFTER REVISION | Water beyond the selected glycogen-associated component must not automatically be assigned to glycogen; remove the hard “exceeds 4” threshold. |
| C-I04 | Glycogen loading is not hypertrophy | SAFE FOR RED TEST | — |
| C-I05 | Glycogen state obeys broad physiological plausibility | SAFE AFTER REVISION | Use 0.3–0.86 kg only as descriptive contextual metadata, never a pass/fail bound or silent clamp; body-size and store-specific validation is required first. |
| C-J01 | Acute swelling is not muscle tissue | SAFE FOR RED TEST | — |
| C-J02 | Immediate and delayed responses differ | SAFE AFTER REVISION | The model must allow distinct time courses; it need not infer the class from ordinary workout data or force a universal two-component response. |
| C-J03 | Repeated exposure attenuates damage response | SAFE AFTER REVISION | Prior exposure may lower expected damage-marker/edema response on average; do not require a deterministic non-increase for every individual. |
| C-J04 | Routine trained workout can resolve rapidly | SAFE FOR RED TEST | — |
| C-J05 | Damaging bout can persist across days | SAFE FOR RED TEST | — |
| C-J06 | Transient water returns toward baseline | SAFE AFTER REVISION | In the absence of new causes, the isolated transient component must remain finite and trend toward baseline; do not require an exact zero or half-life. |
| C-K01 | Wearable active kcal is not exact | SAFE FOR RED TEST | — |
| C-K02 | Source hierarchy degrades explicitly | NOT SAFE FOR RED TEST | The hierarchy may be tested as an explicitly labelled engineering fallback policy, not as a scientific accuracy ordering. No source is universally most accurate. |
| C-K03 | Individual calibration is more informative | SAFE AFTER REVISION | A valid, current, modality-relevant personal calibration generally supports no greater uncertainty than an otherwise equivalent population equation; do not make this unconditional. |
| C-K04 | Sparse HR cannot recover unobserved transitions | SAFE FOR RED TEST | — |
| C-K05 | Max HR alone is not calorie dose | SAFE FOR RED TEST | — |
| C-K06 | Stepper energy scales with duration/body mass | SAFE AFTER REVISION | At the same mechanical protocol and efficiency assumptions, expected gross energy is non-decreasing with duration; body-mass scaling is an estimate, not an exact physiological invariant. |
| C-K07 | Gross and active kcal cannot be mixed | SAFE FOR RED TEST | — |
| C-L01 | HR does not independently add hypertrophy | SAFE AFTER REVISION | v7 applies no independent causal HR multiplier after program-derived dose is represented; do not claim HR contains zero residual information. |
| C-L02 | Missing HR does not erase strength stimulus | SAFE FOR RED TEST | — |
| C-L03 | Equal HR does not imply equal local stimulus | SAFE FOR RED TEST | — |
| C-L04 | Resistance HR carries larger measurement uncertainty | SAFE AFTER REVISION | Wrist-HR uncertainty must be activity/device specific; do not require resistance error to exceed steady treadmill error for every device/person. |
| C-L05 | HRV is not a muscle-gain multiplier | SAFE AFTER REVISION | v7 uses no HRV hypertrophy coefficient because benefit is unvalidated; do not interpret two small null RCTs as equivalence proof. |
| C-M01 | Sustained severe restriction must not improve muscle expectation | SAFE AFTER REVISION | Severe multi-night restriction must not create a positive anabolic bonus solely from sleep; no exact chronic penalty is required. |
| C-M02 | Acute MPS is not chronic muscle kg | SAFE FOR RED TEST | — |
| C-M03 | One poor night has no exact daily multiplier | SAFE FOR RED TEST | — |
| C-M04 | Sleep-restricted diet can shift partition adversely | NOT SAFE FOR RED TEST | Keep as a low-certainty possible direction from one n=10 DXA study. Do not encode a production partition assertion until replicated with relevant composition endpoints. |
| C-M05 | Missing sleep is unknown | SAFE FOR RED TEST | — |
| C-M06 | Consumer stages do not drive physiology | SAFE FOR RED TEST | — |
| C-M07 | Wearable sleep is not PSG | SAFE FOR RED TEST | — |
| C-N01 | No automatic EPOC add-on | SAFE FOR RED TEST | — |
| C-N02 | No universal EPOC percentage | SAFE FOR RED TEST | — |
| C-N03 | Observed recovery energy is counted once | SAFE FOR RED TEST | — |
| C-N04 | EPOC is not zero physiology | SAFE FOR RED TEST | — |
| C-MV01 | Local hypertrophy is not whole-body hypertrophy | SAFE FOR RED TEST | — |
| C-MV02 | Lean mass is not skeletal muscle | SAFE FOR RED TEST | — |
| C-MV03 | Acute MPS is not accumulated muscle mass | SAFE FOR RED TEST | — |
| C-MV04 | Body weight conserves total mass only | SAFE FOR RED TEST | — |
| C-MV05 | Longitudinal method consistency | SAFE FOR RED TEST | — |

## 9. Numerical-value audit

| Value | Classification | Audit verdict and recalculation/check |
|---|---|---|
| +0.37 percentage points per weekly set (E-A01) | DIRECTLY REPORTED | SUPPORTED as an ecological meta-regression estimate; UNSUPPORTED as an individual or production coefficient. |
| Pelland diminishing-return curve (E-A02) | BODYCAST INTERPRETATION | Direction is supported; no usable universal coefficients were reported in the abstract. A required global concave function is OVERSTATED. |
| 1.62 g/kg/day protein breakpoint; 95% CI 1.03–2.20 | DIRECTLY REPORTED | Verified. The breakpoint test was p=0.079 and outcome was FFM. It is not an exact individual threshold. |
| Approximately 0.9–2.4 g/kg/day “studied range” | BODYCAST INTERPRETATION | NOT FULLY VERIFIED from the cited summary and must not become production bounds. |
| 2.3–3.1 g/kg FFM/day deficit range | BODYCAST INTERPRETATION | Inferential review recommendation, not a validated breakpoint. Correctly deferred. |
| Approximately 500 kcal/day deficit crossover | DIRECTLY REPORTED | Verified as a study-level lean-mass meta-regression estimate. Not a personal threshold. |
| 0.7% vs 1.4% body-weight loss/week | DIRECTLY REPORTED target rates | Trial-specific and confounded by different achieved durations; not production bounds. |
| −104.3 mmol/kg dry muscle; CI −137.6 to −71.0; PI −244.4 to +35.7 | DIRECTLY REPORTED | Verified. Local vastus-lateralis concentration only; high heterogeneity. No kg conversion is valid. |
| −11.2 mmol/kg dry mass/set and −1.3/minute | DIRECTLY REPORTED study-level moderators | Verified; collinear/ecological and not additive coefficients. |
| Stepper 8.6–9.6 gross MET | DIRECTLY REPORTED protocol observations | Direct for specific stair protocols, not a stepper bound or universal MET. |
| 23.5 mmol/kg dry mass/hour carbohydrate contrast | DIRECTLY REPORTED | Verified as the incremental contrast versus noncaloric control, not total rate or whole-body refill. |
| 7–10 g/kg/day restored baseline at 24 h | DIRECTLY REPORTED scenario result | Eight male endurance athletes after deep depletion; not a threshold. |
| 3–4 kg water/kg glycogen | DERIVED FROM REPORTED VALUES and BODYCAST INTERPRETATION | Olsson/Saltin estimated at least 500 g glycogen and +2.2 L water: 2.2/0.5 = 4.4 L/kg using the lower-bound glycogen estimate; the published/review interpretation is approximately 3–4, demonstrating that it is not an exact derivation or hard bound. |
| ~17:1 water:glycogen with full rehydration | DERIVED FROM REPORTED VALUES | Supports confounding by additional water, not a glycogen-bound ratio. |
| 0.3–0.86 kg aggregate glycogen | DERIVED FROM REPORTED VALUES | 0.3–0.7 muscle + 0–0.16 liver = 0.3–0.86 kg. Arithmetic is correct; using it as a universal physiological bound is OVERSTATED. |
| Local edema 24–96 h; longer after extreme eccentric work | DIRECTLY REPORTED across heterogeneous local studies | Supports broad possibility windows only. No kilograms or universal decay constant. |
| Wearable EE MAPE 9.71–151.66% | DIRECTLY REPORTED in E-K01 synthesis | Source exists, but citation metadata were wrong. No universal percentage error distribution follows. |
| Wrist PPG −7.26 bpm, CI −10.46 to −4.07 | DIRECTLY REPORTED pooled mean | Not a personal correction and not proof every resistance session is less accurate than every treadmill session. |
| Sleep MPS −18% | DERIVED FROM REPORTED VALUES | (0.072−0.059)/0.072 = 18.1%; arithmetic is correct. Acute FSR is not chronic mass. |
| Sleep-diet FFM loss 2.4 vs 1.5 kg | DIRECTLY REPORTED | DXA FFM in n=10 over 14 days; not skeletal-muscle loss. |
| EPOC 6–15% of net exercise oxygen cost | DIRECTLY REPORTED review range | Protocol-qualified aerobic evidence, not a universal percentage. Correctly rejected for production. |
| 6.2 L oxygen ≈30 kcal | DERIVED FROM REPORTED VALUES | Using roughly 4.8–5.0 kcal/L gives 29.8–31.0 kcal. Appropriate contextual conversion, not a personal bound. |
| 7.4–10.3 L / 37–52 kcal EPOC | DIRECTLY REPORTED | Tiny dense-circuit study; not generalizable. |

Any clamp, default, rolling window, curve shape, missing-data value, sampling
threshold, or uncertainty distribution not listed as directly supported must be
labelled **ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER**.

## 10. Measurement-validity audit

| Modality | What it measures | What it does not measure | Can it support `skeletalMuscleKg`? | Main limitations |
|---|---|---|---|---|
| Whole-body MRI/CT | Segmented anatomical skeletal-muscle area/volume | Contractile protein alone, molecular composition, or hydration-free tissue | Yes, closest direct structural anchor, after documented segmentation and density conversion | Segmentation protocol, scanner/software, tissue density, hydration; CT radiation |
| Regional MRI/CT | Local/regional muscle CSA or volume | Total-body skeletal muscle | Only as a regional endpoint; no proportional whole-body conversion | Regional heterogeneity and acute fluid/T2 effects |
| Ultrasound | Site-specific thickness, architecture, or standardized CSA proxy | Whole-muscle volume or whole-body muscle kg | No direct support; local longitudinal proxy only | Operator/site/probe pressure, architecture, edema, poor local-to-whole transfer |
| DXA | Bone mineral, fat, and lean soft tissue by attenuation model | Skeletal muscle specifically | Proxy only; never direct calibration of `skeletalMuscleKg` | Water, glycogen, organs, connective tissue, device/software and positioning |
| BIA/device “skeletal muscle” | Electrical impedance transformed by proprietary/published equations | Direct anatomy or tissue accretion | No; may inform a noisy observation model only | Hydration, meals, temperature, exercise, algorithm/device dependence |
| Biopsy/fiber CSA | Microscopic area/composition in sampled fibers | Whole muscle or whole-body muscle mass | No direct conversion | Tiny sample volume, fiber type, orientation, site selection |
| Stable isotope/tracer MPS | Synthesis flux over a measurement window | Net protein balance or accumulated tissue mass | No direct conversion; mechanistic context only | Acute window, damage/remodeling contribution, breakdown omitted |
| Scale weight | Total body mass under measurement conditions | Component identity | Constrains component sum only | Water, glycogen, gut content and all tissues are conflated |

The primary documents correctly prohibit direct local-to-whole-body, lean-to-
muscle, MPS-to-mass, and acute-swelling-to-hypertrophy conversions. No audited
source provides a validated route from local ultrasound, DXA FFM, biopsy,
tracer MPS, or scale weight to a precise change in whole-body
`skeletalMuscleKg`.

## 11. Abstract-only / unverified-source queue

All PMIDs now resolve, but metadata verification is not equivalent to full-text
verification. The following records materially affect an IMPLEMENT decision or
candidate RED claim and still require full-text extraction before they may
support quantitative precision:

| Evidence IDs | Status | Restriction |
|---|---|---|
| E-A01, E-A02, E-A06–E-A08, E-A10–E-A14 | ABSTRACT-ONLY VERIFIED or abstract-led | Directional dose, frequency, effort, and high-volume interpretation only; no production curve, cap, or exact neutrality. |
| E-B01–E-B03, E-B05, E-B07–E-B13 | ABSTRACT-ONLY VERIFIED | Training-status direction, novelty, and memory only; no coefficient or deterministic ordering. |
| E-C03–E-C05 | ABSTRACT-ONLY VERIFIED | Strength and protocol-specific maintenance findings; no muscle kg/rate/threshold. |
| E-D10 | ABSTRACT-ONLY VERIFIED | Small conflicting deficit trial; no exact protein requirement. |
| E-F02 | ABSTRACT-ONLY VERIFIED | Local extreme lower-body protocol only. |
| E-H07 | ABSTRACT-ONLY VERIFIED | Old heterogeneous rate range; not production-ready. |
| E-I01 | METADATA VERIFIED; quantitative extraction NOT FULLY VERIFIED from accessible original | The original has no PubMed abstract. The 3–4 interpretation is supported by later reviews but must remain inferential. |
| E-J06 | ABSTRACT-ONLY VERIFIED | Small trained-men acute study; permits rapid resolution but cannot set a universal duration. |

Records previously labelled “DOI not verified” now have resolvable PubMed DOI
metadata except E-G04, whose PubMed summary does not supply a DOI. This resolves
identifier existence, not the risk-of-bias or quantitative extraction.

## 12. Duplicate and questionable evidence records

### Duplicate records

| Duplicate Evidence ID | Original Evidence ID | Same paper |
|---|---|---|
| E-C06 | E-B11 | Cumming et al. human muscle-memory study |
| E-C07 | E-B12 | Psilander et al. training/detraining/retraining study |
| E-E03 | E-D06 | Longland et al. severe-deficit/high-protein trial |
| E-E07 | E-D05 | Mettler et al. short severe-deficit athlete trial |

The duplicate IDs should remain preserved for traceability, but the inventory
must count these as cross-references, not four additional papers.

### Incorrect or questionable citation metadata

The following PubMed identifiers are real, but the ledger's author attribution,
journal, year, or combined citation is incorrect. Content conclusions must be
rechecked after metadata correction.

| Evidence ID | Current citation problem | Independently verified metadata |
|---|---|---|
| E-B07 | Attributed to Rauch et al. | First author Damas F; PMID 31268828; DOI 10.1152/japplphysiol.00350.2019. |
| E-C08 | Attributed to Purdom et al. | First author Vikne H; PMID 32281690; DOI 10.1111/sms.13675. |
| E-D04 | Attributed to Kim et al.; journal shortened incorrectly | First author Kokura Y; *Clinical Nutrition ESPEN*; PMID 39002131; DOI 10.1016/j.clnesp.2024.06.030. |
| E-D08 | Wirth et al., *Nutrition Reviews* | Casuso & Goossens, *Nutrients* (2025); PMID 40647175; DOI 10.3390/nu17132070. |
| E-E02 | Attributed to Lopez et al. | First author Binmahfoz A; PMID 40909191; DOI 10.1136/bmjsem-2024-002363. |
| E-F04 | Attributed to van Loon et al. | First author Koopman R; PMID 16369816; DOI 10.1007/s00421-005-0118-0. |
| E-G03 | Attributed to Reynolds et al. (2013) | First author Halsey LG; *PLOS ONE* 2012; PMID 23251455; DOI 10.1371/journal.pone.0051213. |
| E-G06 | Combines Brooks & Mercier (1994) with a 1997 PMID/title/journal | PMID 9363377 is Brooks alone, *Clinical and Experimental Pharmacology & Physiology* (1997), DOI 10.1111/j.1440-1681.1997.tb02712.x. Brooks & Mercier (1994) is a different paper, PMID 7928844, DOI 10.1152/jappl.1994.76.6.2253. |
| E-G08 | Attributed to Costill et al. | First author Pascoe DD; PMID 2233197; DOI 10.1249/00005768-199010000-00009. |
| E-H05 | Attributed to Shiose et al. | First author Namma-Motonaga K; PMID 35405933; DOI 10.3390/nu14071320. |
| E-J01 | Attributed to Møller et al. | First author Kristiansen MS; PMID 24330190; DOI 10.1111/sms.12160. |
| E-J02 | Attributed to Chen & Nosaka | First author Radaelli R; PMID 22037095; DOI 10.1519/JSC.0b013e31823dae96. |
| E-J03 | Attributed to Maeo et al. | First author Ochi E; PMID 27632383; DOI 10.1007/s00421-016-3462-3. |
| E-J07 | Peake et al., *Physiological Reviews* | Stožer, Vodopivc & Križančić Bombek, *Physiological Research*; PMID 32672048; DOI 10.33549/physiolres.934371. |
| E-K01 | Koerber et al., *The Lancet Digital Health* | Lambe et al., *npj Digital Medicine* (2026); PMID 41513748; DOI 10.1038/s41746-025-02238-1. |
| E-L03 | Attributed to Hiscock et al. | First author Kraft JA; PMID 24378665; DOI 10.1519/JSC.0000000000000342. |
| E-L04 | Attributed to de Souza et al. | First author Paulo AC; PMID 32714194; DOI 10.3389/fphys.2020.00481. |
| E-L06 | Attributed to de Oliveira et al. (2025) | First author Bittencourt D; PubMed year 2024; PMID 39742158; DOI 10.3389/fphys.2024.1472702. |
| E-L08 | Attributed to Bellenger et al. | First author Støve MP; PMID 36803578; DOI 10.1080/02640414.2023.2180160. |
| E-M04 | Attributed to Lopes et al. | First author Borba DA; PMID 39268337; DOI 10.1055/s-0044-1787297. |

The Topic A scratch dump also records an erratum for the hypoxic-resistance
meta-analysis (PMID 36871095). That paper is not in the main 123-record ledger
and does not materially support an IMPLEMENT parameter; it should not be added
without reviewing the erratum and relevance.

No retraction was identified in the official PubMed metadata retrieved for the
117 cited PMIDs. Correction/erratum relationships were not exhaustively
full-text-audited and should remain part of any later regulatory-grade review.

## 13. Confidence-rating corrections

| Item | Current confidence | Corrected confidence |
|---|---|---|
| Volume-equated frequency exact neutrality (A03/C-A02) | HIGH | MODERATE for no important average independent effect; INSUFFICIENT for exact equality. |
| Training-status ordered headroom (P-B01/C-B01) | MODERATE | LOW/MODERATE for group prior; VERY LOW for pairwise deterministic ordering. |
| Reduced-dose maintenance generalization (P-C02) | MODERATE | MODERATE for existence in studied protocols; LOW for broad age/status transfer. |
| Excess-surplus fat partition (P-E04) | MODERATE direction | LOW; one tiny direct trained-lifter study. |
| Stepper intensity→carbohydrate monotonicity (P-G02/C-G02) | MODERATE | LOW due cross-modality transfer and no direct stepper substrate study. |
| Glycogen-water 3–4 bound (P-I01/C-I01) | MODERATE range | MODERATE for approximate co-variation; LOW/INSUFFICIENT as hard bound or individual value. |
| Aggregate glycogen 0.3–0.86 bound (P-I02) | MODERATE descriptor | LOW as audit bound; INSUFFICIENT as individual clamp. |
| Repeated-bout/eccentric water modifiers (P-J03/P-J04) | HIGH direction | HIGH for local damage direction; MODERATE/LOW for water and production-record applicability. |
| Stepper source hierarchy (P-K01/C-K02) | LOW/MODERATE | INSUFFICIENT as scientific ranking; acceptable only as engineering policy. |
| Sleep×deficit partition (P-M03/C-M04) | MODERATE direction | LOW for replication/generalization; VERY LOW for skeletal muscle. |

## 14. Cross-topic contradictions

1. Topic A says the dose curve is uncalibrated, while C-A01 requires diminishing
   marginal response. A scientifically valid monotone non-concave model could
   fail the current test.
2. Topic B says status categories cannot determine an individual rate, while
   C-B01 can be read as a deterministic novice-versus-trained ordering. The
   claim must operate on group priors/uncertainty, not paired outputs.
3. Topics F and G defer numeric glycogen transitions, while C-F03 and C-G02
   attempt to require production monotonicity. F can retain a narrowly
   controlled cumulative-demand relation; G cannot yet support a strict
   stepper rule.
4. Topic H requires capacity-bounded refill, while personal/default capacity is
   deferred. A bound test is safe only for an abstract supplied capacity, not a
   production default.
5. Topic I calls 3–4 uncertain but C-I01/C-I03 use it as a hard bound and
   classification threshold.
6. Topic J correctly defers kilograms and kernels but labels novelty/eccentric
   modifiers `IMPLEMENT`; ordinary workout data may not identify either state.
7. Topic K admits the source hierarchy is pragmatic, while C-K02 presents it as
   a scientific ordered fallback.
8. Topic M defers every numeric partition coefficient, while P-M03 is counted
   as `IMPLEMENT` and C-M04 invites a production response from one tiny proxy
   study.
9. Topics K and N correctly prohibit energy double counting, but device
   workout-only versus all-day interval semantics remain unresolved; the
   invariant is safe only when interval provenance is known.

## 15. Cross-document inconsistencies

| Evidence document | Parameter contract | Claims document | Required resolution |
|---|---|---|---|
| Frequency shows no meaningful average volume-equated effect | P-A03 REJECT, HIGH neutrality | C-A02 exact invariant | Replace exact neutrality with “no required independent multiplier.” |
| Dose curve coefficients unavailable | P-A02 IMPLEMENT concave/saturating | C-A01 requires diminishing marginal response | Do not require global concavity; restrict to a qualitative low-to-moderate range. |
| Training-status evidence inconsistent and proxy-based | P-B01 IMPLEMENT ordering | C-B01 novice headroom not lower | Convert to prior/uncertainty behavior. |
| P-F01 aggregate transition DEFER | P-F02 IMPLEMENT ordering | C-F03 RED monotonicity | Keep as research constraint or abstract function contract, not production physiology. |
| No direct stepper glycogen evidence | P-G02 IMPLEMENT extrapolated ordering | C-G02 strict monotonicity | DEFER and remove from immediate RED suite. |
| Personal capacity DEFER | P-H01 capacity-bounded IMPLEMENT | C-H02 exact bound | Test only when capacity is an explicit supplied abstract parameter. |
| 3–4 is uncertain and not molecularly measured | P-I01 range IMPLEMENT | C-I03 hard >4 classification | Remove hard threshold semantics. |
| Broad descriptive glycogen values from narrative review | P-I02 audit bound IMPLEMENT | C-I05 warning bound | Relabel contextual/diagnostic and defer scientific bound. |
| Whole-body edema amplitude unavailable | P-J03/P-J04 modifiers IMPLEMENT | C-J03 deterministic expected attenuation | Defer production modifiers; retain qualitative evidence. |
| Hierarchy explicitly called pragmatic | P-K01 IMPLEMENT | C-K02 ordered scientific fallback | Move to engineering policy tests. |
| One n=10 DXA sleep-diet trial | P-M03 directional interaction IMPLEMENT | C-M04 candidate RED behavior | DEFER both production effect and RED test. |

## 16. Known scientific gaps

The existing gap list is substantially correct. Add these missing gaps:

- no validated mapping from a qualitative scientific guardrail to a unique
  production function; many scientifically valid functions can satisfy or
  violate proposed concavity/equality tests;
- no validated whole-body effective-set aggregation across muscles, bilateral
  work, indirect sets, exercise selection, and weekly overlap;
- no direct evidence that the device-kcal→HR→MET hierarchy ranks error for a
  given person/device/session;
- no validated method to infer eccentric emphasis, novelty, or repeated-bout
  protection from ordinary workout records;
- no individual whole-body glycogen capacity or hard adult lower/upper bound;
- no validated separation of muscle versus liver glycogen using the proposed
  aggregate state;
- no replicated chronic sleep×diet skeletal-muscle partition effect;
- no established equivalence margin proving frequency, protein timing, HR, or
  HRV effects are exactly zero;
- no complete sex-, age-, medication-, disease-, and advanced-athlete
  generalization framework.

BodyCast must continue to state explicitly that it does not know exact daily
hypertrophy, session muscle gain, generic-workout glycogen kg, transient-water
kg, nightly sleep coefficients, or advanced-lifter rates.

## 17. Required corrections before RED tests

1. Apply every claim replacement in section 8 before generating tests.
2. Exclude C-G02, C-H04, C-K02, and C-M04 from the scientific RED suite.
3. Move P-E04, P-F02, P-G02, P-I02, P-J03, P-J04, P-K01, and P-M03 out of the
   scientific `IMPLEMENT` count. P-K01 may exist as an explicitly engineering
   policy.
4. Weaken P-A02, P-B01, P-C02, P-D01, P-I01, P-K03, and P-K06 as specified in
   section 6.
5. Correct the 20 citation-attribution records in section 12 and add the missing
   PMIDs for E-I02/E-I05.
6. Change the evidence inventory from 123 “scientific sources” to 123 Evidence
   IDs / 119 unique papers, and publish a reproducible source-type counting
   rule.
7. Mark all missing-data behavior and fallback ordering as data/engineering
   policy unless a physiological source directly supports it.
8. Require every RED test to state population, endpoint, time scale, directness,
   and whether it is conservation, classification, or empirical ordering.

## 18. Safe items for immediate RED-test conversion

The 49 immediately safe Claim IDs are:

`C-A03`, `C-A06`, `C-B02`–`C-B05`, `C-C01`, `C-C05`, `C-C06`, `C-D03`,
`C-D04`, `C-E01`, `C-E04`–`C-E06`, `C-F01`, `C-F02`, `C-F04`, `C-F05`,
`C-G01`, `C-G04`, `C-H01`, `C-H02`, `C-H05`, `C-I02`, `C-I04`, `C-J01`,
`C-J04`, `C-J05`, `C-K01`, `C-K04`, `C-K05`, `C-K07`, `C-L02`, `C-L03`,
`C-M02`, `C-M03`, `C-M05`–`C-M07`, `C-N01`–`C-N04`, and
`C-MV01`–`C-MV05`.

Even these tests must avoid inventing numerical tolerances. Conservation and
classification tests are safer than uncalibrated empirical curves.

## 19. Items that must remain DEFER/REJECT

In addition to all current DEFER/REJECT records, the following primary
IMPLEMENT records must be moved to DEFER scientifically:

`P-E04`, `P-F02`, `P-G02`, `P-I02`, `P-J03`, `P-J04`, `P-K01`, `P-M03`.

The following concepts must remain rejected as production predictors:

- acute MPS→chronic muscle conversion;
- strength decline→muscle kg;
- early morphology/lean change→contractile tissue;
- symmetric deficit/surplus muscle multiplier;
- workout kcal→glycogen fraction;
- glycogen water counted again as ECF;
- sets→transient-water kg;
- average/max HR or HRV→hypertrophy;
- consumer REM/Core/Deep→body-composition coefficients;
- automatic or percentage-based EPOC add-on.

## 20. Overall GO / CONDITIONAL GO / NO-GO decision

**CONDITIONAL GO** to scientific RED specification only after the section 17
corrections are applied and reviewed. **NO-GO** for converting the current 81
claims verbatim into tests.

The strongest verified component is the measurement/compartment discipline:
local morphology, DXA/BIA lean mass, acute MPS, glycogen water, and edema are
not silently converted into whole-body skeletal muscle.

The weakest verified component is stepper glycogen, followed by quantitative
transient water and chronic sleep partition. None has a defensible production
coefficient.

## PROPOSED CORRECTION QUEUE

The claim rows marked `SAFE AFTER REVISION` or `NOT SAFE FOR RED TEST` in
section 8 are the itemized correction queue for
`workout-physiology-v7-testable-claims.md`: each row preserves the Claim ID and
current heading, states the verdict, and gives replacement wording. Source
status is the topic status in sections 4 and 11.

Additional source/parameter corrections:

| File | ID | Current text/decision | Problem | Replacement recommendation | Reason | Verification status |
|---|---|---|---|---|---|---|
| evidence.md | Inventory | 123 scientific sources; 43 reviews; 57 studies | Evidence IDs are counted as sources and four are duplicates; subtype counts are not reproducible. | “123 Evidence IDs representing 119 unique papers; source-type counts provisional under stated rule.” | Prevent inflated evidence count. | All 117 PMIDs resolved; two missing PMIDs found. |
| evidence.md | E-C06/E-C07/E-E03/E-E07 | Separate evidence records | Duplicate papers. | Mark explicitly as cross-reference aliases and exclude from unique-paper count. | Avoid false replication. | VERIFIED duplicate. |
| evidence.md | E-B07, E-C08, E-D04, E-D08, E-E02, E-F04, E-G03, E-G06, E-G08, E-H05, E-J01, E-J02, E-J03, E-J07, E-K01, E-L03, E-L04, E-L06, E-L08, E-M04 | Current citation strings | Wrong author attribution and/or journal/year; E-G06 combines two papers. | Replace with official PubMed metadata in section 12 and recheck extraction against corrected source. | Citation integrity. | PMID/DOI metadata VERIFIED; full quantitative extraction varies. |
| evidence.md | E-I02 | PMID not verified | Missing identifier. | Add PMID 11903130. | Traceability. | VERIFIED. |
| evidence.md | E-I05 | PMID not verified | Missing identifier. | Add PMID 36615811. | Traceability. | VERIFIED. |
| parameter-contract.md | P-A02 | Global monotonic concave/saturating contract | Curve shape is over-generalized. | Restrict non-decrease to evidence-supported low-to-moderate range; allow but do not require diminishing returns. | A valid model could be non-concave across muscles/ranges. | PARTIALLY SUPPORTED. |
| parameter-contract.md | P-B01 | Novice response not lower | Deterministic ordering exceeds group evidence. | Use training status as uncertainty-bearing prior with overlapping response distributions. | Small/inconsistent proxy evidence. | PARTIALLY SUPPORTED. |
| parameter-contract.md | P-C02 | Nonzero maintenance region | Region/threshold uncalibrated. | Implement only cessation versus verified nonzero loading classification. | Protocol- and age-specific results. | PARTIALLY SUPPORTED. |
| parameter-contract.md | P-D01 | 1.62 and CI as adequacy behavior | Can become a hard personal threshold. | Treat as population anchor only; use smooth uncertainty without exact switch. | FFM meta-regression, wide CI. | VERIFIED population result. |
| parameter-contract.md | P-E04 | IMPLEMENT excess-surplus fat partition | Direct evidence too small for production partition. | DEFER; retain only bounded-muscle/no linear kcal→muscle invariant. | One underpowered trial. | PARTIALLY SUPPORTED. |
| parameter-contract.md | P-F02 | IMPLEMENT set-volume glycogen ordering | Numeric transition P-F01 is deferred. | DEFER production behavior; retain isolated-session research constraint. | No whole-body mapping. | Local evidence VERIFIED. |
| parameter-contract.md | P-G02 | IMPLEMENT strict stepper ordering | Cross-modality extrapolation presented as direct invariant. | DEFER. | No direct stepper substrate study. | EXTRAPOLATED. |
| parameter-contract.md | P-I01 | 3–4 bounded interval | Not a hard bound or molecular measurement. | Typical uncertain prior/co-variation range; no clipping or >4 classification. | Hydration produces context-dependent ratios. | PARTIALLY SUPPORTED. |
| parameter-contract.md | P-I02 | IMPLEMENT 0.3–0.86 audit bound | Derived secondary descriptor, not individual bound. | DEFER; optional contextual warning only. | Body size/depletion/supercompensation. | DERIVED, secondary source. |
| parameter-contract.md | P-J03/P-J04 | IMPLEMENT water modifiers | Local damage direction does not supply whole-body water behavior or reliable input state. | DEFER production modifiers. | Missing amplitude/kernel/exposure measurement. | PARTIALLY SUPPORTED. |
| parameter-contract.md | P-K01 | IMPLEMENT scientific source hierarchy | Accuracy order is not validated. | Label as engineering fallback policy or DEFER scientifically. | Device/person/activity dependence. | UNSUPPORTED as ranking. |
| parameter-contract.md | P-K03/P-K06 | HR/MET production roles | Can imply unsupported accuracy/values. | Restrict to context/intensity; label chosen equations/METs engineering assumptions. | No personal calibration or universal stepper MET. | PARTIALLY SUPPORTED. |
| parameter-contract.md | P-M03 | IMPLEMENT sleep×deficit interaction | One tiny DXA trial, no skeletal-muscle endpoint. | DEFER. | Very low directness/replication. | PARTIALLY SUPPORTED direction only. |

No corrections in this queue have been applied to the original three research
documents.
