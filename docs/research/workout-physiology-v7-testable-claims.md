# BodyCast workout physiology v7 — testable scientific claims

**Evidence cutoff:** 2026-09-17  
**Status:** Corrected after independent scientific audit. No test code or
physiology implementation.

**Independent scientific audit:**
`docs/research/workout-physiology-v7-independent-audit.md`  
**Audit date:** 2026-09-17  
**Provenance:** Record corrected after independent audit before RED-test
generation.

Evidence roles follow the evidence review: **DIRECT**, **EXTRAPOLATED**,
**PROXY**, and **ENGINEERING**. A claim cannot become eligible merely by
relabelling EXTRAPOLATED or PROXY evidence as direct. Deterministic product
fallbacks are `ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER` and are not
scientific RED claims.

## Topic A — resistance-training dose

### C-A01 — More effective weekly volume must not reduce predicted hypertrophy

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise matched users/programs with very-low versus greater
  evidence-supported weekly hard-set volume.
- **Inputs:** same population state, nutrition, exercise selection, effort
  assumption, and time horizon; only effective sets increase.
- **Expected:** over the evidence-supported low-to-moderate weekly-volume range,
  higher effective volume does not lower group-expected local hypertrophy.
  Diminishing returns may be represented, but global concavity is not required.
- **Evidence:** E-A01–E-A03.
- **Confidence:** MODERATE.
- **Must not:** convert the E-A01 ecological slope into exact individual
  kilograms per set or allow unbounded linear gain.
- **Assertion:** relational/bounded, not exact.
- **Why defensible:** replicated syntheses support dose direction and the newest
  synthesis supports diminishing returns, but not stable curve coefficients.

### C-A02 — Volume-equated frequency neutrality

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** identical effective weekly sets distributed across different
  numbers of sessions.
- **Expected:** when volume is equated, v7 requires no independent positive
  frequency effect; it does not require exact equality across every schedule.
- **Evidence:** E-A11, supported by E-A02 and E-A14.
- **Confidence:** MODERATE for no important average independent effect;
  insufficient for exact equality.
- **Must not:** double-count frequency after weekly volume.
- **Assertion:** v7 omission of an independent positive multiplier; not exact
  physiological equality. Session timing may affect later pathways.

### C-A03 — Hard sets work without tonnage

- **RED test eligibility:** **SAFE**.

- **Scenario:** attached resistance program supplies exercises, planned sets,
  and muscle mapping but no weights/repetitions/tonnage.
- **Expected:** a scientifically qualified training dose remains available.
- **Evidence:** E-A02, E-A08, E-A10, E-A14.
- **Confidence:** MODERATE.
- **Must not:** set anabolic stimulus to zero or unavailable solely because
  tonnage is missing.
- **Assertion:** invariant.

### C-A04 — Momentary failure is not mandatory

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise matched hard sets performed near failure versus
  explicitly to momentary failure.
- **Expected:** near-failure and failure training can both be effective; v7
  requires neither exact equality nor a categorical momentary-failure bonus.
- **Evidence:** E-A09, E-A13.
- **Confidence:** MODERATE.
- **Must not:** treat all non-failure work as ineffective or encode an exact RIR
  curve.
- **Assertion:** relational.

### C-A05 — Load is not a standalone hypertrophy multiplier

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** volume-matched, sufficiently hard resistance programs across
  studied low-to-high loads.
- **Expected:** within studied loads, sufficient effort, and comparable effective
  work, lower load must not automatically imply lower hypertrophy.
- **Evidence:** E-A04, E-A10.
- **Confidence:** MODERATE.
- **Must not:** transfer load's strength-specific advantage to muscle gain.
- **Assertion:** relational.

### C-A06 — No unsupported hard volume cap

- **RED test eligibility:** **SAFE**.

- **Scenario:** weekly sets exceed a moderate amount in a trained user.
- **Expected:** marginal response may diminish, but no exact universal cutoff
  forces zero or negative hypertrophy solely because it was crossed.
- **Evidence:** E-A02, E-A05–E-A07, E-A12.
- **Confidence:** MODERATE for diminishing returns; insufficient for a cap.
- **Must not:** encode a naked sets/session or sets/week constant.
- **Assertion:** invariant until cap evidence is approved.

## Topic B — training status and adaptation

### C-B01 — Training status changes adaptive headroom

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise matched novice and extensively resistance-trained
  users receive the same progressive program dose.
- **Expected:** training status may shift the prior distribution of expected
  response; it must not deterministically order every novice–advanced pair.
- **Evidence:** E-B01, E-B05; uncertainty constrained by E-B04 and E-B06.
- **Confidence:** LOW/MODERATE for the group prior; VERY LOW for pairwise
  ordering or a ratio.
- **Must not:** apply an invented novice/intermediate/advanced multiplier or
  guarantee every novice outgains every trained individual.
- **Assertion:** relational with overlapping uncertainty.
- **Why:** group evidence supports attenuation, while individual variability is
  large and one mixed-endpoint meta-analysis did not confirm status moderation.

