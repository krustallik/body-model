# BodyCast workout physiology v7 — scientific evidence review

**Evidence cutoff:** 2026-09-17  
**Search date:** 2026-09-17  
**Status:** Corrected after independent scientific audit; ready for eligible
RED-test design.

**Independent scientific audit:**
`docs/research/workout-physiology-v7-independent-audit.md`  
**Audit date:** 2026-09-17  
**Provenance:** Record corrected after independent audit before RED-test
generation.

## Scope and interpretation rules

The target `skeletalMuscleKg` is narrower than fat-free mass (FFM), lean mass,
DXA lean soft tissue, local ultrasound muscle thickness, regional cross-sectional
area (CSA), or biopsy fiber CSA. Proxy endpoints are labelled. Acute muscle
protein synthesis (MPS), glycogen/water change, and exercise swelling are not
treated as chronic skeletal-muscle accretion.

Confidence integrates replication, bias, sample size, directness, measurement
validity, duration, population match, and consistency: **HIGH**, **MODERATE**,
**LOW**, or **VERY LOW / INSUFFICIENT**. “Paper reports” and “BodyCast
interpretation” are kept distinct.

Audit evidence-role labels used throughout: **DIRECT** means the population,
modality, exposure, and endpoint directly address the claim; **EXTRAPOLATED**
means transfer across modality, population, time scale, or compartment;
**PROXY** means the measured endpoint is not `skeletalMuscleKg`; and
**ENGINEERING** means deterministic product behavior rather than a scientific
parameter. In particular, stepper substrate inference from cycling/running is
**EXTRAPOLATED**; local imaging, DXA lean mass, acute MPS, and local glycogen
concentration are **PROXY** for whole-body skeletal muscle or glycogen; HR-based
energy without current modality-relevant personal calibration is
**EXTRAPOLATED**; and fallback ordering is **ENGINEERING**.

## A. Resistance-training dose → hypertrophy

### Conclusions

1. **Weekly hard-set dose: MODERATE confidence.** More weekly sets generally
   produce more local muscle hypertrophy than very low volume, with diminishing
   returns and substantial heterogeneity. This supports monotonic non-decrease
   over the evidence-supported low-to-moderate range, not a fixed gain per set,
   a globally concave response, or a universal ceiling. E-A01, E-A02, E-A03,
   E-A04.
2. **Hard sets as primary program dose: MODERATE confidence.** Counting sets is
   defensible when sets are performed to or near failure and broadly within the
   studied repetition range. Direct and indirect sets should not automatically
   receive equal weight. E-A02, E-A08, E-A09.
3. **Frequency: MODERATE confidence for no important average independent
   effect when volume is equated.** Frequency mainly distributes weekly volume;
   v7 does not require an independent positive frequency effect, but the
   evidence does not prove exact equality for every schedule or person. E-A11.
4. **Load: MODERATE confidence.** Across a broad load range, sufficiently hard
   volume-matched training can produce similar hypertrophy. Load strongly
   affects strength specificity but does not justify a simple hypertrophy
   multiplier. E-A04, E-A10.
5. **Proximity to failure: MODERATE confidence for direction, LOW for shape.**
   Closer proximity generally supports hypertrophy, but momentary failure is not
   proven superior to non-failure training and the continuous dose shape is
   unresolved. A product assumption that recorded sets are “hard/near failure”
   is acceptable only as an explicit annotation-derived assumption, not a
   measured fact. E-A09, E-A13.
6. **High-volume/session caps: INSUFFICIENT for a hard numeric cap.** Evidence
   supports diminishing returns, but trained-cohort trials conflict above
   moderate volumes. No universal session or weekly ceiling is scientifically
   established. E-A05–E-A07, E-A12.
7. **Tonnage: LOW confidence as an incremental hypertrophy predictor.** Volume
   load is protocol-dependent and can rise without greater hypertrophy.
   Optional tonnage may be retained as context but must not be required or
   dominate hard-set dose. E-A10, E-A14.
8. **Measurement limitation:** almost all dose evidence uses local ultrasound,
   MRI/CSA, or lean-mass proxies. It cannot directly yield kilograms of
   whole-body skeletal muscle.

### Conflicting evidence and BodyCast interpretation

The 2017 meta-regression reported a positive linear study-level association,
including an estimated 0.37 percentage-point greater gain per additional weekly
set (E-A01). That estimate must **not** become a per-set production coefficient:
the 2026 analysis favors diminishing returns (E-A02), and trained-subject trials
conflict at high volume. E-A06 favored 32 versus 16 weekly sets at some
ultrasound sites, while E-A07 found no differential hypertrophy among 12, 18,
and 24 lower-body sets. E-A12 found maintenance of prior volume comparable to
30% or 60% increases. Differences include small samples, muscles measured,
baseline volume, and proxy methods.

**BodyCast interpretation:** aggregate planned hard sets after muscle mapping;
distinguish direct from indirect work; preserve non-decrease over the supported
low-to-moderate range and allow diminishing returns without imposing global
concavity. Do not infer an exact session cap, gain rate, or kilograms of muscle
from these studies.

### Topic A evidence ledger

**E-A01 — Schoenfeld, Ogborn & Krieger (2017), “Dose-response relationship
between weekly resistance training volume and increases in muscle mass,”
Journal of Sports Sciences.** DOI 10.1080/02640414.2016.1210197; PMID 27433992.
Systematic review/meta-analysis; 15 studies, 34 treatment groups; mixed healthy
adult populations. Intervention durations and full sex/training breakdown not
available in the abstract. Outcomes were heterogeneous muscle-size measures
(proxies). Reported continuous slope ES +0.023 and +0.37 percentage gain per
additional weekly set, p=0.002; high-vs-low ES difference 0.241 (3.9 percentage
points), p=0.03; three categories (<5, 5–9, ≥10 sets/muscle/week) p=0.074.
Limitations: ecological meta-regression, older small literature, heterogeneous
measurements; linear slope is not causal individual response. **Abstract-only.**

**E-A02 — Pelland et al. (2026), “The Resistance Training Dose Response,”
Sports Medicine.** DOI 10.1007/s40279-025-02344-w; PMID 41343037. Multilevel
meta-regressions; 67 studies, 2,058 participants; 79.1% male; mean age
25.16±5.22 years; status mixed and statistically adjusted. Direct/indirect sets
were modeled, with fractional counting best supported. Posterior probability of
positive volume slope was 100%; best-fit hypertrophy relationship showed
diminishing returns. No usable curve coefficients in abstract. Local
hypertrophy proxies; limited generalization to older adults. **Abstract-only.**

**E-A03 — McLeod et al. (2024), “The influence of resistance exercise training
prescription variables…,” Journal of Sport and Health Science.** DOI
10.1016/j.jshs.2023.06.005; PMID 37385345; PMCID PMC10818109. Umbrella review of
44 systematic reviews in healthy adults. Set volume affected hypertrophy;
evidence was insufficient for many other prescription details. Endpoint label
“skeletal muscle mass” pooled multiple proxies. **Abstract verified; full text
available but not extracted in handoff.**

**E-A04 — Currier et al. (2023), “Resistance training prescription for muscle
strength and hypertrophy…,” British Journal of Sports Medicine.** DOI
10.1136/bjsports-2023-106807; PMID 37414459; PMCID PMC10579494. Systematic
review/Bayesian network meta-analysis; hypertrophy network 119 randomized
studies, n=3,364, 47% women, healthy adults. All tested prescriptions exceeded
no exercise; multiset protocols ranked highly; many prescriptions had similar
effects. Heterogeneous proxies; ranking does not define an individual optimum.
**Abstract verified; full text available.**

**E-A05 — Baz-Valle et al. (2022), “A Systematic Review of the Effects of
Different Resistance Training Volumes on Muscle Hypertrophy,” Journal of Human
Kinetics.** DOI 10.2478/hukin-2022-0017; PMID 35291645; PMCID PMC8884877.
Systematic review/meta-analysis; seven studies; trained adults aged 18–35 with
≥1 year experience; primarily young men; ≥6 weeks; direct local ultrasound/CSA.
No moderate (12–20) versus high (>20 sets/muscle/week) difference for quadriceps
(p=0.19) or biceps (p=0.59); triceps favored high volume (p=0.01). Small,
muscle-specific evidence; does not establish a universal optimum. **Abstract
verified; full text available.**

**E-A06 — Brigatto et al. (2022), “High Resistance-Training Volume Enhances
Muscle Thickness in Resistance-Trained Men,” Journal of Strength and
Conditioning Research.** DOI 10.1519/JSC.0000000000003413; PMID 31868813.
Randomized 8-week trial; 27 trained men completing 16, 24, or 32 weekly
sets/muscle; ultrasound biceps, triceps, vastus lateralis. All grew; 32 sets
exceeded 16 for lower-body and triceps thickness magnitude. Small sample; local
ultrasound, not whole-body muscle mass. **Abstract-only.**

**E-A07 — Aube et al. (2022), “Progressive Resistance Training Volume…,”
Journal of Strength and Conditioning Research.** DOI
10.1519/JSC.0000000000003524; PMID 32058362. Randomized 8-week trial; 35
resistance-trained adults, squat ≈2.09× body mass; 12, 18, or 24 lower-body
sets/week over two sessions. No between-group muscle-thickness or regional-FFM
difference. Local ultrasound and regional FFM are proxies. **Abstract-only.**

**E-A08 — Baz-Valle, Fontes-Villalba & Santos-Concejero (2021), “Total Number
of Sets as a Training Volume Quantification Method…,” Journal of Strength and
Conditioning Research.** DOI 10.1519/JSC.0000000000002776; PMID 30063555.
Systematic review; 14 randomized studies; healthy trained adults 18–35, ≥1 year
experience, ≥6 weeks. Concluded sets to/near failure are an adequate volume
measure when repetitions are broadly 6–20+ and other variables are controlled;
exact optimal set counts unresolved. **Abstract-only.**

**E-A09 — Refalo et al. (2023), “Influence of Resistance Training
Proximity-to-Failure…,” Sports Medicine.** DOI
10.1007/s40279-022-01784-y; PMID 36334240; PMCID PMC9935748. Systematic
review/meta-analysis; 15 studies, healthy adults with mixed experience. Any
set-failure definition showed trivial ES 0.19 (95% CI 0.00–0.37), but momentary
failure versus non-failure ES 0.12 (−0.13–0.37); evidence suggests a nonlinear
relationship. Definitions and protocols varied. **Abstract verified; full text
available.**

**E-A10 — Carvalho et al. (2022), “Muscle hypertrophy and strength gains after
resistance training with different volume-matched loads,” Applied Physiology,
Nutrition, and Metabolism.** DOI 10.1139/apnm-2021-0515; PMID 35015560.
Systematic review/meta-analysis of volume-load-matched protocols from <30% to
≥80% 1RM. Hypertrophy did not differ by load; high loads improved 1RM more.
Mixed populations and hypertrophy proxies. **Abstract-only.**

**E-A11 — Schoenfeld, Grgic & Krieger (2019), “How many times per week should a
muscle be trained…,” Journal of Sports Sciences.** DOI
10.1080/02640414.2018.1555906; PMID 30558493. Systematic review/meta-analysis;
25 studies. No meaningful volume-equated frequency effect, including trained
subgroups and direct growth measures; non-equated higher frequency had a modest
advantage likely reflecting volume. **Abstract-only.**

**E-A12 — Barsuhn et al. (2025), “Training volume increases or maintenance
based on previous volume…,” Journal of Applied Physiology.** DOI
10.1152/japplphysiol.00476.2024; PMID 39665246. Randomized 8-week lower-body
trial; 29 trained men completed maintenance, +30%, or +60% prior weekly volume.
Ultrasound thickness and regional FFM grew without group differences. High
attrition; small sample; proxy endpoints. **Abstract-only.**

**E-A13 — Robinson et al. (2024), “Exploring the Dose-Response Relationship
Between Estimated Resistance Training Proximity to Failure…,” Sports Medicine.**
DOI 10.1007/s40279-024-02069-2; PMID 38970765. Exploratory multilevel
meta-regressions; estimated rather than measured RIR; adjusted for load, volume
equating, duration, and training status. Hypertrophy increased closer to
failure, but models had modest fit and exact relationship remained unclear.
**Abstract-only.**

**E-A14 — Calzavara & Barroso (2026), “Effects of Weekly Set Distribution on
Volume Load…,” Journal of Strength and Conditioning Research.** DOI
10.1519/JSC.0000000000005665; PMID 42709978. Six-week randomized trial; 18
trained men; nine weekly lower-body sets performed in one or three sessions at
80% 1RM to failure. Three-session distribution increased volume load by 58% and
76% in two exercises, but not quadriceps thickness versus one session. Very
small and short; local ultrasound. **Abstract-only.**

### Topic A search log

- Databases: PubMed E-utilities; PMC availability checked through PubMed
  records. Date: 2026-09-17.
- Representative queries: “resistance training volume dose-response muscle
  hypertrophy meta-analysis”; “proximity to failure hypertrophy”; “frequency
  volume equated hypertrophy”; “low versus high load hypertrophy”; “weekly set
  volume trained men.”
- Included: systematic reviews/meta-analyses and controlled longitudinal trials
  directly comparing volume, frequency, load, or proximity to failure.
- Excluded from conclusions: cancer/sarcopenia-specific prescriptions,
  blood-flow-restriction-only comparisons, chronic stretching, strength-only
  outcomes, and papers lacking longitudinal hypertrophy outcomes.

## B. Training status, adaptation, and diminishing returns

### Conclusions

1. **Prior training status modifies expected response, but not by a validated
   universal multiplier — MODERATE confidence.** A direct 21-week MRI study
   found quadriceps CSA increased in previously untrained men but not in
   strength athletes under the same program (E-B01). A larger network
   meta-analysis also found greater hypertrophy in untrained participants
   (E-B05). However, a male whole-body meta-analysis pooling incompatible FFM,
   lean-mass, and skeletal-muscle outcomes did not find training status a
   significant moderator and yielded unstable category estimates (E-B06).
   Therefore training status may shift a group-level prior distribution, but it
   cannot deterministically order every novice–advanced pair or set a
   coefficient.
2. **No evidence-supported novice/intermediate/advanced gain rates —
   INSUFFICIENT.** Published changes depend on intervention duration, baseline
   state, dose, diet, measurement method, and muscle. E-B01 reports one direct
   comparison, not population rate constants. E-B04 demonstrates very wide
   response dispersion in 287 initially untrained adults. BodyCast must not
   assign exact kg/month rates from experience categories.
3. **Adaptation attenuates the acute response — MODERATE mechanistic
   confidence, LOW quantitative applicability.** Reviews report a shorter and
   smaller post-exercise MPS response in trained versus untrained states and
   warn that early MPS is directed partly toward damage repair and does not
   predict chronic hypertrophy (E-B02, E-B03). This supports diminishing
   response qualitatively, never a daily MPS-to-muscle conversion.
4. **Program novelty/time on program — LOW confidence for direction,
   INSUFFICIENT for a production modifier.** Early unfamiliar sessions can
   produce damage/swelling rather than true hypertrophy (E-B02). Systematic or
   random variation did not consistently improve overall hypertrophy over
   progressive fixed training in trained men (E-B07, E-B08). Time on current
   program may inform transient damage novelty (Topic J), but cannot presently
   scale chronic muscle gain.
5. **Previous weekly volume matters — LOW/MODERATE confidence.** A small
   within-person study found 120% of each trained participant's previous volume
   outperformed a fixed 22 sets/week prescription (E-A12 context is a separate
   maintenance trial; E-B09 is the individualized trial). This supports using
   training history as context, not assuming a universal “new program bonus.”
6. **Human muscle memory exists biologically, but a quantitative retraining
   bonus is unresolved — LOW confidence for hypertrophy prediction.** Reviews
   describe cellular/epigenetic memory (E-B10). Human longitudinal trials show
   retained myonuclei in some protocols, but prior training did not consistently
   produce a greater change during retraining (E-B11, E-B12). Older men
   recovered strength relatively quickly after retraining, but strength is not
   muscle mass (E-B13). Do not encode a numeric muscle-memory multiplier.
7. **Generalization:** strongest evidence concerns young men; E-B04 includes
   both sexes and ages 19–78 but initially untrained participants. Evidence for
   trained women, advanced lifters, and older trained adults is sparse.

### BodyCast interpretation

