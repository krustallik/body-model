# Stage 7/8 quantitative blocker rescue — research completeness audit

Date: 2026-09-18  
Scope: audit and corrective research only. No production code, scientific
claim status, Prisma schema, migration, or Stage-7/8 behavior was changed.

## Audit outcome

The original memo is **C — insufficient / mostly synthesis of existing project
research**. It was not comprehensive enough to drive implementation. It had:

- only a small visible citation set and no source ledger or search log;
- no A–T-by-topic traceability;
- an unsupported “20 Garmin sessions” engineering threshold;
- an incorrectly transcribed Janssen BIA equation;
- an overconfident Level-B interpretation of the Lee baseline equation;
- no explicit accounting for the Lee model's missing race predictor or obese
  validation bias;
- insufficiently documented negative searches for Level B/C alternatives.

Targeted follow-up research was performed before this audit was written and
the master memo was corrected. The corrected memo is **B — useful preliminary
memo but still requires model-specific calibration research**. It can guide
prototype and validation design; it cannot justify copying coefficients into
production. No implementation approval is requested.

## 1. Source count

“Reviewed” means the abstract, official page, or relevant full-text result was
read for a concrete BodyCast question. Search-result titles that were merely
screened, Reddit discussions, Wikipedia, duplicate URLs, theses that only
repeated a primary result, and vendor marketing were not counted.

| Measure | Count |
|---|---:|
| Unique external sources substantively reviewed | **37** |
| Primary human intervention studies | **9** |
| Validation studies | **10** |
| Systematic reviews/meta-analyses | **14** |
| Official Garmin/Apple documentation | **2** |
| Mechanistic/model/narrative sources | **2** |
| Published 2024–2026 (subset of the above) | **8** |
| Rejected after review for direct parameterization | **14** |

The design labels are mutually exclusive in the 37-source ledger; the recent
and rejected counts are subsets. Papers reached through multiple PubMed, PMC,
DOI, publisher, PDF, or ResearchGate URLs count once.

### Deduplicated source ledger

`R` means rejected as a direct BodyCast parameter source; it may still be
retained as limiting or contradictory evidence.