### C-B02 — No exact gain rate from experience

- **RED test eligibility:** **SAFE**.

- **Scenario:** training experience is present but no longitudinal individual
  muscle measurement exists.
- **Expected:** experience may alter ordering/uncertainty but cannot determine
  exact `skeletalMuscleKg` gained per day or month.
- **Evidence:** E-B01, E-B04, E-B06.
- **Confidence:** HIGH.
- **Must not:** convert one study's regional percent change or pooled FFM into a
  whole-body personal rate.
- **Assertion:** invariant.

### C-B03 — Program novelty is not chronic muscle

- **RED test eligibility:** **SAFE**.

- **Scenario:** user begins a new/unfamiliar program.
- **Expected:** novelty alone does not create an immediate skeletal-muscle gain
  bonus.
- **Evidence:** E-B02, E-B07, E-B08.
- **Confidence:** MODERATE.
- **Must not:** map early swelling or acute MPS to new muscle tissue.
- **Assertion:** invariant; transient-water behavior belongs to Topic J.

### C-B04 — Acute MPS cannot directly set long-term gain

- **RED test eligibility:** **SAFE**.

- **Scenario:** a workout or program has a larger acute MPS response.
- **Expected:** this does not by itself mandate greater chronic hypertrophy.
- **Evidence:** E-B02, E-B03, E-B07.
- **Confidence:** HIGH.
- **Must not:** use an acute MPS percentage as a chronic gain coefficient.
- **Assertion:** invariant.

### C-B05 — Muscle memory receives no unsupported bonus

- **RED test eligibility:** **SAFE**.

- **Scenario:** previously trained user resumes after detraining.
- **Expected:** the model may label the trajectory as retraining but applies no
  exact acceleration to muscle gain without validated parameters.
- **Evidence:** E-B10–E-B13.
- **Confidence:** HIGH that magnitude is unresolved.
- **Must not:** infer muscle gain from retained strength or myonuclei alone.
- **Assertion:** invariant pending stronger evidence.

## Topic C — detraining and reduced training

### C-C01 — Cessation does not instantly remove muscle tissue

- **RED test eligibility:** **SAFE**.

- **Scenario:** verified resistance training stops after a trained period.
- **Expected:** training-mediated accrual stops, but skeletal muscle has no
  same-day negative step solely from cessation.
- **Evidence:** E-C01, E-C02.
- **Confidence:** MODERATE.
- **Must not:** convert immediate scale/lean change to atrophy.
- **Assertion:** exact invariant for day zero; later loss only bounded/ordered.

### C-C02 — Longer cessation does not imply less loss risk

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise matched verified cessation intervals of different
  duration.
- **Expected:** with other conditions fixed, longer continuous cessation must
  not create artificial recovery or a muscle bonus; no universal atrophy curve
  or exact monotonic tissue-loss rate is required.
- **Evidence:** E-C01, E-C03.
- **Confidence:** MODERATE for eventual muscle-loss risk; LOW for time-course
  shape and magnitude. Strength evidence is not a muscle-mass calibration.
- **Must not:** use strength SMDs as muscle kilograms.
- **Assertion:** monotonic ordering, no exact rate.

### C-C03 — Reduced training differs from zero training

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** one user ceases loading; another retains meaningful hard
  resistance work at reduced dose.
- **Expected:** validated nonzero loading must not automatically be classified
  as complete cessation; the maintenance magnitude remains untested.
- **Evidence:** E-C04, E-C05.
- **Confidence:** MODERATE for the existence of maintenance; LOW for transfer
  and magnitude.
- **Must not:** impose a universal one-third or one-ninth threshold.
- **Assertion:** relational.

### C-C04 — Age-specific maintenance uncertainty

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** same reduced maintenance prescription in young and older adults.
- **Expected:** preserve age-related uncertainty; do not apply a directional
  age multiplier from this single maintenance protocol.
- **Evidence:** E-C04.
- **Confidence:** MODERATE.
- **Must not:** transfer young-adult maintenance results unchanged to older
  adults.
- **Assertion:** uncertainty/order, not exact multiplier.

### C-C05 — Strength loss is not muscle loss

- **RED test eligibility:** **SAFE**.

- **Scenario:** strength declines during cessation while muscle measurement is
  absent.
- **Expected:** no exact skeletal-muscle loss is derived from strength.
- **Evidence:** E-C03, E-B13.
- **Confidence:** HIGH.
- **Must not:** equate performance and tissue.
- **Assertion:** invariant.

### C-C06 — Resumption restores stimulus without invented memory gain

- **RED test eligibility:** **SAFE**.

- **Scenario:** training resumes after detraining.
- **Expected:** positive training stimulus resumes; no automatic quantitative
  muscle-memory bonus.
- **Evidence:** E-C06, E-C07, E-B13.
- **Confidence:** HIGH that bonus magnitude is unresolved.
- **Assertion:** invariant.