Total regular training experience can support a **coarse, uncertainty-bearing
status category** that shifts the expected-response prior. It cannot identify
an individual's rank or rate. Time on current program should not independently decrease
chronic hypertrophy or create a novelty bonus in v7. Previous program volume can
be retained as context for future personalization. Retraining should be treated
as a distinct uncertain state, with no numeric advantage until better
longitudinal whole-muscle evidence exists.

### Topic B evidence ledger

**E-B01 — Ahtiainen et al. (2003), “Muscle hypertrophy, hormonal adaptations
and strength development during strength training in strength-trained and
untrained men,” European Journal of Applied Physiology.** DOI
10.1007/s00421-003-0833-3; PMID 12734759. Controlled 21-week training study;
eight male strength athletes and eight non-strength athletes; quadriceps CSA by
MRI. Untrained men increased maximal force 20.9% and CSA 5.6%; athletes changed
3.9% and −1.8%, respectively. Very small male sample; program may have been
insufficiently novel/overloading for athletes. Direct regional muscle endpoint,
not whole-body kg. **Abstract-only.**

**E-B02 — Damas, Libardi & Ugrinowitsch (2018), “The development of skeletal
muscle hypertrophy through resistance training…,” European Journal of Applied
Physiology.** DOI 10.1007/s00421-017-3792-9; PMID 29282529. Authoritative
physiological review. Synthesizes evidence that early apparent CSA increase
(roughly the first four sessions) is largely damage/swelling; modest hypertrophy
appears after about 10 sessions and clearer true hypertrophy after about 18.
These are review-derived phase descriptions, not universal thresholds.
Applicability: protects against interpreting novelty swelling/MPS as tissue.
**Abstract-only.**

**E-B03 — Damas et al. (2015), “A review of resistance training-induced changes
in skeletal muscle protein synthesis and their contribution to hypertrophy,”
Sports Medicine.** DOI 10.1007/s40279-015-0320-0; PMID 25739559. Physiological
review. Acute MPS peaks earlier and is shorter-lived in trained states; initial
untrained MPS responses do not correlate with subsequent hypertrophy. Indirect
mechanistic evidence only. **Abstract-only.**

**E-B04 — Ahtiainen et al. (2016), “Heterogeneity in resistance
training-induced muscle strength and mass responses…,” Age.** DOI
10.1007/s11357-015-9870-1; PMID 26767377; PMCID PMC5005877. Pooled intervention
data: 287 initially untrained healthy men and women aged 19–78, including 72
controls. Mean local muscle-size change 4.8±6.1%, range −11% to 30%; age and sex
did not explain response. Measurement error and pooled protocols contribute to
dispersion; local size is not whole-body muscle kg. **Abstract verified; full
text available.**

**E-B05 — Lopez et al. (2021), “Resistance Training Load Effects on Muscle
Hypertrophy and Strength Gain,” Medicine & Science in Sports & Exercise.** DOI
not verified in the extracted record; PMID 33433148. Systematic review/network
meta-analysis; 28 studies, 747 healthy adults, sets to volitional failure.
Meta-regression found greater hypertrophy in untrained participants (p=0.033);
participants with some background benefited from more sessions. Outcomes were
mixed hypertrophy proxies. **PubMed full abstract verified.**

**E-B06 — Benito et al. (2020), “A Systematic Review with Meta-Analysis of the
Effect of Resistance Training on Whole-Body Muscle Growth in Healthy Adult
Males,” International Journal of Environmental Research and Public Health.**
DOI 10.3390/ijerph17041285; PMID 32079265. Systematic review/meta-analysis; 111
studies, 158 groups, 1,927 healthy males; interventions >2 weeks. Pooled FFM,
lean muscle mass, and skeletal muscle mass as if one outcome; mean change 1.53
kg (95% CI 1.30–1.76), but participant covariates including training status did
not explain variance. The pooled kg value is **not valid for
`skeletalMuscleKg`** because endpoints and durations were mixed. Status subgroup
CIs were wide/non-monotonic. **Full text available and inspected.**

**E-B07 — Damas et al. (2019), “Myofibrillar protein synthesis and muscle
hypertrophy individualized responses to systematically changing resistance
training variables in trained young men,” Journal of Applied Physiology.** DOI
10.1152/japplphysiol.00350.2019; PMID 31268828. Within-person 8-week study; 20 trained men,
unilateral standard progressive versus variable load/volume/contraction/rest;
MRI/CSA-type local outcome and integrated MyoPS. Similar CSA despite higher
volume and MyoPS in variable condition; between-person CSA variability greatly
exceeded within-person variability. Acute MPS and novelty did not predict more
hypertrophy. **PubMed abstract verified.**

**E-B08 — Kassiano et al. (2022), “Does Varying Resistance Exercises Promote
Superior Muscle Hypertrophy and Strength Gains?” Journal of Strength and
Conditioning Research.** DOI not verified; PMID 35438660. Systematic review;
eight studies, 241 young men. Some systematic variation affected regional
growth; excessive/random variation did not reliably improve and could impair
adaptations. Local proxy outcomes; no quantitative novelty decay. **PubMed
abstract verified.**

**E-B09 — Scarpelli et al. (2022), “Muscle Hypertrophy Response Is Affected by
Previous Resistance Training Volume in Trained Individuals,” Journal of
Strength and Conditioning Research.** DOI
10.1519/JSC.0000000000003558; PMID 32108724. Within-subject 8-week trial; 16
trained participants; one leg received fixed 22 sets/week and the other 1.2×
logged prior volume. Ultrasound vastus lateralis CSA change favored
individualized volume (mean difference 1.08 cm², 95% CI 0.04–2.11). Small,
short, local endpoint; 1.2 is protocol-specific and not a general coefficient.
**Abstract-only.**

**E-B10 — Sharples & Turner (2023), “Skeletal muscle memory,” American Journal
of Physiology–Cell Physiology.** DOI 10.1152/ajpcell.00099.2023; PMID 37154489.
Authoritative review of cellular and epigenetic mechanisms. Supports biological
plausibility, not a human gain-rate parameter. **Abstract-only.**

**E-B11 — Cumming et al. (2024), “Muscle memory in humans…,” Journal of
Physiology.** DOI 10.1113/JP285675; PMID 39159314. Longitudinal within-person
study; 12 untrained men and women; 10 weeks unilateral training, 16 weeks
detraining, 10 weeks bilateral retraining; biopsy fiber CSA, myonuclei, RNA.
Myonuclei persisted and previously trained type-II fibers were larger at end,
but change during retraining did not differ. Cellular endpoint; small sample.
**Abstract-only.**

**E-B12 — Psilander et al. (2019), “Effects of training, detraining, and
retraining on strength, hypertrophy, and myonuclear number…,” Journal of
Applied Physiology.** DOI 10.1152/japplphysiol.00917.2018; PMID 30991013.
Nine men and ten women; 10-week unilateral training, 20-week detraining,
5-week bilateral retraining; biopsy, ultrasound, 1RM. Thickness/CSA returned to
baseline during detraining; retraining thickness and strength increased
similarly in previously trained and control legs. **Abstract-only.**

**E-B13 — Blocquiaux et al. (2020), “The effect of resistance training,
detraining and retraining…in older men,” Experimental Gerontology.** DOI
10.1016/j.exger.2020.110860; PMID 32017951. Thirty older men and 10 controls;
12-week training/detraining/retraining; biopsy subset n=6. Strength recovered to
post-training level in under eight retraining weeks; type-II fiber responses
were uncertain. Strength must not proxy muscle mass. **Abstract-only.**

### Topic B search log

- Sources: prior-agent PubMed E-utilities records plus PubMed/PMC and publisher
  discovery verification on 2026-09-17.
- Queries: “resistance training status moderator hypertrophy trained untrained
  meta-analysis”; “expected rate muscle hypertrophy novice trained MRI”;
  “program novelty exercise variation hypertrophy”; “human muscle memory
  retraining detraining.”
- Included: direct trained-versus-untrained comparison, syntheses testing status
  moderators, longitudinal retraining studies, and reviews separating MPS/damage
  from chronic hypertrophy.
- Excluded: bodybuilding heuristics, uncontrolled athlete anecdotes,
  cross-sectional trained-versus-untrained size comparisons, and animal-only
  memory studies.

## C. Detraining and reduced training

### Conclusions

1. **Complete cessation eventually reduces muscle size — MODERATE confidence;
   exact onset/rate LOW.** In older adults, a six-study meta-analysis found
   clear post-training size loss overall and clearer loss after 31–52 weeks than
   12–24 weeks (E-C01). One small young-adult trial found ultrasound-derived
   physiological CSA fell after two and four weeks but remained above baseline
   (E-C02). These endpoints do not provide a whole-body tissue-loss rate.
2. **Strength loss is distinct and duration-dependent — HIGH confidence.**
   Meta-analysis across 103 studies found cessation impaired strength/power,
   with greater loss over longer cessation and moderation by age/status
   (E-C03). Neural/skill retention means strength cannot be used as a direct
   skeletal-muscle proxy.
3. **Substantially reduced loading can maintain hypertrophy — MODERATE
   confidence.** After 16 weeks of training, one-third and one-ninth maintenance
   doses preserved hypertrophy for 32 weeks in young adults, but not older
   adults (E-C04). A narrative synthesis reaches similar conclusions but its
   precise minimum-dose recommendations should not be production constants
   (E-C05). Reduced frequency/volume must not be treated as cessation or
   immediate tissue loss.
4. **Age modifies maintenance requirements — MODERATE confidence.** E-C04 found
   reduced doses preserved young-adult but not older-adult hypertrophy; E-C01
   concerns only older adults. Generalizing one maintenance fraction across
   ages is unsupported.
5. **Retraining evidence does not justify a quantitative memory bonus — LOW.**
   E-B11/E-C06 and E-B12/E-C07 found cellular persistence or prior adaptation
   but no clearly greater hypertrophy change during retraining. E-B13 found
   faster strength recovery in older men, which cannot set muscle gain.
6. **Early glycogen/water versus tissue loss is unresolved — INSUFFICIENT for
   quantitative partitioning.** Detraining studies generally use ultrasound,
   DXA, MRI/CSA, or fiber area and do not simultaneously quantify glycogen,
   water, and contractile protein. The rapid −6±8% and −10±8% ultrasound-derived
   CSA changes at two/four weeks in E-C02 must not be interpreted as equal
   contractile-tissue loss. Exercise glycogen studies establish that glycogen is
   labile (Topic F), but they do not quantify detraining-associated glycogen
   loss. BodyCast must model glycogen/water separately and avoid forcing early
   scale/lean changes into skeletal muscle.
7. **Generalization:** evidence is split between initially untrained young
   adults and older adults. Data in advanced lifters and trained women are
   sparse; athlete cessation may differ because ordinary activity continues.

### BodyCast interpretation

Cessation should stop accrual of training stimulus immediately, but actual
skeletal-muscle loss should not be an instantaneous step. Longer continued
cessation may increase loss risk; the literature does not support a universal
daily decay constant. Reduced-but-nonzero hard training can maintain previously
gained muscle and should be represented separately from zero training. On
resumption, training stimulus returns; no numeric retraining acceleration is
approved.

### Topic C evidence ledger

**E-C01 — Grgic (2022), “Use It or Lose It? A Meta-Analysis on the Effects of
Resistance Training Cessation (Detraining) on Muscle Size in Older Adults,”
International Journal of Environmental Research and Public Health.** DOI
10.3390/ijerph192114048; PMID 36360927; PMCID PMC9657634. Systematic
review/meta-analysis; six studies/eight groups; older adults; prior training
9–24 weeks; cessation 12–52 weeks; mixed muscle-size proxies. Post-training to
detraining d=−0.83 (95% CI −1.30 to −0.36). At 12–24 weeks d=−0.60
(−1.21 to 0.01); at 31–52 weeks d=−1.11 (−1.75 to −0.47). Small evidence base,
wide intervals, no daily rate. **Abstract verified; full text available.**

**E-C02 — McMahon et al. (2019), “Circulating Tumor Necrosis Factor Alpha May
Modulate the Short-Term Detraining Induced Muscle Mass Loss…,” Frontiers in
Physiology.** DOI 10.3389/fphys.2019.00527; PMID 31130871; PMCID PMC6509206.
Controlled study; training n=16 (8 women/8 men; 20±3 years), control n=14; eight
weeks training then two/four weeks detraining. Vastus-lateralis normalized
physiological CSA by ultrasound fell −6±8% at two and −10±8% at four weeks from
post-training while remaining above baseline. Local morphology is a proxy and
may include fluid/glycogen; small sample. **Full text available and inspected.**

**E-C03 — Bosquet et al. (2013), “Effect of training cessation on muscular
performance,” Scandinavian Journal of Medicine & Science in Sports.** DOI
10.1111/sms.12047; PMID 23347054. Meta-analysis; 103 studies. Cessation reduced
submaximal strength SMD −0.62 (95% CI −0.80 to −0.45), maximal force −0.46
(−0.54 to −0.37), power −0.20 (−0.28 to −0.13); losses increased with duration
and were larger in adults >65. Performance only, not muscle mass.
**Abstract-only.**

**E-C04 — Bickel, Cross & Bamman (2011), “Exercise Dosing to Retain Resistance
Training Adaptations in Young and Older Adults,” Medicine & Science in Sports &
Exercise.** DOI 10.1249/MSS.0b013e318207c15d; PMID 21131862. Randomized
maintenance trial; 70 men and women, young 20–35 and older 60–75; 16 weeks at
three days/week followed by 32 weeks detraining, one-third dose, or one-ninth
dose. Both reduced doses preserved hypertrophy in young but not old; one-third
produced additional young-adult fiber growth. Muscle/fiber measures, not
whole-body skeletal-muscle kg. Dose fractions are protocol-specific.
**PubMed abstract verified.**

**E-C05 — Spiering et al. (2021), “Maintaining Physical Performance: The
Minimal Dose of Exercise Needed to Preserve Endurance and Strength Over Time,”
Journal of Strength and Conditioning Research.** DOI
10.1519/JSC.0000000000003964; PMID 33629972. Narrative review. Concludes large
frequency/volume reductions can maintain younger-adult strength/size if relative
load remains; older adults appear to need more. Useful direction, but reported
“minimum” prescriptions are not meta-analytic thresholds and athlete data were
insufficient. **Abstract-only.**

**E-C06 — Cumming et al. (2024).** Same study as E-B11. Ten-week training,
16-week detraining, 10-week retraining in 12 adults; retained myonuclei but no
different retraining delta. See E-B11.

**E-C07 — Psilander et al. (2019).** Same study as E-B12. Ten-week training,
20-week detraining, five-week retraining in 19 adults; ultrasound thickness and
fiber CSA returned toward baseline, and retraining was similar between limbs.
See E-B12.

**E-C08 — Vikne et al. (2020), “Human skeletal muscle fiber type percentage
and area after reduced muscle use,” Scandinavian Journal of Medicine & Science
in Sports.** DOI 10.1111/sms.13675; PMID 32281690. Systematic review/meta-analysis;
42 studies, 451 participants; ≥14 days of detraining, unloading, or bed rest.
Fiber CSA decreased across types, more in type II. Indirect for ordinary workout
cessation because severe unloading/bed rest were pooled; biopsy fiber area does
not equal total skeletal-muscle mass. **PubMed abstract/full page verified.**

### Topic C search log

- Sources: PubMed, PMC, and prior-agent PubMed records; searched 2026-09-17.
- Queries: “detraining resistance training muscle size systematic review”;
  “reduced resistance training dose maintain muscle size Bickel”; “young adults
  short-term detraining CSA”; “glycogen water detraining muscle size.”
- Included: cessation meta-analyses, controlled young-adult cessation,
  randomized reduced-dose maintenance, and retraining studies.
- Excluded: endurance-only detraining, disease rehabilitation, bed-rest results
  as direct ordinary detraining evidence, and strength-only findings from
  skeletal-muscle mass parameters.

## D. Protein → muscle gain and retention

### Conclusions

1. **Protein directly supports resistance-training adaptation — HIGH confidence
   for direction, MODERATE for skeletal-muscle magnitude.** In 49 randomized
   trials, supplementation added small average gains in FFM and local muscle
   size during ≥6 weeks of resistance training (E-D01). A larger healthy-adult
   synthesis also found a small lean-body-mass benefit when protein was combined
   with resistance exercise (E-D03). FFM/LBM remain proxies, so neither gives a
   direct kg skeletal-muscle coefficient.
