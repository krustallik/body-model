# Research 6.1 — post-exercise recovery energy

**Scope:** research only, 2026-09-18. This document does not change the
scientific manifest, production TDEE, muscle transition, glycogen/water model,
fat model, forecast, or Stage 6.2A.

## Question and estimands

This review asks whether BodyCast can defensibly add a *separate quantitative
recovery-energy component* after resistance training or a stair-stepper/cardio
bout. It distinguishes four non-interchangeable things:

1. **Workout active energy** — movement energy above rest during the recorded
   workout interval.
2. **EPOC** — integrated energy above a matched resting/control baseline after
   the interval; this is not automatically the same as an elevated RMR point.
3. **Turnover/recovery biology** — glycogen restoration, protein turnover,
   inflammation and repair. A raised molecular flux is not itself a measured
   whole-body kcal cost.
4. **Net tissue deposition** — a distinct, closed energy-balance term. Its
   synthesis cost must not be confused with chemical energy stored in tissue.

No fixed percentage of workout kcal, recovery multiplier, kcal/set, or
intensity-only EPOC coefficient is supported.

## Evidence ledger

| Candidate | Human evidence: population, protocol, method | Magnitude and time course | Applicability / uncertainty / double-counting risk | Status |
| --- | --- | --- | --- | --- |
| Resistance EPOC | [Melby 1992, PMID 1434580](https://pubmed.ncbi.nlm.nih.gov/1434580/): 6 men, 42-min weights (4 upper + 3 lower exercises, 12RM); counterbalanced seated control; indirect calorimetry. [Binzen 2001, PMID 11404658](https://pubmed.ncbi.nlm.nih.gov/11404658/): 10 trained women, 45 min, 3×10 exercises at 10RM; indirect calorimetry. [Haltom 1999, PMID 10589865](https://pubmed.ncbi.nlm.nih.gov/10589865/): 7 men, dense 8-exercise circuits; indirect calorimetry. | Melby: about 19 additional kcal in the observed 60 min. Binzen: 6.2 L excess VO2 over 2 h (about 30 kcal using the conventional approximately 5 kcal/L conversion). Haltom: 37.0–51.5 kcal over 1 h, depending on rest design. | Small, protocol-specific samples; density, load, training state and recovery window differ. Individual strength diary fields cannot identify these laboratory protocols. A device/all-day active source may already represent some later activity. | **REJECT / immaterial as a separate numeric component.** EPOC exists, but there is no transfer function or non-overlap guarantee. |
| Stepper/cardio EPOC | [Panissa 2021, PMID 32656951, DOI 10.1111/obr.13099](https://pubmed.ncbi.nlm.nih.gov/32656951/): systematic review, 22 HIIE/MICE/SIE studies; baseline-subtracted values analysed separately by measurement window. | Mean baseline-subtracted EPOC: ≤3 h, HIIE ~136 kJ (32.5 kcal) vs MICE ~101 kJ (24.1 kcal); >3 h, HIIE ~289 kJ (69.1 kcal) vs MICE ~159 kJ (38.0 kcal). Effective duration remains method-dependent. | Not stair-stepper-specific; intervals/intensity and baseline methods are heterogeneous. Stepper device active kcal is already a device-estimated active quantity, while all-day feeds have unresolved post-bout overlap. | **REJECT / immaterial as a separate numeric component.** A population mean is not a validated individual stair mapping. |
| Glycogen resynthesis energetic cost | [Burke 2017, PMID 27789774, DOI 10.1152/japplphysiol.00860.2016](https://pubmed.ncbi.nlm.nih.gov/27789774/): human review; early 0–4 h and later 4–24 h resynthesis depend on depletion and carbohydrate intake. [Pascoe 1993, PMID 8455450](https://pubmed.ncbi.nlm.nih.gov/8455450/): 8 untrained men, unilateral knee extensions, biopsy and CHO/water crossover. | Glycogen restoration can be biologically substantial and is fastest early in recovery, but these sources report substrate restoration/rates, not a portable additional whole-body kcal cost after an arbitrary diary workout. | Resynthesis depends on depletion, carbohydrate availability, muscle mass, prior diet, and concurrent activity. Food processing belongs in TEF; ordinary glycogen turnover belongs in ordinary expenditure. Adding a separately inferred cost can overlap with EPOC and with the existing glycogen energy/state accounting. | **REJECT / already accounted or unidentifiable.** Retain glycogen state semantics; do not add recovery kcal. |
| Elevated protein turnover / MPS | [Phillips 1997, PMID 9252485](https://pubmed.ncbi.nlm.nih.gov/9252485/): 8 untrained adults, isotope tracers after 8×8 at 80% 1RM; MPS elevated 3, 24 and 48 h while breakdown also rose at 3 and 24 h. [Davies 2024, PMID 38716482, DOI 10.1155/2024/3184356](https://pubmed.ncbi.nlm.nih.gov/38716482/): 79 controlled trials / 237 adults; pooled MPS increase 0.032 %/h, I²=92%. | MPS can persist up to 48 h. The systematic review reports strong heterogeneity by age, loading/effort, training state, muscle fraction and timing. It does **not** establish an integrated individual kcal increment. | Fractional synthesis is not net protein accretion and cannot be converted to kcal from sets, tonnage, RIR or sparse HR. Protein feeding independently raises synthesis and TEF. Converting MPS to recovery energy would overlap basal turnover, TEF, EPOC and any net lean-tissue term. | **RESEARCH-C; numeric component blocked.** |
| Tissue repair/remodeling after damage | [Burt 2014, PMID 23566074, DOI 10.1080/17461391.2013.783628](https://pubmed.ncbi.nlm.nih.gov/23566074/): 8 men after 100 Smith-machine squats; indirect calorimetry/RMR, submaximal running and 30-min recovery at 24/48 h. [Kolkhorst 1994, PMID 7643578](https://pubmed.ncbi.nlm.nih.gov/7643578/): 9 men, three consecutive jogging versus cycling days, indirect-calorimetry RMR on 7 recovery mornings; no mode/time RMR difference. | Burt reported higher RMR and EPOC at 24/48 h after deliberately damaging, unfamiliar squats, but the abstract supplies no integrated recovery kcal. Kolkhorst found no postexercise RMR difference despite greater jogging soreness. | Damage, novelty, eccentric exposure, fitness, sex, nutrition and assay timing vary. No usable mapping from BodyCast exercise class/load/RIR to damage or integrated energy; evidence conflicts. | **RESEARCH-C; numeric component blocked.** |
| Actual net tissue-synthesis energy | [Hall 2010, PMID 20132585, DOI 10.1017/S0007114510000206](https://pubmed.ncbi.nlm.nih.gov/20132585/) provides a whole-body energy-balance framework for biochemical cost of fat/protein deposition, distinct from stored chemical energy. | Existing BodyCast contract uses Hall-compatible `etaF=750 kJ/kg` and `etaL=960 kJ/kg` as the incremental costs of *net* fat/lean-tissue change, separately from `rhoF`/`rhoL` stored energy. | This is not an acute post-workout response and should be driven only by net modeled tissue transition. Baseline turnover remains ordinary expenditure. Adding MPS/repair kcal on top risks counting both gross turnover and eventual net deposition. | **READY-A only in the existing net-tissue accounting role; REJECT as a new recovery component.** |

### Interpretation of variability

EPOC magnitude and duration increase with protocol intensity/density in some
experiments, but the evidence is not a personal prediction equation. The
Panissa review also separates baseline-subtracted and non-subtracted methods,
which changes the meaning of reported values. Resistance evidence has small
samples and very different circuits/loads/rest windows. MPS evidence has high
heterogeneity (I²=92%) and measures local synthetic flux, not whole-body extra
expenditure. Therefore neither intensity, duration, modality, HR, sets, load,
tonnage, or RIR is a defensible standalone coefficient.

## BodyCast accounting map

| Component | Current/accounting role | Correct treatment of recovery biology | Main double-counting failure to avoid |
| --- | --- | --- | --- |
| Workout active kcal | `Workout.activeEnergyKcal` is Garmin/Apple active energy above rest; a MET fallback is converted to net activity by subtracting RMR during the workout. | It covers the timed bout only under source semantics; it must not silently include a fixed recovery amount. | Subtracting resting energy a second time from device active kcal, or adding the same workout through legacy strength minutes. |
| Garmin/Apple and all-day activity | Device estimate, not calorimetry ground truth. Workout-scoped and all-day products can use different proprietary windows. | Preserve source provenance; any observed later active energy stays ordinary observed activity, not modelled EPOC. | Adding modelled EPOC where an all-day source/algorithm has already represented part of the post-bout interval. |
| Dynamic RMR / existing TDEE | Daily RMR includes ordinary baseline metabolism and baseline protein/glycogen turnover; TDEE composes RMR, TEF, activity, adaptive term and existing net-tissue accounting. | An experimentally observed *increment above a matched resting baseline* would be conceptually distinct, but is unavailable per user/session. | Calling ordinary post-meal or baseline turnover “recovery” and adding it again. |
| TEF | Meal-related processing expenditure. | Carbohydrate/protein used in recovery does not create a second independent TEF. | Adding glycogen/protein handling cost after TEF. |
| Glycogen state | Chemical glycogen storage/release and its state/water consequences are separately accounted under existing contracts. | Recovery resynthesis is a substrate-state process, not a permitted generic extra kcal add-on. | Treating glycogen chemical energy, glycogen synthesis, and EPOC as three additive costs without measured separation. |
| Protein turnover/repair | Basal turnover is embedded in ordinary expenditure; gross exercise-stimulated MPS may coexist with breakdown and zero net tissue gain. | Keep as qualitative/research context only. | Converting tracer FSR to kcal, then also charging Hall net lean-tissue synthesis. |
| Future tissue transitions | Net tissue storage is closed with Hall `rho` (stored energy) and `eta` (synthesis cost). | Use only the existing net transition term, if/when a transition is modeled. | Equating tissue's stored energy with its synthesis cost, or charging gross recovery and net deposition twice. |

## Materiality decision

The best directly integrated EPOC examples here are commonly tens of kcal per
bout, while their protocol/population spread, recovery window, wearable source
semantics and ordinary intake/expenditure uncertainty are larger than the
resolution needed for a personal forecast correction. The result is not that
recovery physiology is zero. It is that an unmeasured personal residual is not
identifiable well enough to justify a new daily input, especially when the same
effect may be absorbed by device activity, TDEE calibration, TEF, RMR, or net
tissue accounting.

No universal numerical immateriality cutoff is claimed. The decision is an
accounting and prediction-identifiability decision: current error/overlap risk
exceeds the value of an added unvalidated scalar.

## Final decision

| Component | Final status | Production decision |
| --- | --- | --- |
| Resistance EPOC | REJECT / immaterial as separate numeric component | Do not add. |
| Stepper/cardio EPOC | REJECT / immaterial as separate numeric component | Do not add. |
| Glycogen-resynthesis recovery kcal | REJECT / already accounted or unidentifiable | Do not add. |
| Protein turnover / MPS kcal | RESEARCH-C | Keep blocked. |
| Damage/repair kcal | RESEARCH-C | Keep blocked. |
| Net tissue-synthesis cost | READY-A only for existing Hall net-tissue term | Do not create a second recovery state. |

**Conclusion:** nothing in the reviewed evidence supports a standalone Stage
6.1 numeric recovery-energy component. BodyCast should retain its existing
no-automatic-EPOC rule. A separate recovery-energy state is not needed now.

The only justified next step is **research**, not implementation: a
prospective, mode-specific study using whole-room or prolonged baseline-
controlled calorimetry, explicit source-window semantics, and held-out
validation against user-visible inputs. It would need to prove an incremental,
non-overlapping recovery signal beyond the existing activity/RMR/TEF/tissue
components before a production proposal is considered.