## Topic D — protein

### C-D01 — Protein adequacy is monotonic then bounded

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise matched resistance-training periods with increasing
  average protein intake across the studied range.
- **Expected:** across studied low-to-adequate population intakes, higher protein
  must not worsen expected adaptation; a plateau is allowed, but 1.62 g/kg/day
  is not an individual switch.
- **Evidence:** E-D01–E-D03.
- **Confidence:** MODERATE.
- **Must not:** treat 1.62 g/kg/day as an exact individual switch or use the
  pooled effect as kg skeletal muscle.
- **Assertion:** bounded/relational.

### C-D02 — Protein supports retention during deficit

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** same verified energy deficit, training, and user; only protein
  intake is higher within studied ranges.
- **Expected:** within studied deficit and intake ranges, higher protein must not
  worsen expected proxy retention; skeletal-muscle gain is not guaranteed.
- **Evidence:** E-D04–E-D07; uncertainty E-D10.
- **Confidence:** MODERATE.
- **Must not:** guarantee muscle gain or apply severe-deficit trial effects to
  every population.
- **Assertion:** monotonic, not exact.

### C-D03 — Adequate protein cannot override other bounds

- **RED test eligibility:** **SAFE**.

- **Scenario:** protein is adequate/very high but training stimulus is absent or
  physiological gain headroom is limited.
- **Expected:** protein alone does not create unlimited training-mediated
  skeletal-muscle gain.
- **Evidence:** E-D01, E-D03.
- **Confidence:** HIGH.
- **Must not:** use protein as an independent mass source disconnected from
  energy/training state.
- **Assertion:** invariant.

### C-D04 — Missing protein is not zero

- **RED test eligibility:** **SAFE**.

- **Scenario:** daily protein data are missing.
- **Expected:** no automatic deficiency penalty; result is unknown/neutral with
  wider uncertainty.
- **Evidence:** evidence studies require measured/prescribed intake; no source
  supports imputing zero (E-D01–E-D03).
- **Confidence:** HIGH as a data-validity rule.
- **Assertion:** exact invariant.

### C-D05 — Timing does not independently drive v7 hypertrophy

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** equal total daily protein consumed before versus after training,
  or with different meal distribution.
- **Expected:** v7 applies no separate timing coefficient because the evidence
  is insufficient for one, not because a physiological effect is proven zero.
- **Evidence:** E-D08, E-D09.
- **Confidence:** MODERATE.
- **Must not:** translate acute MPS meal responses into long-term kg.
- **Assertion:** invariant for v7.

## Topic E — energy balance

### C-E01 — Larger sustained deficit does not improve expected muscle gain

- **RED test eligibility:** **SAFE**.

- **Scenario:** matched training/protein/users under two sustained deficits.
- **Expected:** the larger deficit must not predict greater training-mediated
  muscle gain.
- **Evidence:** E-E01, E-E04.
- **Confidence:** MODERATE/HIGH.
- **Must not:** use ~500 kcal/day as an exact personal switch.
- **Assertion:** monotonic ordering.

### C-E02 — Deficit does not make recomposition impossible

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** less-trained or higher-fat user performs progressive resistance
  training with adequate protein during a deficit.
- **Expected:** recomposition remains possible, without treating DXA/FFM or lean
  response as direct skeletal-muscle tissue.
- **Evidence:** E-E02, E-E03.
- **Confidence:** MODERATE for skeletal muscle.
- **Must not:** force all deficit days to skeletal-muscle loss or treat LBM gain
  as exact muscle gain.
- **Assertion:** possibility/bounded behavior.

### C-E03 — Resistance training improves retention ordering

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise matched dietary weight loss with versus without
  resistance exercise.
- **Expected:** resistance exercise must not worsen expected FFM retention
  versus diet only; skeletal-muscle magnitude remains uncertain.
- **Evidence:** E-E02.
- **Confidence:** HIGH for FFM, MODERATE for muscle.
- **Assertion:** relational.

### C-E04 — Surplus is not required for all hypertrophy

- **RED test eligibility:** **SAFE**.

- **Scenario:** energy maintenance versus modest surplus with matched adequate
  training/protein.
- **Expected:** maintenance is allowed to produce muscle gain; surplus does not
  guarantee more.
- **Evidence:** E-E05, E-E06.
- **Confidence:** LOW/MODERATE.
- **Must not:** zero hypertrophy solely because surplus is absent.
- **Assertion:** invariant.

### C-E05 — Larger surplus cannot yield unlimited muscle

- **RED test eligibility:** **SAFE**.

- **Scenario:** surplus increases while training dose/status are unchanged.
- **Expected:** skeletal-muscle response remains bounded; extra mass gain can be
  allocated predominantly to fat.
- **Evidence:** E-E06.
- **Confidence:** MODERATE for direction.
- **Must not:** apply a linear kcal-to-muscle conversion.
- **Assertion:** bounded/ordering.