2. **Dose response is saturating, not binary — MODERATE confidence.** E-D01's
   breakpoint was 1.62 g/kg body mass/day, with a wide 95% CI of 1.03–2.20.
   E-D02 found a shallower LBM response above about 1.3 g/kg/day across
   heterogeneous trials. These population models support a smooth adequacy
   range and plateau, not an individual threshold.
3. **Near-maximal adaptation range — MODERATE confidence.** For energy-sufficient
   resistance training, approximately 1.6 g/kg/day is a population central
   estimate, with uncertainty extending roughly 1.0–2.2 g/kg/day in E-D01.
   BodyCast may use that *range* to define uncertainty around adequacy, but must
   not claim that 1.62 is an exact personal cutoff.
4. **Energy deficit increases the value/possible requirement of protein —
   MODERATE direction, LOW exact requirement.** Two short controlled trials in
   young men under severe (~40%) restriction found 2.3–2.4 g/kg/day preserved
   or increased LBM better than 1.0–1.2 (E-D05, E-D06). A 47-study
   overweight/obesity meta-analysis supports better muscle/lean retention with
   enhanced protein (E-D04). These do not establish a universal deficit
   requirement, particularly in women, older adults, milder deficits, or for
   actual skeletal muscle.
5. **FFM denominator during deficit — LOW confidence.** The often-cited
   2.3–3.1 g/kg FFM/day range comes from a six-study review of lean,
   resistance-trained athletes and scales a recommendation by leanness/deficit
   severity (E-D07). It is not a validated dose-response breakpoint. Keep this
   denominator/range out of production v7 unless separately validated.
6. **Very high protein — MODERATE confidence for no proven extra hypertrophy.**
   E-D01 found no further FFM benefit above its breakpoint; uncertainty does not
   prove harm or a hard ceiling. Very high intake must not enable unlimited
   muscle gain.
7. **Timing/distribution — MODERATE confidence to omit.** A 2025 direct
   before-versus-after meta-analysis found no important LBM difference
   (E-D08). Distribution evidence is limited/inconsistent and confounded by
   total intake (E-D09). Total daily protein is the defensible v7 input.
8. **Missing protein:** missing is unknown, not zero and not automatically
   inadequate. A protein modifier should be unavailable/neutral with widened
   uncertainty rather than penalizing muscle.

### BodyCast interpretation

Use daily protein normalized by body mass as an input to a smooth, bounded
adequacy relationship that affects training-mediated gain and deficit retention.
The scientifically supportable contract is directional and range-based. An
exact curve, maximum bonus, deficit interaction, or FFM-denominator conversion
is not yet justified. Protein cannot create muscle without an appropriate
training/adaptation context, and adequate protein cannot override energy,
training-status, or physiological gain bounds.

### Topic D evidence ledger

**E-D01 — Morton et al. (2018), “A systematic review, meta-analysis and
meta-regression of the effect of protein supplementation on resistance
training-induced gains…,” British Journal of Sports Medicine.** DOI
10.1136/bjsports-2017-097608; PMID 28698222; PMCID PMC5867436. Systematic
review/meta-analysis; 49 randomized trials, 1,863 healthy adults; resistance
training ≥6 weeks. Supplementation added FFM 0.30 kg (95% CI 0.09–0.52),
fiber CSA 310 µm² (51–570), and mid-femur CSA 7.2 mm² (0.20–14.30). Two-segment
FFM breakpoint 1.62 g/kg/day (95% CI 1.03–2.20). FFM and local CSA are proxies;
supplement trials do not span all diets/populations. **Full text available;
abstract and reported breakpoint verified.**

**E-D02 — Tagawa et al. (2021), “Dose-response relationship between protein
intake and muscle mass increase,” Nutrition Reviews.** DOI
10.1093/nutrit/nuaa104; PMID 33300582; PMCID PMC7727026. Systematic
review/meta-analysis of 105 randomized articles, 5,402 participants; broad
protein interventions (not all resistance-trained). Spline response to each
0.1 g/kg/day increment was 0.39 kg LBM below and 0.12 kg above 1.3 g/kg/day.
This counterintuitive magnitude pools months-long heterogeneous contexts and LBM
and must not be used as a daily/individual coefficient. **Full text available;
abstract verified.**

**E-D03 — Nunes et al. (2022), “Systematic review and meta-analysis of protein
intake to support muscle mass and function in healthy adults,” Journal of
Cachexia, Sarcopenia and Muscle.** DOI not verified; PMID 35187864. Systematic
review/meta-analysis; resistance-exercise subgroup 62 studies; additional
protein increased LBM SMD 0.22 (95% CI 0.14–0.30), moderate certainty. Effects
were smaller/less certain in older adults. LBM proxy. **PubMed page verified.**

**E-D04 — Kokura et al. (2024), “Enhanced protein intake on maintaining muscle
mass…in adults with overweight/obesity,” Clinical Nutrition ESPEN.** DOI
10.1016/j.clnesp.2024.06.030; PMID 39002131. Systematic review/meta-analysis; 47 randomized studies,
n=3,218; weight-loss context. Enhanced protein attenuated “muscle mass” decline
(SMD 0.75, 95% CI 0.41–1.10), with risk of bias low to high. Population and
mixed body-composition endpoints limit transfer to trained lean users.
**PubMed abstract verified.**

**E-D05 — Mettler, Mitchell & Tipton (2010), “Increased Protein Intake Reduces
Lean Body Mass Loss during Weight Loss in Athletes,” Medicine & Science in
Sports & Exercise.** DOI 10.1249/MSS.0b013e3181b2ef8e; PMID 19927027.
Controlled two-week ~40% energy-restriction trial; 20 young resistance-trained
athletes; habitual training continued. About 2.3 versus 1.0 g/kg/day protein:
LBM change −0.3±0.3 versus −1.6±0.3 kg (p=0.006). Short, severe restriction;
LBM includes water/glycogen and is not skeletal muscle. **PubMed abstract
verified.**

**E-D06 — Longland et al. (2016), “Higher compared with lower dietary protein
during an energy deficit combined with intense exercise…,” American Journal of
Clinical Nutrition.** DOI 10.3945/ajcn.115.119339; PMID 26817506. Randomized
four-week trial; 40 overweight young men; ~40% deficit; six exercise days/week,
including resistance/interval work; 2.4 versus 1.2 g/kg/day. Four-compartment
LBM increased 1.2±1.0 versus 0.1±1.0 kg; fat loss −4.8±1.6 versus −3.5±1.4 kg.
Proof-of-principle, extreme intervention, untrained/overweight men, LBM proxy.
**Publisher full text/abstract verified.**

**E-D07 — Helms, Aragon & Fitschen (2014), “A Systematic Review of Dietary
Protein During Caloric Restriction in Resistance Trained Lean Athletes,”
International Journal of Sport Nutrition and Exercise Metabolism.** DOI not
verified; PMID 24092765. Systematic review of six studies/13 groups. Proposed
2.3–3.1 g/kg FFM/day, scaled with leanness and restriction severity. Mostly
short, small, nonrandomized/mixed studies; recommendation is inferential and
FFM-based, not a validated personal threshold. **PubMed abstract verified.**

**E-D08 — Casuso & Goossens (2025), “Does Protein Ingestion Timing Affect
Exercise-Induced Adaptations?” Nutrients.** DOI 10.3390/nu17132070; PMID
40647175. Systematic review/meta-analysis restricted to direct pre-versus-post
comparisons; five studies/six reports; ≥4 weeks. LBM timing effect SMD −0.08
(95% CI −0.398 to 0.244; I²=0%). Lean mass proxy; small evidence base.
**PubMed abstract verified.**

**E-D09 — Hudson et al. (2020), “Protein Distribution and Muscle-Related
Outcomes: Does the Evidence Support the Concept?” Nutrients.** DOI not verified;
PMID 32429355. Review of observational and randomized evidence. Distribution
effects were limited/inconsistent and could not be separated from total
quantity. Mechanistic acute MPS saturation is not chronic hypertrophy evidence.
**PubMed abstract verified.**

**E-D10 — Kanaan, Nait-Yahia & Doucet (2025), “The effects of high protein
intakes during energy restriction…,” European Journal of Clinical Nutrition.**
DOI 10.1038/s41430-025-01585-2; PMID 40011662. Randomized six-week 25% deficit
trial; 21 college athletes; full-body resistance training three days/week;
~1.2, 1.6, or 2.2 g/kg/day. All groups reduced fat and increased DXA FFM with no
protein effect. Very small groups and FFM proxy; demonstrates uncertainty and
conflicts with severe-deficit trials. **Abstract-only.**

### Topic D search log

- Sources: PubMed/PMC, journal pages, prior-agent PubMed records; 2026-09-17.
- Queries: “protein supplementation resistance training meta-regression”;
  “protein intake dose response lean body mass”; “protein caloric restriction
  resistance-trained lean retention”; “protein timing distribution hypertrophy.”
- Included: randomized-trial syntheses, direct resistance-training analyses,
  and controlled deficit trials.
- Excluded: acute MPS-only feeding studies as chronic coefficients, protein-type
  rankings, disease-only sarcopenia treatments, and narrative fitness guidance.

## E. Energy balance → muscle gain, retention, and fat partition

### Conclusions

1. **Prolonged energy deficit suppresses lean-mass gain from resistance training
   — MODERATE/HIGH confidence.** Meta-analysis found less LM gain under deficit
   than energy-sufficient training, while strength gain was not significantly
   different (E-E01). The fitted ~500 kcal/day point at which mean LM gain
   reached zero is a study-level meta-regression result, not an individual
   threshold or universal daily multiplier.
2. **Muscle/lean retention is improved by resistance training during weight loss
   — HIGH for FFM, MODERATE for skeletal muscle.** A 2025 meta-analysis of 25
   randomized trials in adults with overweight/obesity found resistance
   exercise protected FFM and increased fat loss relative to diet alone
   (E-E02). This population and FFM endpoint do not directly quantify
   `skeletalMuscleKg`.
3. **Recomposition is possible — HIGH that it can occur; LOW for personal
   probability/magnitude.** Controlled severe-deficit studies found maintained
   or increased LBM when high protein and intensive exercise were combined
   (E-D06/E-E03), and slower loss in athletes allowed LBM gain (E-E04). Thus a
   deficit must suppress expected gain but must not categorically forbid it,
   especially in less-trained or higher-fat users with adequate protein.
4. **Deficit severity/rate matters — MODERATE confidence.** E-E01 supports
   greater suppression with larger energy deficit. In 24 athletes, ~0.7%
   body-weight loss/week preserved/gained more DXA LBM than a ~1.4% target
   (E-E04), but the achieved rates overlapped and long-term group differences
   disappeared. Do not encode either rate as a universal boundary.
5. **A surplus is not proven necessary for hypertrophy — LOW/INSUFFICIENT for
   necessity.** The authoritative review found no validated optimal surplus or
   energy cost of muscle accretion (E-E05). In a very small trained-lifter trial,
   maintenance, 5%, and 15% surplus groups had no clear muscle-thickness
   differences, while faster mass gain predicted skinfold gain (E-E06).
6. **Larger surplus mainly increases fat beyond some context-dependent point —
   MODERATE direction, INSUFFICIENT threshold.** E-E06 directly supports this
   ordering in trained lifters over eight weeks. Narrative recommendations such
   as 10–20% surplus or fixed kcal/day are not validated physiological
   constants and are excluded.
7. **Deficit and surplus are asymmetric.** Evidence strongly supports deficit
   impairment; evidence does not support a mirrored surplus benefit. One
   symmetric energy-availability equation would manufacture evidence.
8. **Body-fat status — LOW qualitative confidence, INSUFFICIENT quantitative
   modifier.** Higher-fat/untrained populations can recompose, but studies
   confound adiposity, training status, diet, and intervention. No validated
   body-fat-to-muscle partition coefficient is available.
9. **Generalization:** deficit evidence includes athletes and adults with
   overweight/obesity; direct surplus evidence is one small trained cohort.
   Women and advanced athletes remain underrepresented in surplus trials.

### BodyCast interpretation

Use separate behaviors: sustained deficit reduces expected muscle gain and can
increase loss risk; resistance training and adequate protein mitigate that risk;
recomposition remains allowed. Maintenance energy can support hypertrophy.
Surplus must not automatically increase muscle gain, and larger surplus must
primarily permit greater fat storage once training-driven muscle response is
bounded. Exact deficit/surplus coefficients are deferred.

### Topic E evidence ledger

**E-E01 — Murphy & Koehler (2022), “Energy deficiency impairs resistance
training gains in lean mass but not strength,” Scandinavian Journal of Medicine
& Science in Sports.** DOI 10.1111/sms.14075; PMID 34623696. Systematic
review/meta-analysis/meta-regression of randomized RT studies with energy
deficit ≥3 weeks. Parallel controls: LM effect ES −0.57, p=0.02; strength ES
−0.31, p=0.28. Meta-regression estimated ~500 kcal/day deficit prevented mean LM
gain. Study-level deficit estimates, mixed populations, LM proxy, and sparse
direct controls preclude a personal threshold. **Abstract and PubMed page
verified.**

**E-E02 — Binmahfoz et al. (2025), “Effect of resistance exercise on body
composition…during dietary weight loss in people living with overweight or
obesity,” BMJ Open Sport & Exercise Medicine.** DOI 10.1136/bmjsem-2024-002363; PMID 40909191.
Systematic review/meta-analysis; 25 randomized trials, adults 18–65 with BMI
≥25; diet+resistance exercise versus diet only. FFM preservation SMD 0.40
(p=0.0003, moderate certainty); fat-mass change SMD −0.36 (p<0.00001, high
certainty). FFM proxy and overweight/obesity population. **PubMed abstract
verified.**

**E-E03 — Longland et al. (2016).** Same study as E-D06. Four-week ~40% deficit,
high exercise volume; 2.4 g/kg/day protein group increased four-compartment LBM
1.2±1.0 kg. Demonstrates possibility, not typical rate.

**E-E04 — Garthe et al. (2011), “Effect of two different weight-loss rates on
body composition and strength and power-related performance in elite athletes,”
International Journal of Sport Nutrition and Exercise Metabolism.** DOI
10.1123/ijsnem.21.2.97; PMID 21558571. Randomized 24 athletes; targets 0.7% vs
1.4% body weight/week, four resistance sessions/week; intervention durations
8.5±2.2 vs 5.3±0.9 weeks. DXA LBM +2.1±0.4% in slower group and −0.2±0.7% in
faster group (between-group p<0.01). Different durations and DXA hydration
sensitivity; small mixed-sport sample. **PubMed abstract verified.**

**E-E05 — Slater et al. (2019), “Is an Energy Surplus Required to Maximize
Skeletal Muscle Hypertrophy Associated With Resistance Training,” Frontiers in
Nutrition.** DOI 10.3389/fnut.2019.00131; PMID 31482093; PMCID PMC6710320.
Physiological/narrative review. Found no validated surplus “sweet spot” or
consistent energy cost of training-induced muscle accretion. Its conservative
practical surplus suggestions are explicitly not validated parameters.
**Full text available; abstract verified.**

**E-E06 — Helms et al. (2023), “Effect of Small and Large Energy Surpluses on
Strength, Muscle, and Skinfold Thickness in Resistance-Trained Individuals,”
Sports Medicine Open.** DOI 10.1186/s40798-023-00651-y; PMID 37914977; PMCID
PMC10620361. Eight-week parallel trial; 21 randomized, 17 completers; trained
lifters; maintenance, estimated 5%, or 15% surplus; RT three days/week.
No group-model evidence for local muscle thickness; higher surplus increased
skinfolds, and body-mass change predicted skinfold change (R²=0.49). Weak
biceps signal only. Very underpowered, local ultrasound, estimated intake.
**Full text available; abstract verified.**

**E-E07 — Mettler et al. (2010).** Same study as E-D05. Severe short deficit in
20 trained athletes: higher protein attenuated LBM loss. Relevant interaction,
not skeletal-muscle quantification.

**E-E08 — Fogelholm/Garthe follow-up (2011), “Long-Term Effect of Weight Loss
on Body Composition and Performance in Elite Athletes.”** DOI not verified;
PMID 21896944. Follow-up of slow/fast loss trial; at six and 12 months, group
body-composition/performance differences were not significant. Indicates acute
rate findings are not persistent constants. **PubMed abstract verified.**

### Topic E search log

- Sources: PubMed/PMC and journal pages; searched 2026-09-17.
- Queries: “energy deficiency resistance training lean mass meta-analysis”;
  “energy surplus magnitude hypertrophy resistance trained”; “slow fast weight
  loss athletes lean mass”; “resistance exercise dietary weight loss FFM.”