| ID | Source | Primary classification | Recent | R | Role |
|---|---|---|---:|---:|---|
| S01 | [Garmin: information shared with Apple Health](https://support.garmin.com/fi-FI/?faq=lK5FPB9iPF5PXFkIpFlFPA) | Official | No | No | Current export list and HR caveat. |
| S02 | [Apple HealthKit data types](https://developer.apple.com/documentation/healthkit/data-types) | Official | No | No | HealthKit capability, not Garmin export proof. |
| S03 | [Lee et al. 2000](https://pubmed.ncbi.nlm.nih.gov/10966902/) | Validation | No | No | MRI-referenced anthropometric total SM equations. |
| S04 | [Al-Gindan et al. 2014](https://ajcn.nutrition.org/article/S0002-9165%2823%2904785-8/fulltext) | Validation | No | Yes | External/simple anthropometric equations; waist/hip inputs and population transport limit current use. |
| S05 | [Janssen et al. 2000](https://pubmed.ncbi.nlm.nih.gov/10926627/) | Validation | No | No | MRI-referenced raw-resistance BIA equation. |
| S06 | [Consumer BIA versus MRI/DXA](https://pubmed.ncbi.nlm.nih.gov/20054195/) | Validation | No | No | Individual limits for bipedal/tetrapolar devices. |
| S07 | [Fifteen consumer BIA devices](https://pubmed.ncbi.nlm.nih.gov/36404739/) | Validation | No | No | Cross-sectional and longitudinal fat-% validity. |
| S08 | [Consumer BIA versus four-compartment model review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12922097/) | Systematic/meta | Yes | No | Modern criterion-method limitations. |
| S09 | [Multi-frequency BIA validation](https://pubmed.ncbi.nlm.nih.gov/39691170/) | Validation | Yes | Yes | Not Xiaomi 2; product/raw-measure mismatch. |
| S10 | [Robinson et al. 2024 RIR meta-regression](https://pubmed.ncbi.nlm.nih.gov/38970765/) | Systematic/meta | Yes | No | Continuous proximity-to-failure evidence. |
| S11 | [Failure versus nonfailure meta-analysis](https://pubmed.ncbi.nlm.nih.gov/33497853/) | Systematic/meta | No | Yes | Category contrast does not identify RIR 2+ probabilities. |
| S12 | [Trained-adult low- versus high-RIR trial](https://pubmed.ncbi.nlm.nih.gov/37144554/) | Primary intervention | No | Yes | Five-week, n=19, narrow program; insufficient transition calibration. |
| S13 | [Weekly-set dose meta-regression](https://pubmed.ncbi.nlm.nih.gov/27433992/) | Systematic/meta | No | No | Local hypertrophy volume association. |
| S14 | [Whole-body muscle-growth meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7068252/) | Systematic/meta | No | No | Broad FFM/LMM/SMM change distributions in healthy males. |
| S15 | [Whole-body MRI hypertrophy study](https://pubmed.ncbi.nlm.nih.gov/14665598/) | Primary intervention | No | Yes | Direct outcome but only three young men. |
| S16 | [D3-creatine strength-training trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC10848235/) | Primary intervention | No | No | Direct muscle change in 21 very old, low-functioning adults. |
| S17 | [Morton et al. protein meta-regression](https://pubmed.ncbi.nlm.nih.gov/28698222/) | Systematic/meta | No | No | Protein/RET FFM and local size response. |
| S18 | [Murphy & Koehler energy-deficit meta-regression](https://pubmed.ncbi.nlm.nih.gov/34623696/) | Systematic/meta | No | No | Deficit versus lean-mass response. |
| S19 | [Resistance training during dietary weight loss](https://bmjopensem.bmj.com/content/bmjosem/11/3/e002363.full.pdf) | Systematic/meta | Yes | No | FFM preservation and duration/adherence limits. |
| S20 | [Detraining in older adults](https://pubmed.ncbi.nlm.nih.gov/36360927/) | Systematic/meta | No | Yes | Age-restricted and mixed local measurement methods. |
| S21 | [Single-leg disuse meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC10067508/) | Systematic/meta | No | Yes | Disuse is not ordinary detraining; local outcome. |
| S22 | [Muscle glycogen re-synthesis meta-analysis](https://pubmed.ncbi.nlm.nih.gov/33507402/) | Systematic/meta | No | No | Timed ≤8-hour biopsy recovery. |
| S23 | [Resistance-exercise glycogen depletion meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC12717450/) | Systematic/meta | Yes | No | Local concentration change; high heterogeneity. |
| S24 | [Fuchs et al. 2025 paired 7-T MRS](https://pubmed.ncbi.nlm.nih.gov/40836481/) | Primary intervention | Yes | No | Muscle/liver depletion and differential recovery. |
| S25 | [Shiose et al. carbohydrate loading](https://pubmed.ncbi.nlm.nih.gov/27231310/) | Primary intervention | No | No | Segmental water and muscle glycogen. |
| S26 | [Acute squat MRI/plasma-volume response](https://pubmed.ncbi.nlm.nih.gov/7573553/) | Primary intervention | No | No | Local swelling and vascular fluid shift. |
| S27 | [Sixteen-week RT body-water study](https://pubmed.ncbi.nlm.nih.gov/24471859/) | Primary intervention | No | Yes | Chronic adaptation cannot calibrate an acute event kernel. |
| S28 | [Wearable BIS during furosemide fluid removal](https://pubmed.ncbi.nlm.nih.gov/39630397/) | Validation | Yes | Yes | Different sensor plus controlled drug perturbation. |
| S29 | [BIS versus deuterium dilution](https://pubmed.ncbi.nlm.nih.gov/19500888/) | Validation | No | Yes | Requires BIS; current Xiaomi/Health data do not provide it. |
| S30 | [Hall dynamic body-composition model](https://pmc.ncbi.nlm.nih.gov/articles/PMC2266991/) | Model/narrative | No | No | Coupled energy/body-weight dynamics. |
| S31 | [Thomas et al. dynamic composition model](https://pmc.ncbi.nlm.nih.gov/articles/PMC2879256/) | Model/narrative | No | No | Forbes/population-relation limitations and alternatives. |
| S32 | [Sleep restriction during calorie restriction](https://pubmed.ncbi.nlm.nih.gov/29438540/) | Primary intervention | No | No | Small 8-week body-composition RCT. |
| S33 | [One-night sleep deprivation and MPS](https://pubmed.ncbi.nlm.nih.gov/33400856/) | Primary intervention | No | Yes | Acute MPS proxy, n=13; not chronic muscle mass. |
| S34 | [Commercial wearable validity review](https://pubmed.ncbi.nlm.nih.gov/32897239/) | Systematic/meta | No | No | EE substantially weaker than HR/steps. |
| S35 | [Training-status/creatine meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC12777911/) | Systematic/meta | Yes | Yes | Creatine effect, not isolated training-status response. |
| S36 | [Critical evaluation of HR-based EE](https://pubmed.ncbi.nlm.nih.gov/8237863/) | Validation | No | Yes | Group calibration has poor individual agreement. |
| S37 | [Walking/stepping VO2 prediction validation](https://pubmed.ncbi.nlm.nih.gov/35213603/) | Validation | No | Yes | Predicts VO2max from a standardized test, not session EE on MS100. |

Rejected set: S04, S09, S11, S12, S15, S20, S21, S27, S28, S29,
S33, S35, S36, S37. “Rejected” here means not used to set a direct numeric
transition; it does not mean the paper is invalid.

## 2. A–T blocker coverage

Source counts overlap topics. “Memo location” refers to the corrected master
memo, not the original version.

| Topic | Sources specifically reviewed | Best source(s) | Strongest quantitative result | Contradictory/limiting evidence | Final level | In corrected memo / section |
|---|---:|---|---|---|---|---|
| A. SM baseline | 8 | S03, S05, S04 | Lee model 2 R²=.86/SEE 2.8 kg; non-obese validation SEE 2.6 kg; obese bias −2.33 ±3.31 kg and SEE 3.0 kg. | Missing race; obesity proportional bias; consumer BIA lacks required raw resistance. | **C current; B conditional** | Yes, §2, §9, §11. |
| B. Muscle gain/loss | 6 | S14, S16 | Whole-body meta: FFM +1.56, LMM +1.65, SMM +1.11 kg; range 0–7.2 kg. D3Cr trial: +2.29 kg (0.22–4.36) at 15 weeks. | Healthy-male pooling, mixed methods/durations; D3Cr n=21 age ≥70; DXA and D3Cr changes correlate weakly. | **C** | Yes, §3, §9. |
| C. Volume/dose | 3 | S13, S14 | +0.023 ES / about +0.37 percentage gain per additional weekly set. | Regional outcomes, study-level confounding, uncertain high-volume shape; not kg. | **C** | Yes, §3, §9. |
| D. RIR 2+ | 3 | S10, S11, S12 | 2024 meta-regression found hypertrophy slopes favoring closer failure; trained categorical meta reported small effect in one subgroup. | RIR estimated, exploratory; failure/nonfailure categories and n=19 trial do not identify 2–3 or 4+ probabilities. | **C research; unresolved production** | Yes, §3, §9, §11. |
| E. Training status | 4 | S14, S17, S35 | Morton trained subgroup protein-supplement FFM difference 1.05 kg (0.61–1.50), but this is an intervention subgroup. | Supplement and baseline differences confound status; 2026 creatine analysis found trained/untrained difference nonsignificant. | **C** | Yes, §3, §9, §11. |
| F. Protein | 3 | S17, S18, S19 | FFM +0.30 kg (0.09–0.52); segmented breakpoint 1.62 g/kg/d (CI 1.03–2.20; detailed model p=.079). | FFM not direct SM; energy-sufficient trials; energy-restricted 2025 review is heterogeneous. | **C** | Yes, §3, §9, §11. |
| G. Energy balance | 4 | S18, S19, S30, S31 | Meta-regression coefficient ≈−3.5×10⁻⁴ ES per kcal/d; average LM-gain crossing around −500 kcal/d. | Linear study-level fit is not individual kg, surplus relation, or proof recomp cannot occur. | **C** | Yes, §3, §6, §9, §11. |
| H. Detraining/retraining | 2 | S20, S21 | Directional size loss with cessation/disuse; strength loss exceeds mass loss in disuse evidence. | Older adults/local measures; immobilization is not ordinary detraining; no whole-body SM kg time course. | **D** | Yes, §3, §9, §11. |
| I. Stepper energy | 5 | S34, S36, S37, S01 | No exact session minimum; same-modality personal calibration is statistically testable. | Wearable review: no brand consistently accurate for EE; standardized stepping VO2 test is not free-session kcal. | **B after validation** | Yes, §4, §9. |
| J. HR personal calibration | 3 | S34, S36, S01 | Individual curves outperform group curves conceptually; official Garmin HR loses detailed timed-activity series in export. | Poor individual limits for group curves; free-living and modality transfer weak. | **B after validation** | Yes, §4, §9. |
| K. Glycogen baseline/capacity | 4 | S24, S25, S22, S23 | Separate pools directly diverge: exercise −64% muscle/−34% liver in n=12 cyclists. | This is change from observed baseline, not a predictor of an unmeasured user's starting pools. | **C population; E individual current state** | Yes, §5, §9, §11. |
| L. Glycogen depletion | 4 | S23, S24 | Local resistance mean ≈−21%; set moderator −11.2 mmol/kgdm/set (−18.0 to −4.3), I²=81.2%. | Biopsied local concentration, unknown active mass and starting store; cyclist result not resistance/stepper transfer. | **C local; E whole-body kg** | Yes, §5, §9, §11. |
| M. Glycogen repletion | 3 | S22, S24, S25 | CHO-control +23.5 mmol/kgdm/h (19.0–27.9), I²=66.8%; 10 g/kg/12 h restored liver to 142%, muscle to 69%. | Timed ≤8/12-hour intake, endurance depletion, small male samples; daily aggregate timing missing. | **C conditional** | Yes, §5, §9, §11. |
| N. Glycogen water | 3 | S25, S24, S29 | Literature estimate 2.7–4 g water/g glycogen; loading increased TBW/ICW. | Range was not a fitted individual density; no held-out prediction error or BodyCast covariate model. | **C association; E calibrated transition** | Yes, §5, §9, §11. |
| O. Transient exercise water | 3 | S26, S27, S29 | Immediately after squats, active vasti CSA +10%, adductors +5%, plasma volume −22%; r²=.75 for PV loss versus CSA rise. | Local geometry and vascular redistribution; chronic BIA water changes are adaptation; no whole-body decay. | **D** | Yes, §5, §9, §11. |
| P. ECF/hydration | 6 | S01, S02, S28, S29 | Furosemide study: body mass −1.4±0.2 kg, urine 1277±190 mL, extracellular resistance +13.6±2.9%. | Needs wearable BIS plus controlled diuresis; water intake does not identify sodium/plasma/ECF. | **E** | Yes, §5, §9–§11. |
| Q. Body-fat forecast | 6 | S30, S31, S06–S08 | Mechanistic energy models can predict population weight/fat trajectories; serial BIA can be an error-prone observation. | Forbes relation is population-dependent; short-term water/lean states are non-identifiable; BIA limits are wide. | **B/C** | Yes, §6, §9. |
| R. Consumer scale observation | 5 | S06–S09, S25 | Across 15 devices: precision 0–0.49 BF points; constant error −3.5 to +11.7 points; SEE 3.1–7.5 points. | Exact Xiaomi 2 criterion study absent; bipedal LoA can be roughly −14.54 to +8.58 BF points and −9.52 to +3.92 kg SM. | **C** | Yes, §2, §6, §9, §11. |
| S. Sleep/recovery | 3 | S32, S33 | One sleepless night reduced MPS 18% in n=13; 8-week diet trial n=36 altered the fraction of weight lost as fat. | Acute MPS is a proxy; small/extreme protocols; consumer stages add measurement error. | **D** | Yes, §6, §9, §11. |
| T. Garmin extras | 2 official | S01, S02 | 12 official export categories; activity HR has only high/low values. | HealthKit supports more types than Garmin lists for export. | **A exported; E unverified** | Yes, §1, §9–§10. |

## 3. Primary-evidence traceability for every quantitative proposal

The table covers every number/equation presented as a candidate, threshold,
effect, uncertainty target, or horizon in either version of the memo.

| Parameter/model | Value/range and units | Source/result location | Population / N | Outcome; direct vs proxy | Copied, transformed, or inferred |
|---|---|---|---|---|---|
| Lee circumference model | `SMkg = Hm*(.00744*CAGcm² + .00088*CTGcm² + .00441*CCGcm²) + 2.4*male − .048*age + race + 7.8`; race −2.0 Asian/+1.1 African American/0 White-Hispanic | S03, paper eq. 4/results | Healthy non-obese adults, 135 M/109 F, age 20–81, n=244 | Whole-body multislice MRI SM; **direct** reference | Copied. |
| Lee simple model | `SMkg=.244*BWkg+7.80*Hm+6.6*male−.098*age+race−3.3`; race −1.2 Asian/+1.4 African American/0 White-Hispanic | S03, eq. 6/results | Same n=244 | MRI SM; **direct** | Copied. |
| Lee in-sample fit | R²=.86, SEE 2.8 kg | S03, eq. 6/result | Pooled non-obese n=244 | Prediction residual; direct MRI criterion | Copied. |
| Lee non-obese validation | MRI−predicted −0.34±2.73 kg; R²=.86; SEE 2.6 kg | S03, Table 6/model 5 | Random validation n=122 | Direct MRI | Copied. |
| Lee obese validation | MRI−predicted −2.33±3.31 kg; R²=.79; SEE 3.0 kg; proportional bias p<.001 | S03, Table 6/model 6 | n=80, 39 M/41 F; mean BMI 33.8/34.8 | Direct MRI | Copied. |
| `SM0 ~ Normal(muLee, SEE)` | Distribution and SD in kg | No paper fits a Normal residual for BodyCast | None | Candidate prior | **UNSUPPORTED distributional inference. Withdrawn.** Use empirical residuals; SEE is not a 95% PI. |
| Unknown-race mixture/widening | No numeric weights/variance | No source supplies BodyCast mixture weights | None | Candidate prior | **UNSUPPORTED until target-population data exist.** |
| Janssen BIA model | `SMkg=.401*heightcm²/Rohm+3.825*male−.071*age+5.102`; R²=.86; SEE 2.7 kg (9%) | S05, final pooled equation/abstract | Multiethnic healthy adults age 18–86, n=388 | Whole-body MRI SM; direct reference | Copied. The original memo's `.396, 3.443, −.078, 6.313` was erroneous and removed. |
| Whole-body RT change | FFM +1.56 kg; LMM +1.65 kg; SMM +1.11 kg; study range 0–7.2 kg | S14, main pooled result/discussion | Healthy adult males across interventions | SMM direct/estimated depending study; FFM/LMM proxies | Copied aggregate; **not** divided into weekly rates. |
| D3Cr RT change | 2.29 kg, 95% CI .22–4.36 at 15 weeks; DXA ALM 1.04 kg (.31–1.77) | S16, Results | Low-functioning ≥70 y, mean 82.1, n=21 | D3Cr muscle direct-ish; DXA ALM proxy | Copied; no transport. |
| Generic weekly SM transition | `ΔSMweek ~ Normal(mu + moderators, sigma)` | No source fits this equation jointly | None | Structural model | **UNSUPPORTED as parameterized model**; conceptual notation only. |
| Volume moderator | +.023 effect-size units / about +.37 percentage gain per added weekly set | S13, meta-regression result | RT trials, heterogeneous | Mostly local thickness/CSA; proxy for whole-body SM | Copied/reported transformation from authors; not converted to kg. |
| RIR bins 0–1/2–3/4+ | Categories, no coefficient | S10 motivates continuum but does not validate these cut points | Meta-analytic study arms | Local hypertrophy proxies | **Engineering grouping; unsupported as thresholds.** Kept only as possible reporting bins. |
| Protein supplementation | FFM +.30 kg (.09–.52); fiber CSA +310 µm² (51–570); mid-femur CSA +7.2 mm² (.2–14.3) | S17, forest plots/results | 49 studies, n=1863 | FFM/local CSA; **proxies**, not total SM | Copied. |
| Protein breakpoint | 1.62 g/kg/d, 95% CI 1.03–2.20; 42 arms/n=723; R²=.19; p=.079 detailed fit | S17, Figure 5 segmented regression | Energy-sufficient healthy RET adults | FFM proxy | Copied; not used as binary threshold. |
| Energy-deficit moderator | β≈−3.5×10⁻⁴ effect-size units per kcal/d; ~−500 kcal/d crossing for average LM gain | S18, meta-regression/Table 1 and discussion | RT energy-deficit studies | Lean mass proxy | Copied model/result; the crossing is authors' interpretation, not kcal→kg. |
| Garmin session minimum | 20 sessions | No source | None | Sample-size gate | **UNSUPPORTED engineering judgment; withdrawn.** |
| Stepper model | `activeKcal ~ f(duration, rate, mass, HR)` | No paper estimates coefficients for MS100/Garmin pairing | Future within-person sessions | Garmin device target, not criterion EE | Inferred architecture; all coefficients/variance must be learned and held out. |
| 5-fold/LOO requirement | 5 folds | No power or simulation source | None | Validation design | **Unsupported fixed design; withdrawn.** Walk-forward and learning-curve rule replaces it. |
| 80/95% prediction intervals | Coverage targets | General validation convention, not physiological evidence | None | Calibration reporting | Engineering reporting levels; not model parameters. |
| Resistance glycogen mean | ≈−21% local concentration | S23, pooled result/discussion | Healthy adults; biopsy studies | Local muscle glycogen; **not whole-body kg** | Copied. |
| Set/depletion slope | −11.2 mmol/kg dry mass/set, 95% CI −18.0 to −4.3; I²=81.2% | S23, Figure 4 meta-regression | Study-level resistance protocols | Local biopsy concentration | Copied; not converted to kg or anatomical totals. |
| Re-synthesis effect | +23.5 mmol/kg dry mass/hour, 95% CI 19.0–27.9; I²=66.8% | S22, primary meta-analysis result | 29 trials/21 reports, n=246, ≤8 h | Local biopsy concentration | Copied; not extrapolated to 24 h. |
| Paired glycogen response | Exercise −64% muscle/−34% liver; 10 g/kg CHO/12h; liver 142% baseline at 6h, muscle 69% at 12h | S24, Results | Trained male cyclists, n=12 | 7-T MRS muscle/liver; direct concentration | Copied; no resistance/stepper transfer. |
| Glycogen-water ratio | 2.7–4 g water/g glycogen | S25, background/analysis | 72-h loading study | Water/glycogen association | Copied literature estimate; **no supported probability density or prediction error.** |
| Acute resistance water signals | vasti CSA +10%, adductors +5%, plasma volume −22%, r²=.75 | S26, Results | Barbell-squat acute study | Local MRI CSA/plasma volume; proxy for whole-body mass | Copied; not converted to kg/kernel. |
| Generic glycogen equations | `G[t+1]=clip(G−D+R,0,C)` and `Wg=rho*G` | Mass-balance identity; no fitted BodyCast coefficients | None | Structural latent state | Inferred notation; every capacity/rate/rho parameter remains unsupported. |
| Consumer BIA fat-% error | precision 0–.49 percentage points; constant error −3.5±4.1 to +11.7±4.7 points; SEE 3.1–7.5; CCC .48–.94 | S07, Results | n=73 cross-sectional; n=37 longitudinal | BF% versus criterion | Copied ranges across products; not Xiaomi-specific. |
| Consumer BIA individual LoA | tetrapolar BF% −6.59 to +4.61; SM −4.62 to +4.74 kg; bipedal up to BF% −14.54 to +8.58 and SM −9.52 to +3.92 kg | S06, Results | Adults n=106 | BF% vs DXA, SM vs MRI | Copied extrema; not a Xiaomi error distribution. |
| BIS fluid response | mass −1.4±.2 kg, urine 1277±190 mL, extracellular resistance +13.6±2.9% | S28, Results | n=27, controlled furosemide | Fluid perturbation validation | Copied; rejected for current sensors/context. |
| Acute sleep/MPS | −18%; control .072±.015%/h (deprived comparison reported in paper) | S33, Results | Healthy adults, 7 M/6 F, n=13, crossover | Fractional MPS; **proxy** | Copied; rejected as chronic kg modifier. |
| State vector and particle/EKF/UKF choice | Eight named compartments; no numeric coefficients | S30/S31 motivate coupled dynamics, not this exact state | None | Architecture | Inferred. Algorithm choice is **unsupported pending diagnostics**. |
| Forecast horizons | 1–3 d, 1/4/8/12/24 wk | Product-validation design, not literature-derived biology | None | Evaluation plan | Engineering choices, explicitly not physiological parameters. |
| 50/90% posterior intervals | Reporting levels | No empirical interval calibration yet | None | Output design | Engineering choices; coverage must be learned/verified before use. |

## 4. The “20 Garmin sessions” claim

The number 20 was **engineering judgment**. It was not derived from published
validation literature, a statistical power/sample-size calculation, or a
simulation. Presenting it as a scientific minimum was incorrect.

It has been removed from the corrected memo. The replacement is a
validation-based acceptance rule:

1. Prespecify simple duration/body-mass and no-HR baselines.
2. Add temporally ordered same-machine sessions and plot a learning curve for
   walk-forward MAE kcal, MAPE, bias, and interval coverage.
3. Require coverage across the intended duration, rate, HR, and body-mass
   ranges; do not count near-duplicate sessions as independent evidence.
4. Accept only when performance and coefficients are stable across additional
   sessions, the holdout is large enough to estimate coverage honestly, and
   the model beats the simple baselines.
5. Otherwise return unavailable. Report the actual effective sample size;
   never replace this with a universal count.

Garmin active energy remains a device target, not calorimetry. S34 reviewed
158 publications and found no commercial brand consistently accurate for
energy expenditure, despite better controlled-setting results for steps/HR.

## 5. Skeletal-muscle baseline and the meaning of “±3 kg”

### Exact equations

Lee model 1 (corrected limb circumferences):

`SMkg = Hm × (0.00744×CAGcm² + 0.00088×CTGcm² + 0.00441×CCGcm²) + 2.4×sex − 0.048×age + race + 7.8`

Lee model 2 (current-input-nearest):

`SMkg = 0.244×BWkg + 7.80×Hm + 6.6×sex − 0.098×age + race − 3.3`

Sex is 0 female/1 male. Model-2 race is −1.2 Asian, +1.4 African
American, and 0 White/Hispanic. Source: S03, equations 4 and 6.

### Population and validation

- Healthy adults; non-obese BMI <30; 135 men/109 women; age 20–81 years;
  African American, Asian, White, and Hispanic participants.
- Non-obese participants were randomly split: development n=122 and
  cross-validation n=122.
- Model 2 pooled non-obese fit: R²=.86, SEE=2.8 kg.
- Non-obese validation of the development equation: MRI−predicted
  −0.34±2.73 kg, R²=.86, SEE=2.6 kg.
- Separate obese validation: n=80 (39 men/41 women); mean BMI 33.8±2.7 and
  34.8±3.5 kg/m²; MRI−predicted −2.33±3.31 kg, R²=.79, SEE=3.0 kg, with
  significant proportional bias.
- Al-Gindan et al. externally tested the Lee equation in an MRI validation
  cohort of 197 adults (105 women), age 19–83, BMI 15.7–36.4 kg/m². Results
  were R²=.75/SEE 2.9 kg in men and R²=.63/SEE 2.1 kg in women; women showed
  predicted-minus-observed 2.6±2.3 kg (95% limits −2.0 to 7.2). Combined
  R²=.85/SEE 2.6 kg, mean difference 2.77 kg, limits −2.4 to 8.0.
- This is genuine external validation, but it demonstrates material bias and
  individual spread. No reviewed study validates the equation for BodyCast's
  exact user population, longitudinal change detection, or a Xiaomi-derived
  covariate set.

BodyCast's stated inputs match weight, height, age, and sex, but **not race**.
They do not match model 1's corrected arm, thigh, and calf girths/skin folds.
Body-fat %, generic lean mass, and Xiaomi vendor muscle do not substitute for
the missing predictors.

“±3 kg” is therefore an unsafe shorthand. The reported 2.8 kg is an in-sample
standard error of estimate; 2.6 and 3.0 kg are validation SEEs. They are not
RMSE-labelled 95% prediction intervals, and `estimate ± 3 kg` is not known to
contain any stated percentage of individuals. The residual distribution and
tails were not established for BodyCast.

A Normal likelihood cannot be selected from SEE alone. A Student-t likelihood
would be robust but its degrees of freedom/scale would be invented; an
asymmetric model may be necessary in obesity because bias is proportional.
The correct present choice is **unknown empirical residual distribution**,
estimated in a held-out, in-domain cohort. Hence Level C today, potentially
Level B after predictor resolution and external calibration.

## 6. Negative Level B/C search results

This table records the strongest approximate candidate actively sought—not
just the conclusion “insufficient evidence.”

| Area | Strongest quantitative candidate | Why rejected or downgraded |
|---|---|---|
| RIR 2+ | S10 continuous multilevel RIR meta-regression; S11/S12 categorical contrasts | RIR reconstructed rather than uniformly prescribed; no posterior `P(effective set|RIR)`; local outcomes and small trained trial. Level C research only. |
| Training status | S14 whole-body meta plus S17 trained/untrained subgroup; S35 contrary training-status analysis | Status is entangled with supplementation, baseline muscularity, program and measurement. No isolated coefficient. Level C hierarchical covariate only. |
| Protein | S17 segmented FFM relation and pooled +.30 kg | Breakpoint CI is broad and detailed fit p=.079; FFM/CSA proxies; energy restriction absent. Continuous context prior only, not SM transition. |
| Energy balance | S18 β≈−3.5×10⁻⁴ ES/kcal/d and ~500 kcal/d average crossing | Study-level LM proxy, observed deficit range only, no surplus symmetry, no individual kg distribution; recomp is not excluded. |
| Detraining/retraining | S20 older-adult detraining and S21 disuse meta-analysis | Mixed local methods, older/immobilized populations, strength changes faster than mass. No general whole-body kg time course. |
| Glycogen baseline | S24 separate liver/muscle MRS pools and S25 loading data | Neither predicts an unmeasured starting concentration from BodyCast's body size/daily carbs/history. Population pools may be priors; current individual state remains unavailable. |
| Glycogen depletion | S23 local −21% and −11.2 mmol/kgdm/set | High heterogeneity; one local biopsy; unknown recruitment, active-muscle mass, initial stores and anatomical aggregation. Cannot yield whole-body kg. |
| Daily-carb repletion | S22 +23.5 mmol/kgdm/h; S24 10 g/kg/12h divergent liver/muscle recovery | Timed early feeding/endurance protocols; daily total lacks dose timing and baseline depletion. A marginalized 24-hour model must first be fit/validated, not assumed. |
| Glycogen-associated water | S25 estimated 2.7–4 g/g and direct TBW/ICW changes | No fitted individual density, moderators, or prediction error. Assigning Normal/Uniform/lognormal is not supported. |
| Transient exercise water | S26 +10%/+5% local CSA and −22% plasma volume | Local swelling plus vascular redistribution cannot be summed into whole-body kg or a decay kernel; S27 chronic changes are a different process. |
| ECF | S28 controlled BIS/furosemide response; S29 BIS/deuterium equation | Both require impedance information absent from current Health/Xiaomi export; drug perturbation and overfat populations do not identify everyday ECF. |
| Xiaomi/body-fat observation | S06/S07 generic foot-to-foot consumer BIA limits; S08 modern criterion review | Exact Mi Body Composition Scale 2/firmware criterion distribution was not found. Generic wide errors can justify skepticism, not a Xiaomi point correction. Learn paired residuals. |
| Sleep/recovery | S33 −18% MPS and S32 small 8-week calorie-restriction RCT | Acute molecular proxy and small extreme protocol do not map consumer duration/stages to daily or weekly kg. Level D context only. |

## 7. Current official Garmin → Apple Health audit

Checked 2026-09-18 against S01 and S02. Garmin's page has no displayed
publication date, so the date below is the access/recheck date. “Not listed”
is deliberately narrower than “technically impossible.” No forum/Reddit source
was used for export capability.

| Metric | Garmin records? | HealthKit supports? | Garmin officially exports? | Official source/date | BodyCast value |
|---|---|---|---|---|---|
| Active Energy | Yes | Yes | Yes | S01/S02, accessed 2026-09-18 | High: noisy activity observation; preserve source. |
| Resting Energy | Yes | Yes | Yes | S01/S02, 2026-09-18 | Moderate: audit/expenditure comparison; prevent double counting. |
| Heart Rate | Yes | Yes | Yes; all-day, only high/low from timed activities | S01/S02, 2026-09-18 | High with coverage limitation; not detailed workout HR. |
| Resting Heart Rate | Yes | Yes | Not separately listed | S01/S02, 2026-09-18 | Use only observed samples; Garmin provenance unverified. |
| HRV | Compatible devices | Yes, SDNN | Not listed | S01/S02, 2026-09-18 | Unavailable through verified path. |
| Stress | Yes | No standard Garmin stress-score type | Not listed | S01/S02, 2026-09-18 | Unavailable. |
| Body Battery | Yes | No standard equivalent | Not listed | S01/S02, 2026-09-18 | Unavailable. |
| Respiration | Compatible devices | Yes | Not listed | S01/S02, 2026-09-18 | Unavailable unless an independent Health source is observed. |
| Pulse Ox | Compatible devices | Yes | Not listed | S01/S02, 2026-09-18 | Unavailable unless independently observed. |
| Skin Temperature | Compatible devices | Body/wrist temperature types exist | Not listed | S01/S02, 2026-09-18 | Unavailable from verified Garmin path. |
| Water | Yes/manual-capable | Yes | Yes | S01/S02, 2026-09-18 | Coverage/context only; not ECF. Worth auditing actual sample coverage before sync expansion. |
| Flights Climbed | Yes | Yes | Yes | S01/S02, 2026-09-18 | Low/moderate activity context. |
| Sleep | Yes | Yes | Yes | S01/S02, 2026-09-18 | Context; device-derived stages not physiology truth. |
| Steps | Yes | Yes | Yes | S01/S02, 2026-09-18 | Existing high-value activity input. |
| Distance | Yes | Yes | Yes, walking+running | S01/S02, 2026-09-18 | Existing activity input. |
| Workouts | Yes | Yes | Yes; associated GPS track is not written | S01/S02, 2026-09-18 | Existing activity/provenance input. |

Heart-rate recovery was also checked because it appeared in the master prompt:
HealthKit capability does not establish Garmin export, and it is not on S01's
export list. Detailed activity HR is specifically limited by S01 to high/low
values for timed activities.

## 8. Contradictory-evidence audit

No numeric production implementation is recommended by this review. The
following research candidates survive only in restricted form.

| Candidate | Supporting evidence | Opposing/limiting evidence | Verdict after contradiction search |
|---|---|---|---|
| Lee SM baseline | MRI criterion, internal random cross-validation, multiethnic adults | Obese bias/proportional error; missing race; external populations differ; cross-sectional only | Does **not** survive as current plug-in estimator. Survives as a Level-C prior candidate for in-domain validation. |
| Janssen raw-BIA SM baseline | MRI criterion, n=388, age/adiposity range | Requires 50-kHz resistance; Xiaomi vendor fields are not raw R; Asian underestimation | Does not survive with current data. |
| Whole-body SM transition prior | S14 broad whole-body averages; S16 direct D3Cr change | Mixed proxies, huge heterogeneity, sex/age restrictions; D3Cr–DXA change disagreement | Survives only as a study-level hierarchical research prototype, not weekly individual output. |
| Volume moderator | S13 positive dose association | Regional/proxy outcomes, diminishing-return shape not identified, study-level confounding | Survives as monotonic prior with wide uncertainty only after study-level re-analysis. |
| Protein moderator | S17 pooled benefit and dose analysis | Breakpoint uncertainty/p=.079; FFM not SM; no deficit generalization | Survives as contextual continuous covariate, not coefficient or threshold. |
| Energy moderator | S18 negative deficit association | Study-level LM proxy; approximate linear fit; recomp/maintenance/surplus not identified | Survives as broad interaction candidate, not kcal→muscle mapping. |
| Personal stepper model | Same machine and repeated within-person labels make validation feasible; individual calibration preferable to group curves | Garmin is not criterion EE; S34 finds EE generally inaccurate; official export loses detailed workout HR | Survives as a **device-target fallback** only if walk-forward performance beats simple baselines. |
| Local glycogen model | S22–S24 give quantitative depletion/repletion | High heterogeneity, timed protocols, local concentrations and unknown anatomical scaling | Does not survive as whole-body kg transition; local latent-pressure research only. |
| Glycogen-water model | S25 direct loading/water co-change | 2.7–4 is not a calibrated density or individual PI | Does not survive parameterization. |
| Fat/weight state-space | S30/S31 establish coupled dynamic modeling; serial observations can constrain trend | Forbes/population dependence, intake/EE error, BIA/water non-identifiability at short horizons | Architecture survives; transition/observation parameters require separate validation. |
| Consumer BIA observation layer | S06–S08 quantify broad device error and longitudinal behavior | Exact Xiaomi 2 evidence absent; individual limits wide and hydration-dependent | Survives only as learned within-device residual model, never borrowed point correction. |

## 9. Actual literature search log

### What was actually searched

- Search interfaces: web search over PubMed/PMC and publisher pages;
  PubMed record/full-text inspection; accessible publisher/ResearchGate full
  text; official Garmin Support and Apple Developer documentation.
- Search date: 2026-09-18.
- Publication range: no hard year filter for foundational physiology;
  targeted modern-update searches emphasized 2024–2026.
- Citation follow-up: references/citing material were checked selectively for
  Lee/Janssen equations, RIR/failure, glycogen re-synthesis/depletion,
  Hall/Thomas body-composition models, and consumer BIA. There was **no
  exhaustive forward/backward citation chase**.

Exact queries issued during the corrective pass:

1. `PubMed resistance training proximity to failure hypertrophy RIR meta regression 2024 trained adults`
2. `PubMed resistance training whole body skeletal muscle mass MRI D3 creatine longitudinal meta analysis trained status hypertrophy`
3. `PubMed detraining retraining muscle size MRI DXA longitudinal humans resistance training systematic review`
4. `PubMed protein energy restriction resistance training fat free mass meta regression 2024 2025`
5. `PubMed human muscle glycogen total pool liver glycogen 13C MRS repletion daily carbohydrate systematic review`
6. `PubMed glycogen water ratio total body water carbohydrate loading human 13C MRS intracellular extracellular water`
7. `PubMed resistance exercise total body water body mass edema bioimpedance plasma volume 24 48 hours`
8. `PubMed hydration extracellular fluid prediction body weight sodium fluid intake wearable model human`
9. `Xiaomi Mi Body Composition Scale 2 validation body fat accuracy study bioelectrical impedance PubMed`
10. `consumer foot to foot bioelectrical impedance scale body fat validity DXA repeatability hydration systematic review`
11. `Hall dynamic body weight fat mass model validation energy balance Forbes model state space body composition`
12. `sleep restriction randomized trial fat loss lean mass muscle protein synthesis humans resistance training`
13. `site:support.garmin.com Apple Health HRV Stress respiration Pulse Ox body temperature Garmin Connect sync`
14. `site:support.garmin.com "What Garmin Connect Information Can Be Shared With Apple Health"`
15. `PubMed stair stepping energy expenditure heart rate individualized calibration prediction model adults`
16. `PubMed wearable heart rate energy expenditure accuracy personalized calibration systematic review`
17. `Lee Wang Heo 2000 skeletal muscle equation age range BMI range 244 cross-validation sample`
18. `"SM = 0.244" "cross-validation" age Lee skeletal muscle sample`
19. `Lee skeletal muscle equation external validation obese adults SEE 3.0 kg PMC6443297`
20. `Janssen skeletal muscle BIA equation validation age BMI sample equation SEE 2000`
21. `"Total-body skeletal muscle mass" 244 "group A" "group B" Lee 2000 age`
22. `"Lee et al" skeletal muscle "n = 244" age range BMI 30`
23. `"Total-body skeletal muscle mass" PDF Lee Wang Heo 796 803`
24. `Murphy Koehler energy deficiency resistance training lean mass meta regression 500 kcal day 2022 result`
25. `Morton 2018 protein supplementation resistance training meta regression 1.62 g kg day FFM 0.30 kg confidence interval`
26. `detraining retraining muscle mass systematic review MRI DXA adults weeks quantitative loss`
27. `sleep restriction muscle protein synthesis randomized crossover human 2020 quantitative`
28. `Shiose glycogen loading total body water 3 g water per glycogen human study DXA MRI 2016`
29. `muscle glycogen water ratio human carbohydrate loading total body water study prediction error`
30. `liver muscle glycogen baseline concentration total capacity 13C MRS human body size prediction model`
31. `resistance exercise glycogen depletion sets reps systematic review muscle biopsy quantitative`
32. `systematic review meta-analysis resistance training whole-body muscle growth healthy adult males MRI DXA lean mass quantitative 2020`
33. `PubMed whole-body skeletal muscle mass resistance training meta-analysis MRI D3-creatine`
34. `longitudinal resistance training total skeletal muscle mass MRI 12 weeks 24 weeks adults`
35. `D3 creatine dilution resistance training skeletal muscle mass intervention change study`
36. `Al-Gindan 2014 Lee equation validation R2 SEE men women skeletal muscle MRI 92 105`
37. `"Prediction equation of Lee et al" 0.75 2.9 0.63 2.1`
38. `"validation" "Lee et al" "2.9" skeletal muscle Al-Gindan`

### Inclusion criteria

- Humans and outcomes relevant to actual BodyCast inputs/compartments.
- Primary interventions, validation studies, systematic reviews/meta-analyses,
  or foundational quantitative models.
- Direct MRI/MRS/D3-creatine prioritized; DXA/FFM/local ultrasound/CSA kept
  explicitly as proxies.
- Quantitative result and population had to be recoverable from an abstract or
  accessible result/full text.
- Garmin export claims required official Garmin documentation; HealthKit
  capability required Apple documentation.

### Exclusion criteria

- Animal/in-vitro-only evidence; anecdotes/forums; vendor marketing.
- Strength or acute MPS treated as if it were skeletal-muscle mass.
- Product equations requiring unavailable raw impedance or sensors.
- Studies too indirect to parameterize the requested transition (they may be
  retained as contradictory evidence).
- Duplicate papers/URLs and secondary documents that merely repeated the
  original result.

### Completeness limitation

This was a structured targeted external search, **not a formal systematic
review**. Scopus, Embase, Web of Science, trial registries, and paid full-text
databases were not directly searched; screening and extraction were not done
by two reviewers; risk-of-bias scoring was not independently reproduced; and
forward/backward citation searching was selective. Therefore a category-A
claim would be false.

## 10. Final decision

- Original memo: **C**.
- Corrected memo after research continuation: **B**.
- Production physiology changes justified now: **none**.
- Best immediate next research: in-domain Lee residual validation; paired
  Xiaomi/criterion or repeated-observation error study; temporally held-out
  same-machine Garmin-target stepper learning curve; study-level hierarchical
  re-analysis for whole-body SM transitions.
- Claims moved from BLOCKED by this audit: **none**.

Updated memo:
[`docs/research/stage-7-8-quantitative-blocker-rescue-master-research.md`](./stage-7-8-quantitative-blocker-rescue-master-research.md)