### C-E06 — Deficit and surplus are not mirror images

- **RED test eligibility:** **SAFE**.

- **Scenario:** equal-magnitude negative and positive energy balances.
- **Expected:** model is not required or allowed to apply one symmetric muscle
  multiplier.
- **Evidence:** E-E01, E-E05, E-E06.
- **Confidence:** HIGH.
- **Assertion:** structural invariant.

## Topic F — resistance-training glycogen depletion

### C-F01 — Strength workouts consume, not create, glycogen

- **RED test eligibility:** **SAFE**.

- **Scenario:** a completed resistance session with recruited muscle.
- **Expected:** exercise-only glycogen transition is nonpositive.
- **Evidence:** E-F01–E-F04.
- **Confidence:** HIGH.
- **Must not:** increase glycogen because active kcal or sets are positive.
- **Assertion:** exact sign invariant.

### C-F02 — Depletion is store-bounded

- **RED test eligibility:** **SAFE**.

- **Scenario:** workout demand exceeds currently available glycogen.
- **Expected:** glycogen remains nonnegative; depletion cannot exceed available
  store.
- **Evidence:** E-F01–E-F03 plus mass conservation.
- **Confidence:** HIGH.
- **Assertion:** exact bound.

### C-F03 — More matched hard sets do not reduce demand

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** same recruited muscles, effort, rests, status, and starting
  glycogen; only completed set count increases.
- **Expected:** in an isolated session with no refeeding, a higher-set condition
  that contains the lower-set work plus additional comparable work must not
  have lower cumulative demand. This does not create a universal coefficient.
- **Evidence:** E-F01.
- **Confidence:** MODERATE.
- **Must not:** use the −11.2 mmol/kg/set ecological slope as an exact personal
  coefficient.
- **Assertion:** monotonic.

### C-F04 — Muscle recruitment matters

- **RED test eligibility:** **SAFE**.

- **Scenario:** same set count targets a small versus large/different muscle
  allocation.
- **Expected:** model cannot treat local glycogen demand as universally
  identical without considering muscle mapping.
- **Evidence:** E-F01, E-F02.
- **Confidence:** MODERATE.
- **Must not:** apply vastus-lateralis concentration change to whole-body
  glycogen.
- **Assertion:** structural invariant.

### C-F05 — Resistance and aerobic glycogen conversions differ

- **RED test eligibility:** **SAFE**.

- **Scenario:** equal active-kcal strength and stepper workouts.
- **Expected:** equal kcal does not mandate equal glycogen depletion.
- **Evidence:** E-F01–E-F04; Topic G evidence.
- **Confidence:** HIGH.
- **Assertion:** invariant.

## Topic G — stair/stepper glycogen depletion

### C-G01 — Stepper demand is nonnegative and state-bounded

- **RED test eligibility:** **SAFE**.

- **Scenario:** completed stepper workout.
- **Expected:** exercise may reduce glycogen but cannot increase it; depletion
  cannot exceed the available state.
- **Evidence:** E-G05–E-G07.
- **Confidence:** HIGH.
- **Assertion:** exact sign/conservation bound.

### C-G02 — Relative intensity orders carbohydrate reliance

- **RED test eligibility:** **NOT SAFE**.
- **Audit reason:** Direct stepper substrate evidence is absent and the cross-modality ordering is too strong; retain only a low-confidence research expectation.

- **Scenario:** matched stepper duration, user, diet, and environment; relative
  intensity is higher.
- **Expected:** carbohydrate reliance/demand must not be lower.
- **Evidence:** E-G05, E-G06, extrapolated from aerobic physiology; direct
  stepper intensity E-G01–E-G04.
- **Confidence:** MODERATE.
- **Must not:** assert an exact glycogen fraction from HR.
- **Assertion:** relational.

### C-G03 — Duration increases total demand but not at a fixed glycogen rate

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** same relative-intensity stepper activity lasts longer.
- **Expected:** for one continuous matched bout, total energy demand is
  non-decreasing with duration; neither muscle glycogen nor the carbohydrate
  fraction is required to be monotonic.
- **Evidence:** E-G05, E-G07.
- **Confidence:** MODERATE after mode extrapolation.
- **Must not:** use one glycogen-per-minute constant.
- **Assertion:** monotonic total, variable marginal rate.

### C-G04 — Equal active kcal does not imply equal glycogen

- **RED test eligibility:** **SAFE**.

- **Scenario:** equal active energy with different intensity profiles or
  resistance versus stepper modality.
- **Expected:** glycogen depletion may differ.
- **Evidence:** E-F01, E-G05–E-G08.
- **Confidence:** HIGH.
- **Assertion:** invariant.

## Topic H — glycogen repletion

### C-H01 — Carbohydrate increases refill opportunity

- **RED test eligibility:** **SAFE**.

- **Scenario:** same depleted state and recovery interval with greater available
  carbohydrate in the studied range.