- Included: controlled deficit/surplus comparisons and relevant syntheses.
- Excluded: textbook surplus calculations, bodybuilding recommendations
  without validation, acute hormone/MPS-only studies, and observational
  body-fat partition claims.

## F. Glycogen depletion from resistance training

### Conclusions

1. **Resistance exercise acutely depletes glycogen in recruited muscle —
   HIGH confidence.** The 2025 meta-analysis of 20 studies found a mean
   vastus-lateralis concentration reduction of 104.3 mmol/kg dry mass
   (approximately 21%), but its 95% prediction interval included no depletion
   and heterogeneity was high (E-F01). This is local concentration, not grams of
   whole-body glycogen.
2. **Volume/duration direction — MODERATE confidence.** Meta-regression found
   greater local depletion with more sets and longer sessions (E-F01). The
   reported slopes (−11.2 mmol/kg dry mass per set and −1.3 per minute) are
   study-level associations, partly collinear, and must not be summed or
   converted directly into whole-body kilograms.
3. **Load/intensity is not a simple positive driver — MODERATE confidence.**
   Higher %1RM was associated with *less* depletion in E-F01, likely because
   heavier protocols perform less total work. Repetitions could not be
   meta-regressed. This rejects a universal “heavier set = more glycogen”
   assumption.
4. **Training status — LOW/MODERATE.** E-F01 found slightly greater depletion
   in untrained than trained subgroups, but groups were not randomized to
   status. One elite-weightlifter study still observed 38% vastus-lateralis
   depletion after high-volume lower-body work (E-F02), showing trained status
   does not eliminate demand.
5. **Fiber/subcellular and muscle-group specificity — HIGH confidence.**
   E-F02 found markedly heterogeneous use across fiber types and glycogen
   locations. Almost all pooled data are vastus lateralis; upper-body and
   whole-body transfer is uncertain.
6. **Initial glycogen — physiologically relevant but quantitatively unresolved
   for resistance sessions.** Reviews identify baseline availability as a
   determinant and note limited resistance-specific phenotypic evidence
   (E-F03). No robust depletion equation by initial store is available.
7. **Reasonable bounds:** depletion cannot be negative, cannot exceed the
   glycogen present in recruited tissue, and a workout cannot create glycogen.
   However, current BodyCast has only an aggregate glycogen state and no
   evidence-based recruited-muscle glycogen fraction. The literature therefore
   does **not** support a production kg/workout coefficient yet.
8. **Strength versus stepper:** resistance work produces localized,
   set-dependent depletion with substantial type-II involvement; aerobic
   stepping is duration/intensity/fuel-mixture dependent (Topic G). They must
   not share one kcal-to-glycogen conversion.
9. **Generalization:** 168 of 180 participants in E-F01 were men; nearly all
   biopsies were vastus lateralis. Evidence for women and upper-body sessions is
   very limited.

### BodyCast interpretation

Planned hard sets, recruited-muscle mapping, and duration are scientifically
relevant inputs. They justify direction and ordering but not whole-body grams.
Until an evidence-based conversion from local concentration to the aggregate
glycogen compartment exists, numeric resistance-workout depletion is **DEFER**.
The daily simulator may still test conservation and monotonic relationships
before a coefficient is approved.

### Topic F evidence ledger

**E-F01 — Hamidvand et al. (2025), “Acute effects of resistance exercise on
skeletal muscle glycogen depletion,” Physiological Reports.** DOI
10.14814/phy2.70683; PMID 41420384; PMCID PMC12717450. Systematic
review/multilevel meta-analysis; 20 studies, 28 effects; 168 men, 12 women;
mainly vastus-lateralis biopsies; sessions 3–20 sets, mean intensity
72.3±13.4% 1RM, mean rest 127.5±44.4 seconds. Mean concentration change
−104.3 mmol/kg dry mass (95% CI −137.6 to −71.0; prediction interval −244.4 to
+35.7), approximately −21%; I² 85.7%. More sets: −11.2 per set (95% CI −18.0
to −4.3); duration: −1.3 per minute (−2.3 to −0.3); intensity: +2.88 per %1RM
(1.2–4.5). Possible publication bias; moderator data observational across
protocols; repetitions/sex could not be modeled. **Full text inspected.**

**E-F02 — Hokken et al. (2021), “Subcellular localization- and fibre
type-dependent utilization of muscle glycogen during heavy resistance
exercise…,” Acta Physiologica.** DOI 10.1111/apha.13561; PMID 32961628. Acute
biopsy study; 10 male elite power/Olympic weightlifters; 4×5 squats at 75% 1RM,
4×5 deadlifts at 75%, and 4×12 rear-foot-elevated split squats at 65%.
Vastus-lateralis biochemical glycogen fell 38% (31–45%). Electron microscopy
showed type-II depletion across all locations but mostly intermyofibrillar use
in type I. Local, extreme lower-body protocol; not whole-body grams.
**Abstract-only.**

**E-F03 — Knuiman, Hopman & Mensink (2015), “Glycogen availability and skeletal
muscle adaptations with endurance and resistance exercise,” Nutrition &
Metabolism.** DOI 10.1186/s12986-015-0055-9; PMID 26697098; PMCID PMC4687103.
Physiological review. Resistance-specific evidence on low glycogen and chronic
adaptation was sparse; baseline availability matters mechanistically but no
validated depletion transition was supplied. **Full text available; abstract
verified.**

**E-F04 — Koopman et al. (2006), “Intramyocellular lipid and glycogen content
are reduced following resistance exercise in untrained healthy males,”
European Journal of Applied Physiology.** DOI 10.1007/s00421-005-0118-0; PMID 16369816.
Acute study; eight untrained lean men, overnight fast, ~45-minute resistance
session; biopsies. Fiber glycogen fell 23±6% (type I), 40±7% (IIa), and 44±7%
(IIx), with no recovery during two fasted hours. Small, fasted, local,
untrained-male evidence. **PubMed abstract verified.**

**E-F05 — Henselmans et al. (2022), “The Effect of Carbohydrate Intake on
Strength and Resistance Training Performance,” Nutrients.** DOI
10.3390/nu14040856; PMID 35215506; PMCID PMC8878406. Systematic review; 49
studies. Carbohydrate rarely improved fed-state sessions up to ~10 sets per
muscle; benefits appeared more often with >10 sets, fasted controls, or twice-
daily work. Performance evidence only; does not quantify glycogen use.
**Full text available; abstract verified.**

### Topic F search log

- Sources: PubMed/PMC and full 2025 open-access meta-analysis; 2026-09-17.
- Queries: “muscle glycogen resistance exercise depletion”; “sets repetitions
  duration load glycogen”; “elite weightlifters subcellular glycogen.”
- Included: biopsy-based acute studies and quantitative synthesis.
- Excluded: carbohydrate-performance studies as depletion coefficients,
  signaling-only low-glycogen experiments, and universal kcal-to-glycogen
  conversions.

## G. Glycogen depletion from stair/stepper activity

### Conclusions

1. **Direct evidence gap:** no located stair/stepper study directly measured
   muscle glycogen depletion or separated carbohydrate oxidation from fat.
   Stair studies measured VO2, HR, RER in some protocols, or energy cost only
   (E-G01–E-G04). A numeric stepper glycogen coefficient is therefore
   **INSUFFICIENT**.
2. **Stepper/stair intensity — MODERATE direct confidence.** Continuous ascent
   is commonly vigorous: one 103-person field study reported mean terminal VO2
   33.5±4.8 mL/kg/min and HR 159±15 bpm during an 11-story ascent (E-G01);
   another measured 8.6 gross MET at 70 steps/min (E-G02). These protocol
   averages are not universal METs for device-based steppers.
3. **Intensity increases carbohydrate reliance — HIGH general aerobic
   physiology, LOW/MODERATE stepper transfer.** Stable-isotope/calorimetry work
   at 25%, 65%, and 85% VO2max found plasma glucose uptake and muscle-glycogen
   oxidation rose with intensity (E-G05). The crossover review supports the
   direction (E-G06). Both are cycling-based/general and explicitly
   **extrapolated** to stepping.
4. **Duration changes both total demand and source mixture.** At a fixed
   intensity, longer exercise increases total energy demand, but glycogen
   oxidation can decline over time as plasma-derived substrate contribution
   rises (E-G05, E-G07). Thus neither duration nor active kcal alone identifies
   glycogen use.
5. **HR can locate relative intensity only imperfectly.** Individual
   calibration to VO2/HR was used successfully in a 14-person stair study
   (E-G03), but uncalibrated HR does not reveal RER or partition carbohydrate
   between muscle glycogen, liver glycogen, and blood glucose. Topic K evaluates
   energy estimation error.
6. **Mode transfer is uncertain.** Cycling and running at the same relative
   intensity can differ in muscle recruitment and glycogen response (E-G08).
   Stair ascent's large vertical work and quadriceps recruitment make cycling
   a plausible qualitative comparator, not a quantitative substitute.
7. **Safe model behavior:** a completed stepper bout can cause nonnegative,
   state-bounded glycogen demand. For one continuous matched bout, total energy
   demand is non-decreasing with duration. Direct stepper evidence does not
   support a production invariant for relative-intensity carbohydrate ordering,
   muscle-glycogen monotonicity, or fuel fraction. Exogenous carbohydrate and
   initial glycogen further modify source selection.

### BodyCast interpretation

Duration, active energy, and individualized relative HR intensity are relevant
to a future stepper demand model. They do not support a universal fraction of
active kcal from glycogen. Direct stepper depletion should remain **DEFER**;
only conservation and matched-protocol energy-duration claims are approved.
Any cycling/running substrate transfer must be labelled extrapolated, carry low
confidence, and remain outside production RED invariants.

### Topic G evidence ledger

**E-G01 — Teh & Aziz (2002), “Heart rate, oxygen uptake, and energy cost of
ascending and descending the stairs,” Medicine & Science in Sports & Exercise.**
DOI not verified; PMID 11932581. Field physiology study; ascent n=103, descent
n=49; 11 stories/180 steps/27 m. Terminal ascent VO2 33.5±4.8 mL/kg/min, HR
159±15 bpm; estimated 9.6 MET. Direct stair energy/intensity, no RER/glycogen.
**PubMed abstract verified.**

**E-G02 — Bassett et al. (1997), “Energy cost of stair climbing and descending
on the college alumnus questionnaire,” Medicine & Science in Sports &
Exercise.** DOI not verified; PMID 9309638. Twenty adults; continuous escalator
at 70 steps/min; Douglas-bag VO2 minutes 5–7. Ascent 8.6 gross MET, descent 2.9.
Single speed and short steady measurement; no substrate partition.
**PubMed abstract verified.**

**E-G03 — Halsey et al. (2012), “The energy expenditure of stair climbing one
step and two steps at a time,” PLOS ONE.** DOI 10.1371/journal.pone.0051213; PMID 23251455.
Fourteen adults; individual treadmill HR–VO2 calibration; 14.05-m stairway.
Estimated 8.5±0.1 versus 9.2±0.1 kcal/min for one- versus two-step ascent.
HR-calibrated estimate, not direct glycogen measure. **PubMed abstract
verified.**

**E-G04 — Olson et al. (1991), “The cardiovascular and metabolic effects of
bench stepping exercise in females,” Medicine & Science in Sports & Exercise.**
DOI not verified; PMID 1766349. Crossover 20-minute bench stepping in healthy
women; VO2 rose with bench height (28.4 to 37.3 mL/kg/min). HR and RER were
measured, but abstract gives no usable carbohydrate fraction. Bench stepping is
related but not identical to a stepper. **PubMed abstract verified.**

**E-G05 — Romijn et al. (1993), “Regulation of endogenous fat and carbohydrate
metabolism in relation to exercise intensity and duration,” American Journal of
Physiology–Endocrinology and Metabolism.** DOI
10.1152/ajpendo.1993.265.3.e380; PMID 8214047. Stable-isotope/indirect
calorimetry study; five trained adults cycling at 25%, 65%, 85% VO2max. Plasma
glucose uptake and muscle-glycogen oxidation increased with intensity; during
two hours at 65%, plasma substrate contribution rose while muscle-glycogen
oxidation declined. Very small cycling study; qualitative transfer only.
**PubMed/Europe PMC abstract verified.**

**E-G06 — Brooks (1997), “Importance of the ‘crossover’ concept in exercise
metabolism,” Clinical and Experimental Pharmacology and Physiology.** DOI
10.1111/j.1440-1681.1997.tb02712.x; PMID 9363377. Physiological review/model: increasing relative
power shifts fuel toward glucose/glycogen; training, diet, and prior exercise
modify crossover. General aerobic evidence, not stepper validation.
**PubMed abstract verified.** The distinct Brooks & Mercier (1994) crossover
paper is PMID 7928844, DOI 10.1152/jappl.1994.76.6.2253; it is not the source
represented by E-G06.

**E-G07 — Coyle et al. (1986), “Muscle glycogen utilization during prolonged
strenuous exercise when fed carbohydrate,” Journal of Applied Physiology.** DOI
not verified; PMID 3525502. Crossover study; seven endurance-trained cyclists at
71±1% VO2max. Glycogen-use rate declined across hours and carbohydrate feeding
extended performance using blood-borne carbohydrate. Cycling and prolonged
duration; indirect for typical stepper sessions. **PubMed abstract verified.**

**E-G08 — Pascoe et al. (1990), “Effects of exercise mode on muscle glycogen
restorage during repeated days of exercise,” Medicine & Science in Sports &
Exercise.** DOI 10.1249/00005768-199010000-00009; PMID 2233197. Seven men crossed over three days of
running/cycling, 60 minutes at 75% VO2max; mode-specific muscles/biopsies showed
different depletion/restorage. Supports mode non-equivalence. **PubMed abstract
verified.**

### Topic G search log

- Sources: PubMed and journal discovery; 2026-09-17.
- Queries: “stair climbing muscle glycogen carbohydrate oxidation”; “stepper
  RER substrate utilization”; “exercise intensity glycogen oxidation stable
  isotope”; “cycling running mode glycogen.”
- Included: direct stair/bench-step VO2 studies and closest mechanistic aerobic
  substrate studies.
- Excluded: MET tables without primary validation as glycogen evidence,
  uncalibrated wearable kcal, and cycling/running numbers presented as direct
  stepper values.

## H. Glycogen repletion

### Conclusions

1. **Carbohydrate intake accelerates post-exercise muscle glycogen resynthesis
   — HIGH confidence.** A 29-trial systematic review/meta-analysis found
   carbohydrate (~1.02±0.4 g/kg body mass/hour) increased short-term local
   resynthesis by 23.5 mmol/kg dry mass/hour versus noncaloric control
   (E-H01). This contrast is not the total synthesis rate and cannot be converted
   directly into whole-body kg/day.
2. **Depletion drives repletion — HIGH physiological confidence.** Glycogen
   depletion activates an early rapid phase; the response slows as stores fill
   (E-H02). Any model must be capacity-bounded and depletion-dependent, not a
   fixed carbohydrate-to-glycogen conversion.
3. **Timing matters most with short recovery — HIGH confidence.** Immediate
   carbohydrate produced faster first-two-hour storage than a two-hour delay in
   cyclists (E-H03). Over a full day, total carbohydrate is more important than
   meal frequency (E-H02, E-H04). A daily simulator should not require
   minute-level timing unless multiple same-day workouts are modeled.
4. **24-hour restoration — MODERATE confidence under high-carbohydrate,
   endurance-depletion conditions.** In eight male endurance athletes depleted
   to ~30% of baseline, 7 and 10 g/kg/day restored thigh glycogen to baseline by
   24 hours, whereas 5 g/kg/day reached 81.7±21.8% (E-H05). This is a single
   small crossover trial after unusually deep depletion and is not a universal
   daily threshold.
5. **Protein co-ingestion — HIGH confidence for no independent benefit when
   carbohydrate/energy are matched and adequate.** E-H01 found no added rate
   from protein; a second meta-analysis found benefit only when protein added
   energy rather than replacing carbohydrate (E-H06). Protein should not be
   double-counted in glycogen repletion.
6. **Resistance-specific rate — LOW confidence.** The older review reports
   resistance-exercise rates spanning 1.3–11.1 mmol/kg/hour (E-H07), reflecting
   heterogeneous protocols and methods. Newer repletion syntheses mostly follow
   endurance depletion. A separate strength-specific whole-body rate is not
   justified.
7. **Capacity/training effects:** training can increase storage capacity and
   high-carbohydrate recovery can supercompensate, but no personal capacity
   equation is established from available inputs (E-H02). Capacity is handled
   in Topic I.
8. **Daily-resolution decision:** implement depletion-dependent,
   carbohydrate-responsive, capacity-bounded direction. Defer exact kg/day
   kinetics and intra-day timing. Missing carbohydrate is unknown, not zero.

### BodyCast interpretation

At daily resolution, carbohydrate intake should govern the opportunity to refill
the depleted glycogen state, with faster filling when farther below capacity and
slowing near capacity. Intake must not add glycogen above capacity or without
available storage space. The evidence supports ordering and 24-hour recovery
scenarios, but local concentration data do not support an exact aggregate-kg
coefficient.

### Topic H evidence ledger

**E-H01 — Craven et al. (2021), “The Effect of Consuming Carbohydrate With and
Without Protein on the Rate of Muscle Glycogen Re-synthesis During Short-Term
Post-exercise Recovery,” Sports Medicine Open.** DOI
10.1186/s40798-020-00297-0; PMID 33507402. Systematic review/meta-analysis; 29
trials from 21 publications, n=246, biopsy measures ≤8 hours after varied
exercise. Carbohydrate versus nonnutrition (10 trials, n=86; mean
1.02±0.4 g/kg/h) increased rate difference 23.5 mmol/kg dry mass/h (95% CI
19.0–27.9; I²=66.8%). CHO+protein versus CHO alone: 0.4 (−2.7 to 3.4),
p=0.805. Mostly trained men and local muscle. **Full text inspected.**

**E-H02 — Burke et al. (2017), “Postexercise muscle glycogen resynthesis in
humans,” Journal of Applied Physiology.** DOI not verified; PMID 27789774.
Authoritative review of biphasic recovery. Early 0–4-hour resynthesis is driven
by depletion and carbohydrate availability; during 4–24 hours total intake
dominates type/form/pattern. Supports nonlinear state dependence, not a single
rate. **PubMed abstract verified.**

**E-H03 — Ivy et al. (1988), “Muscle glycogen synthesis after exercise: effect
of time of carbohydrate ingestion,” Journal of Applied Physiology.** DOI
10.1152/jappl.1988.64.4.1480; PMID 3132449. Crossover; 12 male cyclists; 70
minutes at 68% VO2max plus six intervals; 2 g/kg carbohydrate immediately or
after two hours. First-two-hour storage 7.7 versus 2.5 µmol/g wet muscle/hour;
later 4.3 versus 4.1. Local, acute, large bolus; timing effect is most relevant
to short recovery. **PubMed abstract verified.**

**E-H04 — Burke et al. (1996), “Muscle glycogen storage after prolonged
exercise: effect of the frequency of carbohydrate feedings,” American Journal
of Clinical Nutrition.** DOI not verified; PMID 8669406. Crossover; eight
trained triathletes; 24 hours and 10 g/kg carbohydrate split into four meals or
hourly snacks. No significant 24-hour storage difference; high within-biopsy
variability. **Full page inspected.**

**E-H05 — Namma-Motonaga et al. (2022), “Effect of Different Carbohydrate Intakes
within 24 Hours after Glycogen Depletion…,” Nutrients.** DOI
10.3390/nu14071320; PMID 35405933. Randomized crossover; eight male Japanese endurance athletes; 5, 7,
or 10 g/kg/day carbohydrate after prolonged high-intensity depletion; serial
13C-MRS. At 24 hours: 81.7±21.8%, 97.1±16.1%, and 100.1±12.9% of pre-exercise.
Small, male, endurance-specific. **PubMed/full page verified.**

**E-H06 — Margolis et al. (2021), “Coingestion of Carbohydrate and Protein on
Muscle Glycogen Synthesis after Exercise,” Medicine & Science in Sports &
Exercise.** DOI not verified; PMID 32826640; PMCID PMC7803445. Meta-analysis,
20 crossover studies. No overall CHO+protein effect (Hedges g 0.13, 95% CI
−0.04 to 0.29); benefit when protein added energy, none when energy matched.
**Full text available; abstract verified.**

**E-H07 — Pascoe & Gladden (1996), “Muscle glycogen resynthesis after short
term, high intensity exercise and resistance exercise,” Sports Medicine.** DOI
10.2165/00007256-199621020-00003; PMID 8775516. Physiological review reporting
resistance-exercise resynthesis rates 1.3–11.1 mmol/kg/hour and possible
interference from eccentric damage. Old heterogeneous evidence; units/basis and
protocols vary. **Abstract-only.**

### Topic H search log

- Sources: PubMed/PMC and full open-access meta-analysis; 2026-09-17.
- Queries: “muscle glycogen resynthesis carbohydrate meta-analysis”; “24 hour
  glycogen recovery carbohydrate”; “Ivy timing glycogen synthesis”;
  “resistance exercise glycogen resynthesis.”
- Included: quantitative short-recovery synthesis, 24-hour crossover trials,
  seminal timing study, and authoritative physiology review.
- Excluded: performance-only carbohydrate guidance as a synthesis coefficient,
  liver-only glycogen, and protein effects confounded by added energy.

## I. Glycogen-associated water and capacity

### Conclusions

1. **Glycogen storage co-varies with body/muscle water — HIGH confidence.**
   The original human depletion/loading study observed 2.2 L total-body-water
   increase while estimating at least 500 g glycogen storage, yielding an
   estimated 3–4 g water per gram glycogen (E-I01). MRI and compartment studies
   support increased muscle/intracellular water with loading (E-I02, E-I03).
2. **The ratio is not a fixed molecular constant — HIGH confidence.** E-I01
   inferred glycogen amount and assumed the water change was caused by muscle/
   liver storage; it did not directly measure water bound to glycogen. In a
   same-biopsy recovery study, the coordinated ratio was ~3:1 with restricted
   rehydration and ~17:1 with full rehydration because additional water was
   retained (E-I04). A 2023 review concludes human water rises approximately
   3–4-fold with glycogen but emphasizes direct bound water was not measured and
   other solutes/fluid flow confound it (E-I05).
3. **Approximate co-variation — MODERATE confidence; hard bounds and individual
   transfer — LOW / INSUFFICIENT.** A typical contextual prior is approximately
   **3–4 kg water per kg glycogen**, but it is neither a molecular constant nor a
   validated personal clamp. Some reviews cite 2.7–4. BodyCast may expose this
   as uncertain contextual metadata, not a pass/fail boundary. Water beyond the
   selected associated component must not automatically be classified as
   glycogen water.
4. **Compartment location — MODERATE confidence.** Carbohydrate loading
   increases predominantly intracellular/segmental water in small studies
   (E-I03), whereas the original study measured only total body water. Glycogen
   water must not be counted again as extracellular-fluid deviation.
5. **Glycogen changes can distort muscle/lean measurements — HIGH confidence.**
   Loading increased vastus muscle CSA 3.5% in five volunteers (E-I02) without
   evidence of contractile hypertrophy. DXA, ultrasound/MRI size, BIA water, and
   body weight around loading/depletion cannot be mapped directly to muscle
   tissue.
6. **Whole-body glycogen capacity — MODERATE for broad population range, LOW
   for personalization.** A physiological review gives average muscle glycogen
   ~500 g (normal range 300–700 g) and liver ~80 g (0–160 g), with whole-body
   ~600 g and strong dependence on body size, diet, fitness, and recent
   exercise (E-I06). These are descriptive ranges, not capacity equations.
7. **Muscle versus liver:** associated-water evidence and exercise depletion
   mostly concern muscle; whole-body weight includes both stores. Current
   aggregate glycogen can be bounded broadly, but muscle-specific workout use
   and liver homeostasis cannot be separately validated without compartments.
8. **Generalization:** direct water-ratio studies are small, old, and often
   male/athletic or clinical. The 3–4 interval should retain uncertainty across
   sex, adiposity, training, sodium, creatine, and hydration.

### BodyCast interpretation

Represent glycogen-associated water as an uncertain accounting companion to
glycogen, avoiding an exact central value or hard scientific bound. The typical
3–4 kg/kg relation and aggregate 0.3–0.86 kg adult glycogen range are contextual
metadata only: neither may be used as a RED-test pass/fail threshold, clamp,
personal capacity, or default.

### Topic I evidence ledger

**E-I01 — Olsson & Saltin (1970), “Variation in Total Body Water with Muscle
Glycogen Changes in Man,” Acta Physiologica Scandinavica.** DOI
10.1111/j.1748-1716.1970.tb04764.x; PMID 5475323. Intervention; 19 subjects;
heavy arm/leg depletion, three days protein/fat diet then four days high
carbohydrate. Biopsy glycogen rose from 4.5 to 19.9 g/kg wet thigh and 2.6 to
16.9 g/kg arm; weight +2.4 kg; tritium-dilution total body water +2.2 L;
estimated ≥500 g glycogen, implying 3–4 g water/g. Sex/age not in extracted
abstract. Water location and glycogen total were inferred. **Publisher/PubMed
abstract verified.**

**E-I02 — Nygren et al. (2001), “Effect of glycogen loading on skeletal muscle
cross-sectional area and T2 relaxation time,” Acta Physiologica Scandinavica.**
DOI 10.1046/j.1365-201x.2001.00913.x; PMID 11903130. Five healthy
volunteers; four-day low then four-day very-high carbohydrate. Glycogen rose
281→634 mmol/kg dry weight; vastus CSA increased 3.5% and thigh circumference
2.5%; MRI signal supported tighter intracellular water. Extremely small and
acute; demonstrates measurement confounding, not hypertrophy. **Publisher
abstract verified.**

**E-I03 — Shiose et al. (2016), “Segmental extracellular and intracellular
water distribution and muscle glycogen after 72-h carbohydrate loading,”
Journal of Applied Physiology.** DOI not verified; PMID 27231310. Eight
subjects; 12 g carbohydrate/kg/day for 72 hours; 13C-MRS and bioimpedance
spectroscopy. Reported increased body water predominantly intracellular/
segmental alongside glycogen. Small and loading-specific; BIS is an indirect
water method. **PubMed/full page verified.**

**E-I04 — Fernández-Elías et al. (2015), “Relationship between muscle water and
glycogen recovery after prolonged exercise in the heat in humans,” European
Journal of Applied Physiology.** DOI 10.1007/s00421-015-3175-z; PMID 25911631.
Acute crossover recovery; human vastus-lateralis same-piece glycogen/water
measurement after dehydrating cycling. Coordinated ratio ~3 g water/g glycogen
with restricted fluid, ~17 with full rehydration. Authors explicitly did not
measure molecularly bound water. **Full page verified.**

**E-I05 — Shiose et al. (2023), “Muscle Glycogen Assessment and Relationship
with Body Hydration Status,” Nutrients.** DOI 10.3390/nu15010155; PMID
36615811. Narrative physiological/methodological review. Concludes human body
water increases approximately 3–4-fold with glycogen but relationship is
inconclusive as a fixed bound-water ratio; hydration and other solutes
contribute. **Full text inspected.**

**E-I06 — Murray & Rosenbloom (2018), “Fundamentals of glycogen metabolism for
coaches and athletes,” Nutrition Reviews.** DOI not verified; PMID 29444266.
Narrative physiological review. Descriptive whole-body ~600 g; muscle average
500 g, range 300–700; liver average 80 g, range 0–160. Values depend on body
mass, diet, fitness, and recent activity. Secondary-source capacity values, not
personalized measurements. **Full text/page inspected.**

**E-I07 — Chan et al. (1982), “Early weight gain and glycogen-obligated water
during nutritional rehabilitation,” Human Nutrition: Clinical Nutrition.** DOI
not verified; PMID 6811511. Small starvation/refeeding experiment/patient
observations; calculated 3.21±0.57 g water/g glycogen. Clinical starvation and
indirect calculation limit healthy-exercise transfer. **PubMed abstract
verified.**

### Topic I search log

- Sources: PubMed, publisher pages, PMC review; 2026-09-17.
- Queries: exact Olsson/Saltin title; “glycogen associated water grams per gram
  humans”; “muscle water glycogen recovery”; “whole-body glycogen capacity.”
- Included: original human estimate, same-biopsy recovery, loading imaging/
  compartment studies, and physiological review.
- Excluded: unsourced fitness folklore, animal-only ratios as human constants,
  and water changes attributed wholly to glycogen without hydration caveats.

## J. Post-resistance-exercise edema, inflammation, and transient water

### Conclusions

1. **Acute muscle size after exercise is not hypertrophy — HIGH confidence.**
   MRI/ultrasound studies directly show increased muscle water, CSA, thickness,
   or T2 after a single session (E-J01–E-J05). BodyCast must assign this to a
   transient water/damage process, never skeletal-muscle tissue.
2. **Different time courses are observed — HIGH confidence.** Metabolic “pump”/
   fluid shifts can be immediate and often resolve within ~24 hours after
   concentric or accustomed work (E-J02, E-J06). Damage-related edema after
   unaccustomed eccentric loading can emerge later, peak over days, and persist
   substantially longer (E-J03, E-J05, E-J07). This rejects a single universal
   exponential, but ordinary workout records do not establish response class or
   require a two-component production model.
3. **Routine trained sessions may cause little sustained edema — MODERATE
   confidence.** In 13 trained men with ~5 years' experience, 7, 14, or 21
   lower-body sets showed no sustained ultrasound edema and returned to baseline
   within 24 hours (E-J06). This conflicts with untrained/unaccustomed studies
   showing 48–96 hours or longer (E-J01, E-J02, E-J04), consistent with novelty
   and protocol differences.
4. **Eccentric/unaccustomed loading prolongs response — HIGH direction,
   LOW quantitative magnitude.** Matched eccentric contractions produced
   delayed T2 elevation for one to five days while concentric T2 normalized by
   one day (E-J03). Extreme maximal eccentric protocols can peak around days
   3–7 and remain abnormal for weeks (E-J05, E-J07), but those protocols should
   not define ordinary workout behavior.
5. **Repeated-bout effect — HIGH confidence for local damage attenuation,
   MODERATE/LOW for BodyCast water transfer.** A
   20-study meta-analysis found lower soreness/CK and less performance loss
   after a repeated multi-joint bout (E-J08); MRI work found lower/earlier T2
   and swelling after a second eccentric bout (E-J05). This supports lower
   average transient-water expectation with recent exposure, but not a
   deterministic ordering or exact multiplier.
6. **Exercise selection and muscle region matter.** Multi-joint leg press
   produced longer rectus-femoris edema than knee extension in one study, while
   other quadriceps sites recovered differently (E-J04). Local edema cannot be
   converted to whole-body water without involved-muscle volume and hydration
   data.
7. **Whole-body weight amplitude — INSUFFICIENT.** Studies report local
   thickness/CSA/T2/water, not total transient kilograms. There is no defensible
   set-to-water coefficient, peak kg, or universal half-life.
8. **Safe daily behavior:** novelty/eccentric exposure and training status can
   remain contextual predictors of probability/duration, not deterministic
   modifiers. An isolated transient component is finite and trends toward
   baseline absent new causes; exact zero time, amplitude, class, and kernel
   remain deferred.

### BodyCast interpretation

Track transient post-resistance water separately from glycogen water and
skeletal muscle. A future implementation should distinguish immediate fluid
shift from delayed damage edema and include an accustomed/novel state. For v7's
scientific contract, only classification, ordering, and broad time windows are
approved; kilogram amplitudes and decay constants are not.

### Topic J evidence ledger

**E-J01 — Kristiansen et al. (2014), “Concomitant changes in cross-sectional area and
water content in skeletal muscle after resistance exercise,” Scandinavian
Journal of Medicine & Science in Sports.** DOI 10.1111/sms.12160; PMID 24330190.
Within-person acute study; 10 healthy untrained men; one strenuous bout in one
leg and three bouts in the other. MRI at baseline, 4 and 52 hours. Local
quadriceps CSA +13–16% and water +6–8% at both follow-ups; no difference between
one/three-bout legs. Small, unusual protocol; direct local water evidence, not
body mass. **PubMed abstract verified.**

**E-J02 — Radaelli et al. (2012), “Time course of strength and echo intensity
recovery after resistance exercise in women,” Journal of Strength and
Conditioning Research.** DOI 10.1519/JSC.0b013e31823dae96; PMID 22037095. Ten untrained women;
4×10 unilateral elbow flexion at 80% 1RM. Thickness remained elevated through
72 hours; echo intensity rose at 24–72 hours; control arm unchanged. Local
ultrasound and small sample. **PubMed abstract verified.**