- **Expected:** glycogen resynthesis must not be lower.
- **Evidence:** E-H01, E-H05.
- **Confidence:** HIGH.
- **Must not:** use 23.5 mmol/kg dry mass/hour as whole-body kg.
- **Assertion:** monotonic.

### C-H02 — Repletion slows at capacity

- **RED test eligibility:** **SAFE**.

- **Scenario:** identical carbohydrate input from deeply depleted versus
  near-capacity states.
- **Expected:** available storage space bounds gain; state never exceeds
  capacity.
- **Evidence:** E-H02, E-H05.
- **Confidence:** HIGH.
- **Assertion:** exact capacity invariant plus relational state dependence.

### C-H03 — Daily total can dominate timing

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** equal daily carbohydrate split into different meal frequencies
  with no same-day second workout.
- **Expected:** at daily resolution with no second workout, v7 need not apply a
  meal-frequency effect; this is not a claim of physiological equality.
- **Evidence:** E-H02, E-H04.
- **Confidence:** MODERATE.
- **Must not:** create unsupported hourly precision in a daily simulator.
- **Assertion:** v7 invariant.

### C-H04 — Short recovery preserves timing relevance

- **RED test eligibility:** **NOT SAFE**.
- **Audit reason:** The direction is credible, but the intraday timing feature is deferred and is not a v7 production invariant.

- **Scenario:** consecutive workouts within ≤8 hours with immediate versus
  delayed carbohydrate.
- **Expected:** immediate/regular carbohydrate can produce faster interim
  repletion.
- **Evidence:** E-H01, E-H03.
- **Confidence:** HIGH.
- **Assertion:** directional; feature may remain deferred.

### C-H05 — Protein is not double-counted for glycogen

- **RED test eligibility:** **SAFE**.

- **Scenario:** carbohydrate and energy are matched, with versus without added/
  substituted protein.
- **Expected:** no independent protein glycogen bonus.
- **Evidence:** E-H01, E-H06.
- **Confidence:** HIGH.
- **Assertion:** invariant.

## Topic I — glycogen-associated water

### C-I01 — Associated water co-moves with glycogen

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** modeled glycogen increases/decreases with other water inputs
  held fixed.
- **Expected:** associated water changes in the same direction. Approximately
  3–4 kg/kg is an uncertain typical prior, not a hard or personal bound.
- **Evidence:** E-I01, E-I04, E-I05, E-I07.
- **Confidence:** MODERATE.
- **Must not:** claim the ratio is molecularly fixed or exact.
- **Assertion:** directional co-variation; hard bounds are deferred.

### C-I02 — No glycogen-water double counting

- **RED test eligibility:** **SAFE**.

- **Scenario:** glycogen-associated water and transient ECF are reconstructed.
- **Expected:** the same water mass appears in exactly one compartment.
- **Evidence:** E-I02–E-I05 plus mass conservation.
- **Confidence:** HIGH.
- **Assertion:** exact invariant.

### C-I03 — Excess hydration is not all glycogen water

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** measured water gain exceeds the model's selected uncertain
  glycogen-associated component.
- **Expected:** excess is not automatically assigned to glycogen-associated
  water.
- **Evidence:** E-I04, E-I05.
- **Confidence:** MODERATE for classification; insufficient for a hard 4 kg/kg
  boundary.
- **Assertion:** classification rule without a universal numeric bound.

### C-I04 — Glycogen loading is not hypertrophy

- **RED test eligibility:** **SAFE**.

- **Scenario:** carbohydrate loading increases body weight, DXA lean mass, or
  local muscle CSA over days.
- **Expected:** no corresponding skeletal-muscle tissue gain is inferred.
- **Evidence:** E-I01–E-I03, E-I05.
- **Confidence:** HIGH.
- **Must not:** convert the 3.5% acute vastus CSA rise in E-I02 to muscle mass.
- **Assertion:** invariant.

### C-I05 — Glycogen state obeys broad physiological plausibility

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** aggregate adult glycogen is reconstructed.
- **Expected:** 0.3–0.86 kg may be displayed as contextual adult metadata only;
  it never determines pass/fail, clipping, a user capacity, or a default.
- **Evidence:** E-I06.
- **Confidence:** LOW for individual transfer; insufficient as an audit bound.
- **Assertion:** non-gating contextual warning only.

## Topic J — post-resistance transient water

### C-J01 — Acute swelling is not muscle tissue

- **RED test eligibility:** **SAFE**.

- **Scenario:** local thickness/CSA or body weight rises within hours/days of a
  resistance workout.
- **Expected:** change may enter transient water, never immediate
  `skeletalMuscleKg`.
- **Evidence:** E-J01–E-J07.
- **Confidence:** HIGH.
- **Assertion:** exact classification invariant.

### C-J02 — Immediate and delayed responses differ

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** ordinary concentric/accustomed work versus unaccustomed
  eccentric-dominant work.
- **Expected:** distinct time courses are permitted; v7 need not infer a response
  class or force a two-component model from ordinary workout records.