**E-J03 — Ochi et al. (2017), “Differences in post-exercise T2 relaxation time
changes between eccentric and concentric contractions of the elbow flexors,”
European Journal of Applied Physiology.** DOI 10.1007/s00421-016-3462-3; PMID 27632383.
Within-person 12 young men; 5×6 maximal eccentric versus concentric contractions;
MRI immediately and days 1, 3, 5. Concentric T2 rose immediately then returned
by one day; eccentric T2 rose 9–29% across days 1–5. Extreme isokinetic work;
T2 is an edema/metabolic proxy. **PubMed abstract verified.**

**E-J04 — Dourado et al. (2023), “Different time course recovery of muscle
edema within the quadriceps femoris…,” Biology of Sport.** DOI
10.5114/biolsport.2023.119984; PMID 37398959; PMCID available. Within-person 14
untrained young men; unilateral knee extension and leg press; ultrasound
through 96 hours. Site/exercise-specific recovery: 24–48 hours for several
sites, rectus femoris after leg press 96 hours. Local thickness proxy.
**PubMed abstract verified.**

**E-J05 — Foley et al. (1999/2000), “MR measurements of muscle damage and
adaptation after eccentric exercise,” Journal of Applied Physiology.** DOI not
verified; PMID 10601183. Six young men; 5×10 eccentric biceps curls at 110% of
concentric 1RM, repeated after eight weeks; serial MRI to 56 days. T2 peaked day
7 after first bout and earlier/lower after second; swelling >40% locally and
regional volume normalized within two weeks. Extreme, tiny sample; demonstrates
long tail and repeated-bout attenuation, not normal-session magnitude.
**PubMed abstract verified.**

**E-J06 — Alvarez et al. (2026), “Don’t Sweat the Swelling: Exercise Volume’s
Transient Effects in Trained Men,” International Journal of Sports Medicine.**
DOI 10.1055/a-2791-5145; PMID 41565215. Counterbalanced acute study; 13 trained
men (5.1±1.3 years); 7, 14, or 21 lower-body sets; ultrasound thickness/echo
intensity and performance through 72 hours. No sustained condition effects;
measures returned to baseline within 24 hours despite perceptual differences.
Directly applicable to accustomed trained sessions but small/male.
**Abstract-only.**

**E-J07 — Stožer, Vodopivc & Križančić Bombek (2020), “Pathophysiology of exercise-induced muscle
damage and its structural, functional, metabolic, and clinical consequences,”
Physiological Research.** DOI 10.33549/physiolres.934371; PMID 32672048. Review.
Describes edema beginning early and delayed damage swelling often peaking days
4–10 after eccentric exercise; imaging size alone cannot distinguish edema from
hypertrophy. Broad protocols include severe damage. **Full PubMed page
inspected.**

**E-J08 — Doma et al. (2023), “The Repeated Bout Effect of Multiarticular
Exercises on Muscle Damage Markers and Physical Performances,” Journal of
Strength and Conditioning Research.** DOI not verified; PMID 38015738.
Systematic review/meta-analysis; 20 studies; healthy adults; 24–48-hour outcomes
after first/second damaging bouts. Soreness/CK lower after second bout
(SMD 0.51–1.23 for first-vs-second differences), with smaller performance loss.
Mostly indirect damage markers, not total water. **PubMed abstract verified.**

### Topic J search log

- Sources: PubMed and prior-agent record; 2026-09-17.
- Queries: “resistance exercise muscle edema swelling time course MRI”;
  “eccentric concentric T2 edema”; “repeated bout effect meta-analysis”;
  “trained men exercise volume swelling.”
- Included: direct MRI/ultrasound water/time-course studies, trained-volume
  study, repeated-bout synthesis, physiological review.
- Excluded: DOMS/CK alone as quantitative water, extreme rhabdomyolysis as
  routine behavior, and immediate pump as muscle tissue.

## K. Stepper energy expenditure and heart rate

### Conclusions

1. **Criterion hierarchy is not “measured kcal” versus estimates.** Consumer
   active kcal is itself a proprietary estimate. A 2026 living systematic
   review found Apple Watch HR mean bias small but energy-expenditure error
   inconsistent and frequently large; all included MAPE studies had ≥20% error
   in at least one condition (E-K01). A 158-publication review found no
   commercial brand accurate for EE (E-K02). Device kcal can be the most
   information-rich available estimate, but must carry substantial uncertainty.
2. **HR predicts aerobic EE at group level; valid personal calibration can add
   information — MODERATE confidence.** Individual HR–VO2 calibration produced group-average
   agreement but individual errors up to +20%/−15% in calorimeter work
   (E-K03). Population equations using HR, sex, age, mass, and VO2max explained
   more variance than versions lacking fitness (E-K04). Inter-individual and
   day-to-day variability remain (E-K05).
3. **Stepper is suitable for HR-assisted aerobic estimation — MODERATE
   confidence.** Stair ascent elicits sustained aerobic VO2/HR and approximately
   8.6–9.6 gross MET in specific protocols (E-G01, E-G02). An
   individually treadmill-calibrated HR method estimated stair energy in 14
   adults (E-G03). Without individual calibration, HR is an intensity
   aid, not a criterion kcal measure.
4. **Sparse ~2-minute HR is insufficiently validated.** HR and VO2 lag
   time-varying workload (E-K09). Sparse samples can approximate a steady
   stepper session's time-weighted intensity if coverage is broad, but can miss
   transitions, pauses, and intervals. No evidence was found supporting a
   specific sampling interval or converting average/max HR alone to accurate
   kcal. Max HR is especially inadequate because duration at that intensity is
   unknown.
5. **HR reserve is preferable to raw bpm for intensity ordering — MODERATE
   physiological confidence.** Age, resting HR, fitness, medication, heat,
   hydration, and drift alter the HR–energy relation. HR reserve/personal
   observed max can normalize intensity, but age-predicted max introduces error;
   no exact v7 calorie equation is approved.
6. **MET fallback — MODERATE for broad plausibility, LOW for individual
   accuracy.** Direct stair protocols support vigorous gross intensity, but
   machine resistance, cadence, handrail support, step height, and ascent-only
   mechanics vary. 8.6 or 9.6 MET must not be a universal stepper constant.
7. **Active versus gross energy must be explicit.** Stair validation papers
   generally report gross EE/MET. Wearable “active kcal” generally excludes
   resting energy. Combining both without conversion double-counts baseline
   expenditure.
8. **Evaluated hierarchy:**  
   **(a)** use device workout active kcal when provenance/unit semantics are
   known, with low-confidence uncertainty and plausibility checks;  
   **(b)** otherwise use HR-assisted *intensity selection* for a duration×mass
   aerobic estimate when HR coverage is adequate;  
   **(c)** use a broad modality MET fallback when HR is absent/poor.  
   Evidence does not prove (a) is more accurate for every device/user, nor
   justify an exact confidence blend between estimates.

### BodyCast interpretation

The proposed hierarchy may be preserved only as
`ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER`, not as a universal accuracy
ranking or a claim that wearable active kcal is a direct measurement. HR samples may refine
relative intensity/quality for steady-state stepper work; they should not be
used to fit an exact personal calorie curve without calibration. Every path
must return active/net energy consistently and expose provenance/uncertainty.

### Topic K evidence ledger

**E-K01 — Lambe et al. (2026), “The accuracy of Apple Watch measurements: a
living systematic review and meta-analysis,” npj Digital Medicine.** DOI
10.1038/s41746-025-02238-1; PMID 41513748. Living systematic review; searches through
2025-09-24; 82 studies, 14 metrics, 430,052 pooled participants. HR pooled mean
bias −0.27 bpm with limits −7.19 to 6.64; EE error inconsistent/frequently
large, MAPE 9.71–151.66% across conditions and ≥20% in at least one condition
for all six MAPE studies. Device generations/activities heterogeneous.
**PubMed/full page verified.**

**E-K02 — Fuller et al. (2020), “Reliability and Validity of Commercially
Available Wearable Devices for Measuring Steps, Energy Expenditure, and Heart
Rate,” JMIR mHealth and uHealth.** DOI 10.2196/18694; PMID 32897239. Systematic
review; 158 publications, nine brands, through May 2019. Laboratory steps/HR
often acceptable depending on brand; no brand accurate for EE. Rapid device
turnover and proprietary algorithms limit current transfer. **PubMed abstract
verified.**

**E-K03 — Spurr et al. (1988), “Energy expenditure from
minute-by-minute heart-rate recording: comparison with indirect calorimetry,”
American Journal of Clinical Nutrition.** DOI 10.1093/ajcn/48.3.552; PMID
3414570.
Comparative study; 22 individually calibrated adults (16 men, six women),
22-hour whole-body calorimeter with cycling bouts. Group means did not differ;
individual TDEE errors reached +20%/−15%. Individual calibration and
minute-level data limit transfer to sparse uncalibrated sampling.
**PubMed abstract verified.**

**E-K04 — Keytel et al. (2005), “Prediction of energy expenditure from heart
rate monitoring during submaximal exercise,” Journal of Sports Sciences.** DOI
not verified; PMID 15966347. Validation/model study; 115 exercising adults,
18–45 years, treadmill/cycle steady states at 35%, 62%, 80% VO2max. HR, sex,
mass, age, VO2max model r=0.913; without VO2max r=0.857. Group model, not
individual stepper validation. **PubMed abstract verified.**

**E-K05 — McCrory et al. (1997), “Between-day and within-day variability in the
relation between heart rate and oxygen consumption…,” American Journal of
Clinical Nutrition.** DOI not verified; PMID 9209164. Twelve healthy adults,
four individual calibration sessions. Group EE CV 1.1%, but individual CV
0.1–24.7%; cautions against individual HR EE inference. **PubMed abstract
verified.**

**E-K09 — Slade et al. (2021), “Sensing leg movement enhances wearable
monitoring of energy expenditure,” Nature Communications.** DOI not verified;
PMID 34257310. Experimental validation across time-varying activities; notes HR
and respirometry lag workload transitions and reports large out-of-sample
wearable errors. Sensor/model study, not a 2-minute-sampling trial.
**PubMed/full page verified.**

### Topic K search log

- Sources: PubMed and systematic-review full pages; 2026-09-17.
- Queries: “wearable energy expenditure validity systematic review”; “Apple
  Watch active calories accuracy”; “heart rate energy expenditure individual
  calibration”; “sparse HR sampling energy expenditure”; direct stair studies.
- Included: systematic reviews, calorimeter validation, HR calibration models,
  and direct stair VO2 studies.
- Excluded: manufacturer claims, unvalidated calorie formulas, HR accuracy used
  as proof of EE accuracy, and single MET values treated as universal.

## L. Heart rate during resistance training

### Conclusions

1. **HR is not a validated anabolic-dose measure — HIGH confidence.** The
   resistance-training umbrella review identified volume, load, frequency,
   muscle action, and related prescription variables as the studied modifiers
   of muscle outcomes; HR was not an established hypertrophy predictor
   (E-A03). No longitudinal evidence was found mapping workout HR or HR zones to
   skeletal-muscle gain independently of sets/recruitment/effort.
2. **HR measures systemic cardiovascular/autonomic demand, not local mechanical
   stimulus.** Acute autonomic response changes with sets, volume, load, and
   rest interval (E-L02). Thus HR is a downstream composite of work density,
   involved muscle mass, breathing/pressor response, recovery, environment, and
   individual physiology. It cannot identify which muscles received tension.
3. **Non-identifiability is directly demonstrated — MODERATE confidence.**
   Protocol organization changes HR/cardovascular response even when total work
   or work:rest structure is matched (E-L03, E-L04). Conversely, low- and
   high-load training can produce similar hypertrophy under appropriate effort
   despite different acute demands (Topic A). Equal HR need not imply equal
   stimulus, and equal effective set stimulus need not imply equal HR.
4. **HRV-guided recovery has not improved hypertrophy in small RCTs.** Seven
   weeks of pre-session RMSSD-guided versus fixed scheduling produced virtually
   identical local CSA gain in 20 young men (E-L05); a similar trial in 21 older
   women found no between-group muscle-size advantage (E-L06). HRV is distinct
   from exercise HR, but these trials do not support autonomic status as a
   hypertrophy multiplier.
5. **Wrist HR is less valid during resistance work.** A 44-study meta-analysis
   found pooled wrist-PPG bias −7.26 bpm during resistance training and bias
   worsening as HR increased (E-L07). Device/exercise validation found accuracy
   varied substantially by movement (E-L08). Sparse ~2-minute samples add
   temporal uncertainty.
6. **Appropriate role in BodyCast:** HR may support workout detection, aerobic
   energy expenditure, data-quality checks, and cardiovascular-effort display.
   It must not replace effective sets/program structure as anabolic dose or
   independently add hypertrophy. No HR-zone, average-HR, peak-HR, or HRV
   hypertrophy coefficient is justified.

### Applicability and conflict resolution

The physiological conclusion applies broadly, but most acute studies are small
and often male. HRV RCTs include young men and older women but measure local
ultrasound CSA, not total skeletal-muscle kg. The evidence does not establish
that HR has *zero* association with workout difficulty; it establishes that the
association is nonspecific and not validated as an independent causal dose.

### Topic L evidence ledger

**E-L02 — Marasingha-Arachchige et al. (2020), “Factors that affect heart rate
variability following acute resistance exercise: A systematic review and
meta-analysis,” Journal of Sport and Health Science.** DOI not verified; PMID
33246163. Twenty-six studies,
healthy participants approximately 15–48 years. Acute resistance exercise
reduced parasympathetic indices; volume, sets, intensity, and rest modified
HRV. HRV/autonomic recovery is not exercise HR or hypertrophy. **PubMed
abstract verified.**

**E-L03 — Kraft et al. (2015), “Work distribution influences session ratings
of perceived exertion response during resistance exercise matched for total
volume,” Journal of Strength and Conditioning Research.** DOI 10.1519/JSC.0000000000000342;
PMID 24378665. Acute crossover; sample metadata not fully recovered from
abstract. Higher-load/lower-repetition versus lower-load/higher-repetition
multi-exercise sessions matched for total work volume/rate; post-set HR
139±14 versus 131±12 bpm. Acute cardiovascular response only.
**PubMed abstract verified.**

**E-L04 — Paulo et al. (2020), “Blood Pressure Increase in Hypertensive
Individuals During Resistance Training Protocols With Equated Work to Rest
Ratio,” Frontiers in Physiology.** DOI 10.3389/fphys.2020.00481; PMID 32714194. Crossover; 12 medicated hypertensive
adults, 48±8 years; 3×15 versus 9×5 at 50% 1RM with equated work:rest ratio.
Peak leg-extension HR increase +45±17 versus +30±8 bpm. Clinical acute
cardiovascular outcome; not healthy hypertrophy evidence. **PubMed abstract
verified.**

**E-L05 — de Oliveira et al. (2019), “Effect of individualized resistance
training prescription with heart rate variability on individual muscle
hypertrophy and strength responses.”** Journal/DOI not verified; PMID 30702985.
Randomized trial; 20 young men, 21.9±3.3 years; seven-week fixed 48-hour versus
RMSSD-recovery-guided scheduling. Vastus-lateralis ultrasound CSA increased
15.8% versus 15.7%, with no group difference. Small/local proxy and HRV-guided
scheduling, not intra-workout HR. **PubMed abstract verified.**

**E-L06 — Bittencourt et al. (2024), “Effects of individualized resistance
training prescription with heart rate variability on muscle strength, muscle
size and functional performance in older women,” Frontiers in Physiology.** DOI
10.3389/fphys.2024.1472702; PMID 39742158. Randomized trial; 21 healthy women, 66.0±5.0 years; seven weeks;
RMSSD-guided versus fixed recovery. No group×time muscle-size interaction.
Small/local proxy. **PubMed abstract verified.**

**E-L07 — Zhang et al. (2020), “Validity of Wrist-Worn photoplethysmography
devices to measure heart rate: A systematic review and meta-analysis.”** DOI
not verified; PMID 32552580. Forty-four articles, 738 effect sizes, 15 brands.
Resistance-training mean wrist-HR difference −7.26 bpm (95% CI −10.46 to
−4.07), increasing ~3 bpm per 10-bpm higher HR. Device/protocol heterogeneity.
**PubMed abstract verified.**

**E-L08 — Støve et al. (2023), “Accuracy of the Apple Watch Series 6 and
the Whoop Band 3.0 for assessing heart rate during resistance exercises.”**
DOI 10.1080/02640414.2023.2180160; PMID 36803578. Cross-sectional validation; 29 adults (16
women), 19–37 years; five resistance exercises versus Polar H10. Apple agreement
high for squat/deadlift/row but moderate-to-low for curl-to-press/burpees;
Whoop also exercise-dependent. HR validity, not anabolic validity. **PubMed
abstract verified.**

### Topic L search log

- Sources: PubMed systematic reviews, umbrella review, RCTs, and acute
  validation studies; 2026-09-17.
- Queries: “resistance exercise heart rate hypertrophy predictor”; “resistance
  exercise HR rest interval load”; “wrist heart rate resistance validation”;
  “HRV-guided resistance hypertrophy.”
- Included: hypertrophy evidence hierarchy, acute determinants of autonomic/HR
  response, HRV-guided longitudinal trials, device validation.
- Excluded: calorie-burn marketing, HR-zone prescriptions without hypertrophy
  outcomes, and HRV readiness correlations as causal muscle evidence.

## M. Sleep duration, body composition, and consumer sleep measurement

### Conclusions

1. **Severe sleep restriction suppresses acute MPS — HIGH confidence for the
   studied extremes, LOW for chronic muscle gain.** Five nights with four hours
   time in bed reduced myofibrillar protein synthesis in young men (E-M01); one
   night of total deprivation reduced postprandial fractional synthesis 18% in
   13 young adults (E-M02). MPS is mechanistic, acute, and must not be converted
   directly to kilograms of chronic hypertrophy.
2. **Sleep restriction may adversely shift diet-related mass loss — LOW
   confidence for production transfer.** In a 10-person crossover trial during identical caloric
   restriction, 5.5 versus 8.5 hours' sleep opportunity reduced DXA fat loss
   (0.6 versus 1.4 kg) and increased fat-free-mass loss (2.4 versus 1.5 kg)
   over 14 days (E-M03). FFM includes water/glycogen and nonmuscle lean tissue;
   these numbers cannot calibrate `skeletalMuscleKg` or establish a production
   partition invariant.
3. **Chronic resistance-training evidence is sparse/conflicting.** A small
   nonrandomized comparison of habitual ~1–2-hour shorter sleepers found gains
   after 16 sessions and no between-sleep-group muscle-mass difference (E-M04).
   This does not negate severe laboratory restriction; it shows that extreme
   acute protocols do not establish a smooth nightly dose-response.
4. **One poor night cannot justify a precise daily muscle multiplier.** The
   evidence does not define personal thresholds, linear slopes, recovery
   carry-over, interaction coefficients with training/protein, or a
   sleep-debt half-life. Sleep duration can support a multi-night risk/quality
   state, but quantitative production effects remain deferred.
5. **Wearable total sleep time is useful only with uncertainty.** Modern
   consumer devices generally detect sleep with high sensitivity but have poor
   wake specificity and device-dependent errors (E-M05, E-K01, E-M07).
   Longitudinal
   duration trends may be informative; nightly values are not PSG-equivalent.
6. **REM/Core/Deep must remain outside physiology formulas — HIGH confidence.**
   Six-device PSG validation found only fair-to-moderate overall stage
   agreement (κ 0.21–0.53), >90% sleep sensitivity but wake specificity
   29.39–52.15% (E-M05). Apple's living review likewise found good sleep/wake
   but moderate-to-poor similar-stage differentiation (E-K01). Proprietary
   definitions/algorithms and updates further undermine stable coefficients.
7. **Safe v7 decision:** retain sleep duration/provenance as contextual data;
   allow warnings/uncertainty and test monotonic guardrails for sustained severe
   restriction, but **DEFER** numerical body-composition or hypertrophy
   modification. **REJECT** stage-specific and single-night exact multipliers.

### Generalization and conflict resolution

MPS studies are small, short, and mainly young/healthy; the five-night study
included only men. The diet trial involved overweight middle-aged adults and
DXA compartments. The resistance study was small, observational by habitual
sleep group, and short. Differences in severity, duration, endpoint, and design
explain the apparent conflict. Evidence supports risk direction at severe
restriction, not a universal nightly function across sex, age, training status,
or normal 6–9-hour variation.

### Topic M evidence ledger

**E-M01 — Saner et al. (2020), “The effect of sleep restriction, with or without
high-intensity interval exercise, on myofibrillar protein synthesis in healthy
young men,” Journal of Physiology.** DOI 10.1113/JP278828; PMID 32078168.
Controlled parallel intervention; 24 healthy recreationally active men, 18–40
years; five nights of eight-hour time in bed, four-hour time in bed, or
four-hour time in bed plus three HIIE sessions; standardized diet with
1.5 g/kg/day protein. Deuterated-water/biopsy MyoPS was lower under restriction
and maintained near control with HIIE. Acute mechanistic endpoint, not
resistance hypertrophy. **Full text inspected.**

**E-M02 — Lamon et al. (2021), “The effect of acute sleep deprivation on
skeletal muscle protein synthesis and the hormonal environment,” Physiological
Reports.** DOI 10.14814/phy2.14660; PMID 33400856. Randomized crossover; 13
healthy men and women, 18–35 years; one normal-sleep versus total-deprivation
night. Stable-isotope/biopsy postprandial FSR was 0.072±0.015 versus
0.059±0.014%/h (−18%, p=.040). Small, single-night mechanistic study; sex
subgroups underpowered. **Full text inspected.**

**E-M03 — Nedeltcheva et al. (2010), “Insufficient Sleep Undermines Dietary
Efforts to Reduce Adiposity,” Annals of Internal Medicine.** DOI
10.7326/0003-4819-153-7-201010050-00006; PMID 20921542. Randomized two-period
crossover; 10 overweight nonsmoking adults (seven men/three women), age 41±5;
14 days moderate caloric restriction with 8.5 versus 5.5 hours' sleep
opportunity. DXA fat loss 1.4 versus 0.6 kg (p=.043); FFM loss 1.5 versus
2.4 kg (p=.002). Tiny/short and FFM is not muscle. **PubMed abstract verified.**

**E-M04 — Borba et al. (2024), “Could a Habitual Sleep Restriction of One-two
Hours Be Detrimental to the Benefits of Resistance Training?” Sleep Science.**
DOI 10.1055/s-0044-1787297; PMID 39268337; PMCID PMC11390164. Controlled
longitudinal comparison; 12 shorter
sleepers (~6:17 total/day), 12 recommended sleepers (~7:47), and 12 nontraining
controls; adults around 38–42 years; 16 resistance sessions. Arm area/
circumference and performance improved in both training groups; no reported
between-group muscle-mass effect. Habitual grouping, short study, proxy
outcomes. **PubMed abstract verified.**

**E-M05 — Schyvens et al. (2025), “A performance validation of six commercial
wrist-worn wearable sleep-tracking devices for sleep stage scoring compared to
polysomnography,” Sleep Advances.** DOI 10.1093/sleepadvances/zpaf021; PMID
40303381; PMCID PMC12038347. Laboratory
validation; 62 participants; Fitbit Charge 5/Sense, Withings Scanwatch, Garmin
Vivosmart 4, Whoop 4.0, Apple Watch Series 8 versus one-night PSG. Sleep
sensitivity >90%, wake specificity 29.39–52.15%, κ 0.21–0.53; many significant
TST/stage differences. Single-night/proprietary algorithms. **Full text
inspected.**

**E-M07 — Schyvens et al. (2024), “Accuracy of Fitbit Charge 4, Garmin Vivosmart
4, and WHOOP Versus Polysomnography: Systematic Review,” JMIR mHealth and
uHealth.** DOI 10.2196/52192; PMID 38557808. Systematic review; eight
PSG/ambulatory-EEG validation studies in
adults. Device and stage accuracy varied; included studies were few and often
small. Does not support interchangeable stage values. **PubMed abstract
verified.**

### Topic M search log

- Sources: PubMed/PMC full text, controlled trials, systematic reviews, PSG
  validation; 2026-09-17.
- Queries: “sleep restriction muscle protein synthesis”; “sleep restriction
  resistance training hypertrophy”; “sleep restriction caloric restriction
  lean mass”; “consumer wearable sleep stage PSG systematic review.”
- Included: isotope/biopsy MPS studies, crossover diet/body-composition trial,
  longitudinal resistance comparison, recent wearable reviews/validation.
- Excluded: observational short-sleep obesity associations as causal
  coefficients, hormone-only studies, sleep coaching claims, and proprietary
  stage scores without PSG validation.

## N. Excess post-exercise oxygen consumption (EPOC)

### Conclusions

1. **EPOC is real, but generally modest relative to exercise energy — HIGH
   confidence for aerobic exercise.** An authoritative review found prolonged
   EPOC after sufficiently intense/long exercise but estimated it at 6–15% of
   exercise's net oxygen cost in qualifying studies (E-N01). This is a
   protocol-level range, not a universal workout coefficient.
2. **Aerobic intensity raises EPOC, but methods and windows matter.** A
   22-study systematic review found baseline-subtracted averages of ~101 kJ
   MICE versus ~136 kJ HIIE in ≤3-hour studies, and ~159 versus ~289 kJ in
   >3-hour studies (E-N02). Heterogeneous durations, baseline subtraction, and
   protocols prevent a stair-specific scalar.
3. **Resistance EPOC is heterogeneous and often small.** Examples range from
   6.2 L extra oxygen over two hours in 10 trained women (roughly 30 kcal;
   E-N03) and 7.4–10.3 L/37–52 kcal over one hour after dense circuit protocols
   in seven men (E-N04), to no detectable RMR elevation at 12–48 hours after
   very high-volume lifting in eight trained men (E-N05).
4. **Long-duration claims conflict with stronger integrated accounting.** Some
   tiny heavy-lifting studies detected elevated VO2 at isolated observations
   through 38 hours (E-N06). Yet a 24-hour whole-room calorimetry crossover in
   10 men found exercise-day expenditure higher almost entirely by measured
   exercise cost, with postexercise-period EE not different from control
   (E-N07). Sampling isolated RMR points, protocol damage, training status, and
   baseline methods explain part of the conflict.
5. **EPOC should not be inferred from HR or workout kcal with a universal
   multiplier.** Resistance intensity/density and aerobic intensity affect it,
   but no validated BodyCast mapping covers normal strength and stepper
   workouts. Applying a percent to wearable active kcal compounds two uncertain
   estimates.
6. **Wearable overlap is unresolved.** A workout-scoped active-kcal total may
   stop when the workout ends, whereas all-day active energy may include some
   recovery expenditure through proprietary algorithms. BodyCast must not add
   EPOC when the same post-workout interval is already represented.
7. **Final v7 decision: REJECT a separate EPOC calorie add-on.** This rejects
   an unsupported production calculation, not EPOC physiology. Explicitly
   observed active energy over the post-workout period may remain in ordinary
   energy accounting. Reconsider only with source semantics and validated
   mode/intensity/time-course estimates.

### Relevance to multi-week weight prediction

Typical study means are tens of kcal per bout, but outliers and long protocols
exist. Repetition over weeks makes the cumulative value nonzero; nevertheless,
between-study spread and likely overlap with activity estimation preclude a
defensible personal quantity. No “too small to matter” numerical cutoff is
claimed.

### Topic N evidence ledger

**E-N01 — LaForgia, Withers & Gore (2006), “Effects of exercise intensity and
duration on the excess post-exercise oxygen consumption,” Journal of Sports
Sciences.** DOI not verified; PMID 17101527. Authoritative narrative review of
aerobic and resistance EPOC. Prolonged 3–24-hour response required substantial
stimuli in reviewed aerobic work; EPOC 6–15% of net exercise oxygen cost.
Resistance relationships were explicitly unclear. **PubMed abstract verified.**

**E-N02 — Panissa et al. (2021), “Magnitude and duration of excess of
post-exercise oxygen consumption between high-intensity interval and
moderate-intensity continuous exercise: A systematic review.”** Journal/DOI not
verified; PMID 32656951. Systematic review; 22 studies, split ≤3 versus >3-hour
measurement and baseline-subtracted versus gross reporting. Baseline-subtracted
means: short HIIE ~136 kJ, MICE ~101 kJ; long HIIE ~289 kJ, MICE ~159 kJ.
Protocol/method heterogeneity; not stairs specifically. **PubMed abstract
verified.**

**E-N03 — Binzen, Swan & Manore (2001), “Postexercise oxygen consumption and
substrate use after resistance exercise in women,” Medicine & Science in Sports
& Exercise.** DOI not verified; PMID 11404658. Randomized counterbalanced
crossover; 10 moderately resistance-trained women, age 29±3; 45 minutes,
3 sets×10 exercises at 10RM, one-minute rests versus seated control. Indirect
calorimetry: two-hour extra VO2 6.2 L; VO2 returned to control in final
30 minutes. Small, demanding protocol. **PubMed abstract verified.**

**E-N04 — Haltom et al. (1999), “Circuit weight training and its effects on
excess postexercise oxygen consumption,” Medicine & Science in Sports &
Exercise.** DOI not verified; PMID 10589865. Randomized crossover; seven healthy
men; two eight-exercise circuits, 20 reps at 75% 20RM; 20- versus 60-second
rests. One-hour EPOC 10.3±0.57 versus 7.40±0.39 L (51.51±2.84 versus
37.00±1.97 kcal), while total exercise+recovery energy favored longer rest.
Tiny/extreme circuit. **PubMed abstract verified.**

**E-N05 — Abboud et al. (2013), “Effects of load-volume on EPOC after acute
bouts of resistance training in resistance-trained men,” Journal of Strength
and Conditioning Research.** DOI not verified; PMID 23085971. Randomized
crossover; eight trained men, age 22±3; 10,000 versus 20,000-kg load-volume at
85% 1RM. Indirect-calorimetry RMR at 12–48 hours showed no time/trial
difference. Sparse recovery measurements could miss early EPOC. **PubMed
abstract verified.**

**E-N06 — Schuenke, Mikat & McBride (2002), “Effect of an acute period of
resistance exercise on excess post-exercise oxygen consumption: implications
for body mass management,” European Journal of Applied Physiology.** DOI not
verified; PMID 11882927. Seven healthy young men; 31-minute, four-circuit
bench/power-clean/squat 10RM-to-failure protocol; intermittent VO2 observations
to 48 hours. VO2 elevated immediately and at 14, 19, 38 hours. Tiny extreme
protocol; absolute integrated EPOC not established by abstract. **PubMed
abstract verified.**

**E-N07 — Melanson et al. (2002), “Resistance and aerobic exercise have similar
effects on 24-h nutrient oxidation,” Medicine & Science in Sports & Exercise.**
DOI not verified; PMID 12439085. Three-condition crossover; 10 nonobese men;
whole-room indirect calorimetry. A 70-minute lifting circuit cost 448±21 kcal;
24-hour EE 2730±106 versus control 2260±96 kcal, but postexercise-period EE did
not differ. Exercise-day difference must not all be called EPOC. **PubMed
abstract verified.**

### Topic N search log

- Sources: PubMed review/systematic review, indirect-calorimetry crossover
  studies, whole-room calorimetry; 2026-09-17.
- Queries: “resistance exercise EPOC kcal duration”; “aerobic EPOC systematic
  review”; “24 hour resistance exercise indirect calorimetry.”
- Included: baseline-controlled absolute recovery measures, systematic review,
  and integrated 24-hour evidence.
- Excluded: percentage folklore, resting-point changes presented as integrated
  kcal, substrate oxidation treated as extra fat loss, and wearable marketing.

## Measurement validity for `skeletalMuscleKg`

### Measurement hierarchy and translation rules

1. **Whole-body MRI/CT — strongest direct structural methods.** Cadaver
   validation found MRI and CT adipose-tissue-free appendicular muscle CSA each
   correlated r=.99 with dissection, with SEE ~3.8–3.9 cm² (E-MV01). Serial
   whole-body segmentation is the closest endpoint to total skeletal-muscle
   volume/mass, but protocol, segmentation, tissue density, and hydration still
   matter. CT entails ionizing radiation.
2. **Regional MRI/CT — direct local size, not whole-body kg.** A quadriceps,
   thigh, or arm CSA/volume change is anatomically valid for that region but
   cannot be applied proportionally to all skeletal muscle. Training produces
   muscle- and region-specific hypertrophy.