- **Evidence:** E-J03, E-J05–E-J07.
- **Confidence:** HIGH.
- **Assertion:** relational/time-course.

### C-J03 — Repeated exposure attenuates damage response

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** matched damaging bout repeated after prior exposure.
- **Expected:** prior exposure may lower expected damage markers or edema on
  average; no deterministic non-increase is required for every repeated bout.
- **Evidence:** E-J05, E-J08.
- **Confidence:** HIGH for damage markers; MODERATE for water.
- **Must not:** apply an exact repeated-bout multiplier.
- **Assertion:** probabilistic expectation, not deterministic ordering.

### C-J04 — Routine trained workout can resolve rapidly

- **RED test eligibility:** **SAFE**.

- **Scenario:** trained user performs an accustomed moderate/high-volume session.
- **Expected:** model permits no sustained edema beyond the next day.
- **Evidence:** E-J06.
- **Confidence:** MODERATE.
- **Must not:** force multi-day water after every workout.
- **Assertion:** allowed bounded outcome.

### C-J05 — Damaging bout can persist across days

- **RED test eligibility:** **SAFE**.

- **Scenario:** untrained/novel, eccentric-dominant session.
- **Expected:** transient water may remain elevated for 48–96 hours or longer in
  extreme protocols.
- **Evidence:** E-J02–E-J05, E-J07.
- **Confidence:** MODERATE.
- **Must not:** treat the longest extreme-study tail as routine.
- **Assertion:** broad time window.

### C-J06 — Transient water returns toward baseline

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** no further damaging bouts after an exercise-induced elevation.
- **Expected:** absent new causes, an isolated transient component remains finite
  and trends toward baseline; no exact zero time or half-life is asserted.
- **Evidence:** E-J03–E-J07.
- **Confidence:** HIGH.
- **Assertion:** finite/baseline-directed behavior; exact endpoint and half-life
  deferred.

## Topic K — stepper energy expenditure and HR

### C-K01 — Wearable active kcal is not exact

- **RED test eligibility:** **SAFE**.

- **Scenario:** workout contains device-reported active energy.
- **Expected:** value retains provenance and material uncertainty.
- **Evidence:** E-K01, E-K02.
- **Confidence:** HIGH.
- **Must not:** label it criterion-measured calorimetry or assign zero error.
- **Assertion:** invariant.

### C-K02 — Source hierarchy degrades explicitly

- **RED test eligibility:** **NOT SAFE**.
- **Audit reason:** The hierarchy may be used as an engineering fallback, but evidence does not establish it as a universal scientific accuracy ordering.

- **Scenario:** device active kcal present, absent with usable HR, or absent with
  no usable HR.
- **Expected:** select device estimate, HR-assisted modality estimate, or MET
  fallback respectively; uncertainty does not shrink on fallback.
- **Evidence:** E-K01–E-K05, E-K09, E-G01–E-G03.
- **Confidence:** MODERATE as a product policy.
- **Assertion:** ordered fallback.

### C-K03 — Individual calibration is more informative

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise identical HR estimate with versus without a valid,
  current, modality-relevant personal calibration.
- **Expected:** the qualifying calibrated estimate generally has no greater
  epistemic uncertainty.
- **Evidence:** E-K03–E-K05.
- **Confidence:** MODERATE and conditional on calibration validity and relevance.
- **Must not:** treat age/sex/mass population equation as personally calibrated.
- **Assertion:** uncertainty ordering.

### C-K04 — Sparse HR cannot recover unobserved transitions

- **RED test eligibility:** **SAFE**.

- **Scenario:** two sessions share average/max HR but differ in interval/steady
  profiles between ~2-minute samples.
- **Expected:** model does not require identical true EE and exposes lower
  confidence when coverage/gaps are poor.
- **Evidence:** E-K09.
- **Confidence:** MODERATE.
- **Must not:** invent a scientifically validated sampling cutoff.
- **Assertion:** information invariant.

### C-K05 — Max HR alone is not calorie dose

- **RED test eligibility:** **SAFE**.

- **Scenario:** same max HR but different duration/time at intensity.
- **Expected:** predicted active energy may differ and cannot be derived from max
  alone.
- **Evidence:** E-K03–E-K05.
- **Confidence:** HIGH.
- **Assertion:** invariant.

### C-K06 — Matched-protocol stepper energy scales with duration

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** the same mechanical stepper protocol and efficiency assumptions
  are applied for different durations.
- **Expected:** gross energy demand is non-decreasing with duration. Body-mass
  scaling remains an estimate, not an exact invariant.
- **Evidence:** E-G01–E-G03.
- **Confidence:** MODERATE for duration direction; LOW for individual/body-mass
  scaling.
- **Must not:** force a universal 8.6–9.6 MET value.
- **Assertion:** monotonic.

### C-K07 — Gross and active kcal cannot be mixed

- **RED test eligibility:** **SAFE**.

- **Scenario:** MET fallback reports gross energy while simulator already
  accounts for resting expenditure.