3. **Ultrasound — valid standardized local proxy.** B-mode ultrasound tracked
   vastus-lateralis CSA changes similarly to MRI in 14 young men (E-MV02), and
   broad review supports utility (E-MV03). Yet thickness change correlated with
   MRI mid-muscle CSA but not whole-muscle volume change in a nine-man study
   (E-MV04). Operator, site, probe pressure, architecture, and edema are
   important. It cannot directly yield total-body muscle kg.
4. **DXA lean soft tissue — not skeletal muscle.** DXA partitions attenuation
   into bone mineral, fat, and lean soft tissue; lean includes water, glycogen,
   organs, skin, and connective tissue. Total/appendicular lean mass may be a
   practical proxy, but hydration can change measured lean mass acutely
   (E-MV05), and DXA-based muscle estimates can disagree with age-related
   changes seen in creatinine/protein measures (E-MV06). Acute or small changes
   are not automatically muscle.
5. **BIA/device “skeletal muscle” — equation output, not direct anatomy.** In
   athletes, BIA overestimated FFM versus DXA by 2.78 kg (95% CI 1.38–4.18)
   with wide agreement limits (E-MV07); DXA itself is not pure muscle.
   Two-litre acute water intake distorted BIA/DXA compartments (E-MV05).
   Device algorithms, hydration, meals, skin temperature, and exercise state
   preclude direct use as ground-truth muscle change.
6. **Biopsy/fiber CSA — microscopic local endpoint.** Fiber CSA can establish
   cellular hypertrophy in sampled fibers, but sampling site, orientation,
   fiber type, and small tissue volume limit whole-muscle inference. It cannot
   be converted to total-body kg without anatomical scaling.
7. **Isotope/tracer MPS — flux, not stored mass.** Acute 1–6-hour MPS after a
   novice's first bout did not correlate with 16-week MRI hypertrophy
   (E-MV08). Longer integrated trained-state MPS can correlate with local
   hypertrophy (E-MV09), but synthesis is not net balance and is not a direct
   mass measurement.
8. **Body weight — exact aggregate scale endpoint, not composition.** Under
   standardized conditions it directly observes total mass, which includes
   fat, muscle, glycogen, water, gut contents, bone, and other tissues. It can
   constrain component sums and validate total-weight trajectories, but cannot
   identify muscle or fat changes by itself.

### Mandatory conversion rules

- Do not map a local percent thickness/CSA/fiber change to the same percent of
  whole-body `skeletalMuscleKg`.
- Do not equate DXA/BIA FFM or lean mass with skeletal muscle.
- Do not interpret acute post-workout, carbohydrate-loading, or hydration
  imaging changes as tissue hypertrophy.
- Do not convert MPS percent change directly to chronic muscle gain.
- Only whole-body muscle segmentation can directly anchor total muscle volume;
  conversion to kg must document segmentation and density assumptions.
- Longitudinal comparisons require the same method, device/software where
  possible, anatomical sites, operator protocol, and standardized pretest
  hydration/exercise/feeding.

### Measurement-validity evidence ledger

**E-MV01 — Mitsiopoulos et al. (1998), “Cadaver validation of skeletal muscle
measurement by magnetic resonance imaging and computerized tomography,”
Journal of Applied Physiology.** DOI 10.1152/jappl.1998.85.1.115; PMID 9655763.
Validation against cadaver dissection; 119 arm/leg area comparisons. MRI and CT
adipose-tissue-free skeletal-muscle CSA did not differ from cadaver and each
correlated r=.99; MRI/CT SEE 3.9/3.8 cm². Appendicular CSA validation, not
whole-body longitudinal gain. **PubMed abstract verified.**

**E-MV02 — Stokes et al. (2021), “Methodological considerations for and
validation of the ultrasonographic determination of human skeletal muscle
hypertrophy and atrophy,” Physiological Reports.** DOI
10.14814/phy2.14683; PMID 33403796. Validation;
14 young men, 10-week unilateral training and two-week contralateral
immobilization. Ultrasound versus MRI vastus-lateralis CSA changes: +7.9 versus
+7.8% and −8.2 versus −8.7%; all measurements within reported agreement limits.
Single local muscle/male sample. **PubMed abstract verified.**

**E-MV03 — Naruse, Trappe & Trappe (2022), “Human skeletal muscle size with
ultrasound imaging: a comprehensive review,” Journal of Applied Physiology.**
DOI 10.1152/japplphysiol.00041.2022; PMID 35358402; PMCID PMC9126220.
Comprehensive review of >600 articles, >27,500 participants, 107 muscles.
Supports standardized regional ultrasound validity while recognizing MRI/CT as
reference methods. **PubMed abstract verified.**

**E-MV04 — Franchi et al. (2018), “Muscle thickness correlates to muscle
cross-sectional area in the assessment of strength training-induced
hypertrophy.”** DOI not verified; PMID 28805932. Nine young men, 12-week
isokinetic training; ultrasound thickness change correlated with MRI mid-CSA
(r=.69) but not volume change (r=.33). Tiny/local study. **PubMed abstract
verified.**

**E-MV05 — Jeong et al. (2023), “The effect of acute hydration on body
composition assessed by multi-frequency and single-frequency bioelectrical
impedance,” Journal of Sports Medicine and Physical Fitness.** DOI
10.23736/S0022-4707.23.14913-9; PMID 37335581. Thirty-nine adults (20
men/19 women) before/after 2 L water. DXA FFM rose 1.4±0.8 kg in men and
1.7±0.4 kg in women; BIA often misclassified fluid as fat/FFM. Acute challenge,
not tissue change. **PubMed abstract verified.**

**E-MV06 — Proctor et al. (1999), “Comparison of techniques to estimate total
body skeletal muscle mass in people of different age groups,” American Journal
of Physiology.** DOI not verified; PMID 10484361. Fifty-nine adults across
20–79 years; DXA estimate correlated with creatinine (r=.80), but total body
water explained additional variability and DXA did not show age decline seen
in creatinine, strength, and protein. Indirect comparators. **PubMed abstract
verified.**

**E-MV07 — Dzator et al. (2023), “Agreement Between Dual-Energy X-ray
Absorptiometry and Bioelectric Impedance Analysis for Assessing Body Composition
in Athletes: A Systematic Review and Meta-Analysis,” Clinical Journal of Sport
Medicine.** DOI 10.1097/JSM.0000000000001136; PMID 36853902. Eight athlete
studies (n=461), five meta-analyzed. BIA minus DXA FFM
mean +2.78 kg (95% CI 1.38–4.18), with wide limits. Device/model heterogeneity;
comparison endpoint is DXA FFM, not muscle. **PubMed abstract verified.**

**E-MV08 — Mitchell et al. (2014), “Acute post-exercise myofibrillar protein
synthesis is not correlated with resistance training-induced muscle
hypertrophy in young men,” PLoS ONE.** DOI
10.1371/journal.pone.0089431; PMID 24586775. Twenty-three untrained young men;
stable-isotope MPS after first bout and 16-week MRI quadriceps volume. Acute
MPS–hypertrophy correlations r=.02–.16 despite 7.9±1.6% mean volume gain.
**Full-text record verified.**

**E-MV09 — Damas et al. (2016), “Resistance training-induced changes in
integrated myofibrillar protein synthesis are related to hypertrophy only after
attenuation of muscle damage,” Journal of Physiology.** DOI not verified; PMID
27219125. Ten young men; integrated 24–48-hour MyoPS and biopsy fiber CSA over
10 weeks. Week-3/10, but not initial damage-associated, MyoPS correlated with
local hypertrophy. Tiny/local; correlation does not provide kg conversion.
**PubMed abstract verified.**

### Measurement-validity search log

- Sources: PubMed validation studies, systematic/comprehensive reviews, and
  tracer longitudinal studies; 2026-09-17.
- Queries: “MRI CT cadaver skeletal muscle validation”; “ultrasound MRI muscle
  hypertrophy validity”; “DXA BIA hydration lean mass”; “acute MPS correlation
  hypertrophy.”
- Excluded: device product equations as anatomical truth, unstandardized
  before/after photos/circumference, strength as mass, and local-to-whole-body
  proportional scaling.

## Consolidated BodyCast decision table

This is a compact decision register; parameter-level conditions and mixed
decisions remain authoritative in the parameter contract.

- **A — resistance dose:** IMPLEMENT hard-set ordering over the supported
  low-to-moderate range and no required independent frequency bonus; DEFER
  global curve shape, dose-curve coefficients,
  indirect-set weights, session cap; REJECT load/tonnage as mandatory
  hypertrophy multipliers.
- **B — training status:** IMPLEMENT training status as a group-level prior,
  not deterministic pairwise ordering; DEFER gain rates, status boundaries,
  novelty/prior-volume and muscle-memory multipliers; REJECT acute MPS-to-kg
  conversion.
- **C — detraining:** IMPLEMENT distinction between cessation and reduced dose
  plus noninstant loss ordering; DEFER decay/rate/maintenance thresholds and
  retraining acceleration; REJECT strength or early morphology as direct
  muscle-loss conversion.
- **D — protein:** IMPLEMENT bounded adequacy and adverse-deficit interaction;
  DEFER exact curve/deficit requirement and FFM denominator; REJECT timing and
  very-high-protein independent bonuses.
- **E — energy balance:** IMPLEMENT asymmetric deficit suppression and training
  retention; DEFER excess-surplus fat ordering, numeric partition, surplus, and
  body-fat coefficients; REJECT symmetric deficit/surplus rule.
- **F — resistance glycogen:** IMPLEMENT nonnegative/store-bounded behavior;
  DEFER set-volume ordering and workout depletion quantity; REJECT load-only and
  kcal-to-glycogen conversions.
- **G — stair/stepper glycogen:** DEFER intensity and substrate ordering plus
  numeric depletion; REJECT universal active-kcal glycogen fraction.
- **H — repletion:** IMPLEMENT carbohydrate/depletion/capacity ordering;
  DEFER daily rate/curve and intraday timing; REJECT independent protein bonus.
- **I — glycogen water/capacity:** IMPLEMENT associated-water co-variation as
  uncertain accounting; DEFER any hard 3–4 kg/kg bound, the 0.3–0.86 kg audit
  envelope, and personal capacity/default; REJECT ECF assignment and lean-mass
  conversion.
- **J — transient resistance water:** IMPLEMENT classification and broad
  finite/time-to-baseline behavior; DEFER novelty/eccentric deterministic
  ordering, all kg amplitudes, class inference, and kernels;
  REJECT universal sets-to-water coefficient.
- **K — stepper energy/HR:** IMPLEMENT uncertainty, conditional use of current
  modality-relevant personal calibration, non-decrease with duration under a
  matched protocol, and active/gross normalization; treat the source hierarchy
  as an engineering fallback; DEFER broad MET values, sampling thresholds, and
  HR-kcal equations; REJECT
  max/average-HR standalone conversion.
- **L — resistance HR:** IMPLEMENT program-derived dose independence and HR
  auxiliary use; REJECT HR/HRV hypertrophy multipliers and fixed PPG correction.
- **M — sleep:** IMPLEMENT adverse-direction guardrails and uncertain duration
  context; DEFER deficit-partition interaction and every numerical muscle/partition/debt
  coefficient; REJECT single-night and REM/Core/Deep multipliers.
- **N — EPOC:** REJECT separate v7 EPOC add-on and fixed percentage; IMPLEMENT
  no-double-counting; DEFER any future validated mode/time-course model.
- **Measurement:** IMPLEMENT strict endpoint labels and conversion
  prohibitions; no local/DXA/BIA/tracer result directly calibrates whole-body
  `skeletalMuscleKg`.

### Parameter decision counts

There are **70 candidate parameter records**. Using the corrected first/primary
decision on each record: **21 IMPLEMENT, 27 DEFER, 22 REJECT**. Many IMPLEMENT records
contain explicitly deferred numeric subcomponents, and some DEFER records still
approve qualitative guardrails. Counting labels rather than primary records
would therefore double-count candidates.

## Cross-topic consistency review

1. **Tissue versus water:** Topics C, F–J, M, and Measurement Validity agree that
   rapid scale/lean/imaging change can reflect glycogen, water, gut content, or
   edema and cannot be assigned to muscle tissue.
2. **Stimulus versus response:** Topic A supplies program-derived dose; B/E/D/M
   alter expected adaptation only where evidence allows. HR (L), workout kcal
   (K), and MPS (B/M/MV) cannot substitute for mechanical/local stimulus.
3. **Time scales:** Acute glycogen/edema/MPS evidence is isolated from chronic
   hypertrophy. Daily simulation does not make an acute percentage a daily
   tissue coefficient.
4. **Energy accounting:** Stepper active energy (K) and EPOC (N) obey
   active-versus-gross semantics and interval nonduplication. Glycogen use (F/G)
   changes substrate stores but is not additional energy expenditure.
5. **Training history:** Experience/detraining (B/C) and repeated-bout edema (J)
   share history inputs but represent distinct processes; a lower edema response
   is not lower chronic hypertrophy by definition.
6. **Nutrition:** Protein adequacy (D) can improve adaptation/retention but
   cannot override energy, training, or physiological gain bounds (E). Protein
   is not double-counted as glycogen refill (H).
7. **No unresolved direct contradiction requires revising Topic A.** Later
   evidence reinforces set-volume ordering and HR/tonnage non-substitution.

## Known scientific gaps

- No externally validated conversion from whole-body effective hard sets and
  user training status to kg skeletal muscle over time.
- No robust advanced-versus-novice gain-rate curve, detraining decay, retraining
  bonus, or reduced-dose maintenance threshold across sex and age.
- No resistance-session or stepper-specific whole-body glycogen kg transition
  from routinely available workout inputs.
- No personalized glycogen capacity from body mass/composition/training data.
- No whole-body transient exercise-water amplitude or validated two-component
  daily decay kernel.
- Sparse direct stair-stepper substrate evidence; machine resistance and
  handrail behavior are undercharacterized.
- No validated calorie equation for ~2-minute uncalibrated HR samples, nor a
  universal wearable active-kcal error model.
- No evidence that resistance HR independently predicts hypertrophy.
- No chronic sleep-duration-to-skeletal-muscle or partition dose-response, and
  no validated sleep-debt decay.
- No robust EPOC model that avoids overlap with wearable/all-day active energy.
- Limited women, older adults, advanced athletes, and clinical populations
  across many topics; extrapolation remains explicit.
- Most hypertrophy outcomes remain local imaging or lean-mass proxies rather
  than serial whole-body MRI/CT muscle mass.

## Final numerical self-audit

- **Contextual, non-gating prior:** glycogen-associated water is often described
  as approximately **3–4 kg water/kg glycogen** (E-I01), with insufficient
  support for a hard bound or individual pass/fail rule.
- **Contextual metadata only:** aggregate adult glycogen **0.3–0.86 kg** (Topic
  I evidence); not a clamp, test threshold, personal capacity, or default.
- **Contextual population anchors, not production constants:** protein
  meta-analytic breakpoint/range, stair gross MET observations, wearable error
  statistics, local hypertrophy percentages, MPS changes, EPOC kcal, and
  measurement error values.
- No kg-per-set, training-status multiplier, detraining half-life,
  kcal-to-glycogen fraction, glycogen-refill rate, edema kg/kernel, sleep
  multiplier, HR-kcal formula, or EPOC add-on is approved.
- Any future clamp, sampling threshold, missing-data default, smoothing window,
  or numerical curve introduced without cited support must be labelled
  `ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER`.

## Evidence inventory and independent-review queue

- **Evidence IDs:** 123. **Unique papers:** 119.
- **Duplicate-paper aliases:** E-C06 = E-B11; E-C07 = E-B12; E-E03 = E-D06;
  E-E07 = E-D05. IDs remain stable and aliases are not counted as unique papers.
- **Systematic/meta-review inventory:** 35 unique papers by audited ledger-text
  classification. **Controlled/intervention/longitudinal/validation inventory:**
  about 53 unique papers; categories overlap and are not risk-of-bias grades.
- **Identifier audit:** all 117 originally listed PMIDs resolved; PMIDs were
  recovered for E-I02 and E-I05, and 20 metadata mismatches were corrected.
- Remaining full-text and incomplete-sample verification is a research-quality
  improvement, not a blocker for the claims explicitly marked eligible.

## RESEARCH REMAINING

No new research is required before designing RED tests for claims marked
eligible. Additional research is required before production use of direct
stepper substrate partition, individual glycogen capacity or hard water bounds,
whole-body transient-water amplitudes/kernels, deterministic source-accuracy
hierarchies, or quantitative sleep-to-muscle/partition coefficients.