- **Expected:** resting component is removed/normalized exactly once.
- **Evidence:** E-G01, E-G02 plus conservation.
- **Confidence:** HIGH.
- **Assertion:** exact accounting invariant.

## Topic L — resistance-training heart rate

### C-L01 — HR does not independently add hypertrophy

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** identical program-derived effective dose with different workout
  average/max HR.
- **Expected:** after program dose is represented, v7 applies no independent
  causal HR multiplier; this does not assert that HR contains zero residual
  information.
- **Evidence:** E-A03, E-L02–E-L04 and Topic A.
- **Confidence:** HIGH.
- **Assertion:** exact v7 structural invariant.

### C-L02 — Missing HR does not erase strength stimulus

- **RED test eligibility:** **SAFE**.

- **Scenario:** valid resistance program/workout but no HR samples.
- **Expected:** program-derived anabolic dose remains available and unchanged.
- **Evidence:** E-A03 and Topic A.
- **Confidence:** HIGH.
- **Must not:** assign zero stimulus or missing-data penalty.
- **Assertion:** exact invariant.

### C-L03 — Equal HR does not imply equal local stimulus

- **RED test eligibility:** **SAFE**.

- **Scenario:** workouts produce the same HR summary but recruit different
  muscles or differ in sets/proximity to failure.
- **Expected:** local/whole-body anabolic dose may differ.
- **Evidence:** E-A03, E-L02–E-L04.
- **Confidence:** HIGH.
- **Assertion:** non-equivalence invariant.

### C-L04 — Resistance HR uncertainty is activity and device specific

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** wrist PPG during lifting versus steady treadmill work.
- **Expected:** uncertainty remains activity-, movement-, and device-specific;
  v7 does not require a universal resistance-versus-treadmill error ordering.
- **Evidence:** E-L07, E-L08.
- **Confidence:** MODERATE/HIGH.
- **Must not:** apply −7.26 bpm as a personal correction.
- **Assertion:** context-specific uncertainty, not a universal ordering.

### C-L05 — HRV is not a muscle-gain multiplier

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** identical completed training dose with differing pre-session
  HRV/readiness.
- **Expected:** v7 applies no independent HRV hypertrophy coefficient because
  none is validated; null small RCTs are not proof of physiological equivalence.
- **Evidence:** E-L05, E-L06.
- **Confidence:** MODERATE.
- **Assertion:** exact v7 invariant.

## Topic M — sleep

### C-M01 — Sustained severe restriction must not improve muscle expectation

- **RED test eligibility:** **SAFE AFTER AUDIT REVISION**.
- **Audit note:** Wording revised to match the independent audit's supported scope.

- **Scenario:** otherwise matched multi-night normal versus severe restricted
  sleep.
- **Expected:** severe multi-night restriction must not create a positive
  anabolic bonus solely through sleep; no exact chronic penalty is asserted.
- **Evidence:** E-M01, E-M02.
- **Confidence:** HIGH for acute mechanism, LOW/MODERATE for chronic gain.
- **Assertion:** monotonic guardrail, not magnitude.

### C-M02 — Acute MPS is not chronic muscle kg

- **RED test eligibility:** **SAFE**.

- **Scenario:** one-night or five-night study reports lower synthesis.
- **Expected:** reported percentage is not applied directly to
  `skeletalMuscleKg` gain.
- **Evidence:** E-M01, E-M02.
- **Confidence:** HIGH.
- **Assertion:** exact classification invariant.

### C-M03 — One poor night has no exact daily multiplier

- **RED test eligibility:** **SAFE**.

- **Scenario:** isolated low wearable sleep duration.
- **Expected:** v7 applies no precise muscle/fat coefficient.
- **Evidence:** E-M01–E-M04.
- **Confidence:** HIGH that calibration is absent.
- **Assertion:** exact v7 invariant.

### C-M04 — Sleep-restricted diet can shift partition adversely

- **RED test eligibility:** **NOT SAFE**.
- **Audit reason:** One n=10 DXA crossover trial supports only a low-certainty direction and cannot support a production skeletal-muscle assertion.

- **Scenario:** sustained calorie restriction with severe shorter versus longer
  sleep opportunity.
- **Expected:** model permits less fat loss/more nonfat loss under shorter sleep;
  it must not force the reverse.
- **Evidence:** E-M03.
- **Confidence:** MODERATE.
- **Must not:** convert DXA FFM loss directly to skeletal-muscle loss.
- **Assertion:** directional/possibility.

### C-M05 — Missing sleep is unknown

- **RED test eligibility:** **SAFE**.

- **Scenario:** no sleep record.
- **Expected:** no zero-sleep assumption and no automatic muscle penalty.
- **Evidence:** measurement/causal uncertainty E-M01–E-M05, E-K01, E-M07.
- **Confidence:** HIGH.
- **Assertion:** exact missing-data invariant.

### C-M06 — Consumer stages do not drive physiology

- **RED test eligibility:** **SAFE**.

- **Scenario:** REM/Core/Deep values vary while duration and other inputs match.
- **Expected:** v7 body-composition outputs remain unchanged.
- **Evidence:** E-M05, E-K01, E-M07.
- **Confidence:** HIGH.
- **Assertion:** exact invariant.

### C-M07 — Wearable sleep is not PSG

- **RED test eligibility:** **SAFE**.

- **Scenario:** consumer sleep duration/stages are ingested.
- **Expected:** preserve device provenance and measurement uncertainty.
- **Evidence:** E-M05, E-K01, E-M07.
- **Confidence:** HIGH.
- **Must not:** claim exact sleep/wake or stage classification.
- **Assertion:** metadata/uncertainty invariant.

## Topic N — EPOC

### C-N01 — No automatic EPOC add-on

- **RED test eligibility:** **SAFE**.

- **Scenario:** strength or stepper workout is synced.
- **Expected:** v7 adds no separate inferred post-workout calorie amount.
- **Evidence:** E-N01–E-N07.
- **Confidence:** HIGH as v7 decision.
- **Assertion:** exact invariant.

### C-N02 — No universal EPOC percentage

- **RED test eligibility:** **SAFE**.

- **Scenario:** workouts have equal reported active kcal but different
  intensity/mode/density.
- **Expected:** model does not infer identical EPOC via a fixed percentage.
- **Evidence:** E-N01–E-N07.
- **Confidence:** HIGH.
- **Assertion:** exact invariant.

### C-N03 — Observed recovery energy is counted once

- **RED test eligibility:** **SAFE**.

- **Scenario:** all-day activity source includes post-workout active energy.
- **Expected:** the represented interval is not supplemented by EPOC.
- **Evidence:** E-N07 and conservation.
- **Confidence:** HIGH.
- **Assertion:** exact accounting invariant.

### C-N04 — EPOC is not zero physiology

- **RED test eligibility:** **SAFE**.

- **Scenario:** scientific reporting/explanation of the v7 exclusion.
- **Expected:** exclusion is described as prediction uncertainty/double-counting
  control, not denial that postexercise VO2 rises.
- **Evidence:** E-N01–E-N06.
- **Confidence:** HIGH.
- **Assertion:** interpretation invariant.

## Measurement-validity claims

### C-MV01 — Local hypertrophy is not whole-body hypertrophy

- **RED test eligibility:** **SAFE**.

- **Scenario:** a study reports percent change in one muscle's ultrasound/MRI
  thickness, CSA, volume, or biopsy fiber CSA.
- **Expected:** BodyCast does not apply that percentage to total
  `skeletalMuscleKg`.
- **Evidence:** E-MV01–E-MV04, E-MV09.
- **Confidence:** HIGH.
- **Assertion:** exact conversion prohibition.

### C-MV02 — Lean mass is not skeletal muscle

- **RED test eligibility:** **SAFE**.

- **Scenario:** DXA/BIA reports FFM, lean soft tissue, or “skeletal muscle.”
- **Expected:** endpoint remains a proxy and hydration-sensitive change is not
  automatically tissue.
- **Evidence:** E-MV05–E-MV07 and E-I03–E-I07.
- **Confidence:** HIGH.
- **Assertion:** exact classification invariant.

### C-MV03 — Acute MPS is not accumulated muscle mass

- **RED test eligibility:** **SAFE**.

- **Scenario:** isotope study reports acute percent synthesis response.
- **Expected:** no direct percent or kg conversion to chronic gain.
- **Evidence:** E-MV08, E-MV09.
- **Confidence:** HIGH.
- **Assertion:** exact invariant.

### C-MV04 — Body weight conserves total mass only

- **RED test eligibility:** **SAFE**.

- **Scenario:** scale weight changes without composition measurement.
- **Expected:** component sum matches total-weight accounting, but weight alone
  cannot identify fat versus muscle versus glycogen/water.
- **Evidence:** measurement definitions and Topics I/J.
- **Confidence:** HIGH.
- **Assertion:** conservation plus non-identifiability.

### C-MV05 — Longitudinal method consistency

- **RED test eligibility:** **SAFE**.

- **Scenario:** before/after body-composition estimates use different devices,
  sites, hydration states, or acute exercise conditions.
- **Expected:** uncertainty is greater than a standardized same-method series.
- **Evidence:** E-MV01–E-MV07.
- **Confidence:** HIGH.
- **Assertion:** uncertainty ordering.

## Independent-audit disposition summary

- **49 claims:** **SAFE** for direct RED-test translation.
- **28 claims:** **SAFE AFTER AUDIT REVISION** and eligible only with the revised
  wording in this document.
- **4 claims:** **NOT SAFE** — C-G02, C-H04, C-K02, and C-M04.
- No new research is required to begin RED-test design for the 77 eligible
  claims. New research is required before promoting any of the four unsafe
  claims or any deferred quantitative parameter to a production invariant.











