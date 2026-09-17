# BodyCast workout physiology v7 — parameter contract

**Evidence cutoff:** 2026-09-17  
**Status:** Corrected after independent scientific audit; eligible records are
ready for RED-test design. Every physiological number requires evidence IDs.

**Independent scientific audit:**
`docs/research/workout-physiology-v7-independent-audit.md`  
**Audit date:** 2026-09-17  
**Provenance:** Record corrected after independent audit before RED-test
generation.

`IMPLEMENT` means the evidence justifies a production relationship, not that
code has been written. `DEFER` means evidence is insufficient for a stable
production quantity. `REJECT` means the proposed mechanism/input is not a valid
or useful production predictor.

Evidence roles: **DIRECT**, **EXTRAPOLATED**, and **PROXY** have the definitions
in the evidence review. Deterministic fallbacks/defaults needed for software but
not supported as physiology are **ENGINEERING ASSUMPTION — NOT SCIENTIFIC
PARAMETER**. Cross-modality stepper substrate transfer, local-to-whole-body
conversion, DXA-to-muscle conversion, acute-to-chronic sleep transfer, local
glycogen-to-whole-body conversion, and uncalibrated HR-to-energy transfer must
not be silently promoted from **EXTRAPOLATED/PROXY** to **DIRECT**.

## Topic A — resistance-training dose

### P-A01 — Whole-body hard-set dose

- **Purpose:** aggregate muscle-mapped program work into an anabolic stimulus.
- **Units:** effective hard sets per week, aggregated after muscle mapping.
- **Representation:** weekly direct-set total plus explicitly down-weighted
  indirect sets; exact indirect-set weight remains unresolved.
- **Recommended value:** no universal numeric coefficient.
- **Plausible range / bounds:** no scientific hard cap approved.
- **Population:** healthy adults; strongest applicability to young adults,
  especially men; trained and untrained evidence.
- **Conditions / time scale:** sets performed with sufficient effort; weekly.
- **Evidence:** E-A01–E-A04, E-A08.
- **Confidence:** MODERATE; direct for local hypertrophy dose, extrapolated to
  whole-body `skeletalMuscleKg`.
- **Missing input:** no attached program means training dose is unavailable;
  do not manufacture sets from workout duration, HR, or kcal.
- **Sensitivity:** muscle mapping and direct/indirect-set policy.
- **Decision:** **IMPLEMENT** as an ordered dose input without a fixed
  kg-per-set coefficient.
- **Open:** validated whole-body aggregation and indirect-set weighting.

### P-A02 — Weekly dose response

- **Purpose:** represent diminishing returns to additional hard-set volume.
- **Units:** dimensionless response ordering.
- **Representation:** monotonic non-decreasing over the evidence-supported
  low-to-moderate weekly-volume range; diminishing returns may be represented,
  but global concavity/saturation is not required and shape is uncalibrated.
- **Recommended value:** none.
- **Plausible range / bounds:** nonnegative; no evidence-based numeric
  saturation point or maximum.
- **Population / conditions:** healthy adults under progressive resistance
  training; weekly scale.
- **Evidence:** E-A01, E-A02, E-A05–E-A07, E-A12.
- **Confidence:** MODERATE for diminishing returns; LOW for exact shape.
- **Missing input:** unavailable, not zero.
- **Sensitivity:** high; curve choice can dominate predicted gain.
- **Decision:** **IMPLEMENT** non-decrease over the supported low-to-moderate
  range; **DEFER** global curve shape, coefficients, and hard cap.
- **Open:** per-muscle versus whole-body aggregation; behavior at very high
  volumes.

### P-A03 — Frequency modifier

- **Purpose:** determine whether weekly session frequency independently changes
  hypertrophy.
- **Units:** dimensionless.
- **Representation / value:** no independent positive multiplier when effective
  weekly volume is matched.
- **Evidence:** E-A02, E-A11, E-A14.
- **Confidence:** HIGH for volume-equated neutrality.
- **Fallback:** derive only weekly dose; retain timing for other mechanisms.
- **Decision:** **REJECT** independent frequency-as-hypertrophy multiplier.
- **Open:** whether extreme per-session clustering reduces realized dose.

### P-A04 — Proximity-to-failure qualification

- **Purpose:** decide whether a planned set qualifies as broadly comparable.
- **Units:** categorical hard/near-failure assumption; RIR if ever measured.
- **Representation:** hard-set eligibility/context, not a precise multiplier.
- **Recommended value / bounds:** no RIR threshold approved; momentary failure
  must not be required.
- **Evidence:** E-A08, E-A09, E-A13.
- **Confidence:** MODERATE for broad direction; LOW for threshold/curve.
- **Missing input:** use the product's explicit annotation assumption that
  program sets are generally hard; mark as assumed, not observed.
- **Decision:** **IMPLEMENT** qualitative qualification; **DEFER** numeric RIR
  coefficient.

### P-A05 — Load / repetition modifier

- **Purpose:** account for load when estimating hypertrophy.
- **Units:** %1RM or repetition range.
- **Representation / value:** no independent hypertrophy multiplier within
  sufficiently hard studied loading ranges.
- **Evidence:** E-A04, E-A08, E-A10.
- **Confidence:** MODERATE.
- **Missing input:** do not penalize a program merely because load/tonnage is
  absent.
- **Decision:** **REJECT** mandatory load/tonnage multiplier for hypertrophy.
- **Open:** very low loads without failure and exercise-specific constraints.

### P-A06 — Tonnage

- **Purpose:** optional context for external work.
- **Units:** kg·repetitions.
- **Representation:** diagnostic/context only.
- **Evidence:** E-A10, E-A14.
- **Confidence:** LOW as an incremental hypertrophy predictor.
- **Fallback:** planned hard sets remain primary.
- **Decision:** **DEFER** production effect; optional storage is compatible.

### P-A07 — Session cap

- **Purpose:** limit credit for excessive same-muscle work in one session.
- **Units:** sets per muscle per session.
- **Recommended value / range:** none supportable.
- **Evidence:** E-A02, E-A05–E-A07, E-A14.
- **Confidence:** VERY LOW / INSUFFICIENT for a number.
- **Decision:** **DEFER**.

## Topic B — training status and adaptation

### P-B01 — Training-status adaptive headroom

- **Purpose:** prevent identical long-term muscle gain for novice and advanced
  users under the same dose.
- **Units:** ordered category / uncertainty state, not a numeric multiplier.
- **Representation:** training status shifts a group-level prior distribution;
  it does not impose deterministic novice-versus-advanced ordering for every
  matched pair.
- **Recommended value / range:** none; no novice/intermediate/advanced
  multiplier or kg/month rate is justified.
- **Population:** healthy adults; evidence strongest in young men.
- **Conditions / time scale:** multi-week progressive resistance training.
- **Evidence:** E-B01, E-B04–E-B06.
- **Confidence:** LOW/MODERATE for a group-level prior; VERY LOW for pairwise
  ordering or quantitative magnitude.
- **Directness:** direct for regional hypertrophy, extrapolated to whole-body
  skeletal-muscle kilograms.
- **Missing-data fallback:** unknown status with wider uncertainty; do not
  silently assume novice.
- **Sensitivity:** extremely high; arbitrary multipliers would dominate gains.
- **Decision:** **IMPLEMENT** training status as a probabilistic prior;
  **DEFER** deterministic ordering, coefficients, boundaries, and rates.
- **Open:** robust category definition; trained women and older trained adults.

### P-B02 — Time-on-current-program novelty modifier

- **Purpose:** alter chronic anabolic response as a program becomes familiar.
- **Units:** days/weeks on program.
- **Representation / value:** none approved.
- **Evidence:** E-B02, E-B07, E-B08.
- **Confidence:** INSUFFICIENT for chronic muscle gain.
- **Fallback:** preserve as user metadata; no hypertrophy multiplier.
- **Decision:** **DEFER** for chronic gain. Reconsider only for Topic J
  transient damage/water.

### P-B03 — Prior-volume context

- **Purpose:** compare current dose with accustomed training volume.
- **Units:** ratio or difference in effective weekly sets.
- **Recommended value:** no fixed ratio; the 1.2 protocol in E-B09 must not be
  generalized.
- **Evidence:** E-B09, E-A12.
- **Confidence:** LOW.
- **Fallback:** absent history leaves comparison unavailable.
- **Decision:** **DEFER** as production modifier; retain context for later
  validation/personalization.

### P-B04 — Retraining / muscle-memory modifier

- **Purpose:** accelerate muscle reacquisition after detraining.
- **Units:** dimensionless.
- **Recommended value / range:** none.
- **Evidence:** E-B10–E-B13.
- **Confidence:** LOW for biological memory; INSUFFICIENT for hypertrophy
  magnitude or time constant.
- **Missing-data fallback:** no bonus.
- **Decision:** **DEFER**.

### P-B05 — Acute MPS-to-muscle conversion

- **Purpose:** derive chronic muscle gain from post-workout MPS.
- **Evidence:** E-B02, E-B03, E-B07.
- **Confidence:** HIGH that early acute MPS is not a valid direct conversion.
- **Decision:** **REJECT**.

## Topic C — detraining and reduced training

### P-C01 — Cessation-associated muscle-loss behavior

- **Purpose:** represent actual skeletal-muscle loss after training stops.
- **Units:** state/direction over weeks; no kg/day rate approved.
- **Representation:** no instantaneous tissue step; non-decreasing loss risk
  with sustained cessation after separating glycogen/water.
- **Recommended value / bounds:** none.
- **Population:** healthy young and older adults; trained-athlete directness low.
- **Conditions / time scale:** multi-week cessation.
- **Evidence:** E-C01, E-C02, E-C08.
- **Confidence:** MODERATE for eventual loss; LOW for onset/shape/rate.
- **Directness:** regional/fiber proxies, extrapolated to total muscle kg.
- **Missing input:** unknown workout coverage must not be treated as cessation.
- **Sensitivity:** very high; false atrophy can absorb water/glycogen changes.
- **Decision:** **IMPLEMENT** cessation state and qualitative time ordering;
  **DEFER** decay constant, grace period, and loss cap.

### P-C02 — Reduced-training maintenance

- **Purpose:** avoid predicting atrophy when meaningful loading continues.
- **Units:** current effective dose relative to prior dose.
- **Representation:** validated nonzero loading must not automatically be
  treated as complete cessation; the size of a maintenance region remains
  unknown and age/status dependent.
- **Recommended value:** none; one-third/one-ninth fractions in E-C04 are
  protocol results, not universal thresholds.
- **Evidence:** E-C04, E-C05.
- **Confidence:** MODERATE for existence; LOW for threshold.
- **Missing history:** do not infer a ratio; use current-dose evidence only.
- **Decision:** **IMPLEMENT** the categorical distinction between validated
  nonzero loading and cessation; **DEFER** maintenance magnitude and threshold.

### P-C03 — Strength-derived atrophy

- **Purpose:** infer muscle mass from strength decline.
- **Evidence:** E-C03, E-B13.
- **Confidence:** HIGH that strength includes neural/skill components.
- **Decision:** **REJECT**.

### P-C04 — Early detraining morphology-to-tissue conversion

- **Purpose:** map early ultrasound/DXA/scale decline to muscle tissue.
- **Evidence:** E-C02, E-C08; glycogen evidence deferred to Topics F–I.
- **Confidence:** INSUFFICIENT.
- **Decision:** **REJECT** direct conversion; maintain separate compartments.

### P-C05 — Retraining acceleration

- **Purpose:** accelerate muscle reacquisition after resumption.
- **Recommended value:** none.
- **Evidence:** E-C06, E-C07, E-B13.
- **Confidence:** INSUFFICIENT for magnitude.
- **Decision:** **DEFER**.

## Topic D — protein

### P-D01 — Protein adequacy for training-mediated muscle gain

- **Purpose:** make protein directly affect muscle adaptation.
- **Units:** g protein/kg body mass/day.
- **Representation:** over studied low-to-adequate population intakes, higher
  protein must not worsen expected training adaptation; a plateau is allowed
  and the population breakpoint is not a switch.
- **Recommended value:** central population estimate 1.62 g/kg/day; uncertainty
  range 1.03–2.20 g/kg/day.
- **Plausible range / bound:** studied meta-regression range approximately
  0.9–2.4 g/kg/day; no benefit extrapolation above evidence.
- **Population:** healthy adults performing resistance training, ≥6 weeks;
  mixed age/status.
- **Conditions / time scale:** rolling intake over multi-week training, not one
  meal or one day.
- **Evidence:** E-D01; consistency E-D02, E-D03.
- **Confidence:** MODERATE; direct for FFM/local size, extrapolated to
  `skeletalMuscleKg`.
- **Missing-data fallback:** unknown/neutral with widened uncertainty; never zero.
- **Sensitivity:** high; breakpoint CI is wide.
- **Decision:** **IMPLEMENT** non-worsening low-to-adequate intake behavior;
  **DEFER** exact curve, plateau location, and coefficient.
- **Open:** rolling-window length; whole-body muscle calibration.

### P-D02 — Protein effect during energy deficit

- **Purpose:** modify skeletal-muscle retention/gain under deficit.
- **Units:** g/kg body mass/day interacting with deficit state.
- **Representation:** higher adequate protein must not worsen retention; effect
  may be more important under severe deficit, but no universal multiplier.
- **Recommended value / range:** none. Trial contrasts 1.0–1.2 versus 2.3–2.4
  g/kg/day under ~40% deficits are scenario evidence, not thresholds.
- **Evidence:** E-D04–E-D07, E-D10.
- **Confidence:** MODERATE for direction; LOW for shape/amount.
- **Missing:** unknown/neutral, not deficient.
- **Decision:** **IMPLEMENT** monotonic retention interaction; **DEFER** numeric
  deficit multiplier and requirement.

### P-D03 — FFM-denominator protein target

- **Purpose:** account for leanness in dieting athletes.
- **Units:** g/kg FFM/day.
- **Evidence:** E-D07.
- **Confidence:** LOW; small inferential review and FFM input may be noisy.
- **Decision:** **DEFER**.

### P-D04 — Protein timing/distribution modifier

- **Purpose:** alter chronic muscle gain by pre/post timing or meal distribution.
- **Evidence:** E-D08, E-D09.
- **Confidence:** MODERATE that independent long-term effect is unproven/small.
- **Fallback:** total daily intake only.
- **Decision:** **REJECT** for v7.

### P-D05 — Very-high-protein hypertrophy bonus

- **Purpose:** continue increasing gain above adequate intake.
- **Evidence:** E-D01–E-D03.
- **Confidence:** MODERATE that added benefit plateaus.
- **Decision:** **REJECT** unbounded/continued bonus above supported range.

## Topic E — energy balance

### P-E01 — Deficit suppression of muscle gain

- **Purpose:** reduce expected training-mediated gain under sustained deficit.
- **Units:** average kcal/day deficit interacting with multi-week training.
- **Representation:** monotonic suppression with deficit magnitude; must allow
  recomposition; no hard zero-gain threshold.
- **Recommended value:** none. The ~500 kcal/day meta-regression crossover is a
  population estimate, not a production cutoff.
- **Evidence:** E-E01–E-E04.
- **Confidence:** MODERATE/HIGH for direction; LOW for curve.
- **Missing energy balance:** no modifier; widen uncertainty.
- **Sensitivity:** extremely high.
- **Decision:** **IMPLEMENT** asymmetric directional suppression; **DEFER**
  coefficient and threshold.

### P-E02 — Resistance-training retention during deficit

- **Purpose:** preserve muscle relative to diet-only loss.
- **Units:** interaction between effective training dose and deficit.
- **Representation:** effective resistance training must not worsen expected
  retention and can permit recomposition.
- **Evidence:** E-E02, E-E03, E-E07.
- **Confidence:** HIGH for FFM direction; MODERATE for skeletal muscle.
- **Decision:** **IMPLEMENT** relational interaction; magnitude **DEFER**.

### P-E03 — Surplus hypertrophy modifier

- **Purpose:** increase muscle gain as surplus rises.
- **Units:** kcal/day or percent maintenance.
- **Recommended value / range:** none.
- **Evidence:** E-E05, E-E06.
- **Confidence:** INSUFFICIENT for positive dose response.
- **Decision:** **DEFER**. Maintenance must remain compatible with gain.

### P-E04 — Excess-surplus fat partition

- **Purpose:** prevent large surplus from becoming unlimited muscle.
- **Representation:** once muscle response is bounded by training/status,
  additional positive energy primarily increases fat storage.
- **Evidence:** E-E06.
- **Confidence:** MODERATE direction, LOW quantitative.
- **Decision:** **DEFER** the partition ordering and numeric breakpoint. The
  statement remains a low-confidence modeling expectation, not a production
  invariant.

### P-E05 — Symmetric deficit/surplus multiplier

- **Purpose:** mirror one equation around energy balance.
- **Evidence:** E-E01, E-E05, E-E06.
- **Confidence:** HIGH that evidence is asymmetric.
- **Decision:** **REJECT**.

### P-E06 — Body-fat partition modifier

- **Purpose:** change muscle/fat partition by baseline adiposity.
- **Evidence:** E-E02–E-E04; indirect/confounded.
- **Confidence:** INSUFFICIENT quantitatively.
- **Decision:** **DEFER**.

## Topic F — resistance-training glycogen depletion

### P-F01 — Resistance-workout glycogen demand

- **Purpose:** subtract glycogen after a strength workout.
- **Units:** desired production unit kg glycogen/workout; evidence reports local
  mmol/kg dry muscle.
- **Representation:** bounded nonnegative depletion driven by recruited-muscle
  hard sets and duration; exact conversion unavailable.
- **Recommended evidence value:** local mean −104.3 mmol/kg dry mass
  (approximately −21%), 95% CI −137.6 to −71.0; prediction interval −244.4 to
  +35.7. **Not approved as whole-body value.**
- **Bounds:** 0 ≤ depletion ≤ available glycogen in recruited tissue; recruited
  fraction unresolved.
- **Population:** predominantly men; vastus lateralis; varied status.
- **Evidence:** E-F01–E-F04.
- **Confidence:** HIGH that depletion occurs; LOW for individual/local amount;
  INSUFFICIENT for whole-body kg.
- **Missing program:** do not infer from HR; workout energy/duration alone is
  insufficient for muscle allocation.
- **Sensitivity:** extreme due dry-mass-to-whole-body conversion.
- **Decision:** **DEFER** numeric production transition; preserve qualitative
  contract for future implementation.

### P-F02 — Set-volume depletion ordering

- **Purpose:** order glycogen demand among otherwise matched sessions.
- **Units:** hard sets in recruited muscle.
- **Representation:** in an isolated session with no refeeding, a higher-set
  condition that contains all lower-set work plus additional comparable work is
  expected not to have lower cumulative demand; available-store and protocol
  differences prevent a universal ordering.
- **Evidence:** E-F01.
- **Confidence:** MODERATE.
- **Decision:** **DEFER** production ordering and coefficient; retain the
  tightly conditioned expectation for research-facing checks only.

### P-F03 — Load/intensity depletion multiplier

- **Purpose:** increase demand with %1RM.
- **Evidence:** E-F01.
- **Confidence:** MODERATE that load is confounded with repetitions/work.
- **Decision:** **REJECT** simple positive load multiplier.

### P-F04 — Universal workout-kcal-to-glycogen conversion

- **Purpose:** derive glycogen from active kcal.
- **Evidence:** E-F01–E-F04.
- **Confidence:** HIGH that local recruitment/fuel mix prevent universality.
- **Decision:** **REJECT**.

## Topic G — stair/stepper glycogen depletion

### P-G01 — Stepper glycogen demand

- **Purpose:** subtract glycogen after stair/stepper exercise.
- **Units:** kg glycogen/workout.
- **Representation:** nonnegative, state-bounded demand. Duration and relative
  intensity are relevant context, but direct stepper evidence does not validate
  a strict substrate ordering.
- **Recommended value / range:** none; no direct stepper glycogen study found.
- **Evidence:** E-G01–E-G08.
- **Confidence:** HIGH for carbohydrate-use direction in aerobic exercise;
  LOW for stepper transfer; INSUFFICIENT for kg.
- **Directness:** direct only for stair energy/intensity; substrate behavior
  extrapolated from cycling/general physiology.
- **Missing HR/kcal:** duration+MET may estimate energy (Topic K) but not
  glycogen fraction.
- **Sensitivity:** high; blood glucose versus muscle/liver glycogen unresolved.
- **Decision:** **DEFER** numeric transition.

### P-G02 — Stepper intensity ordering

- **Purpose:** use HR-derived relative intensity to order carbohydrate demand.
- **Representation:** at matched duration/conditions, higher relative intensity
  must not predict lower carbohydrate reliance.
- **Evidence:** E-G05, E-G06; stepper intensity direct E-G01–E-G04.
- **Confidence:** LOW because substrate behavior is transferred from
  cycling/general aerobic evidence rather than direct stepper measurement.
- **Decision:** **DEFER**. Retain only a low-confidence research expectation;
  do not make it a production RED invariant.

### P-G03 — Universal active-kcal glycogen fraction

- **Purpose:** convert active energy to glycogen depletion.
- **Evidence:** E-G05–E-G08.
- **Confidence:** HIGH that fuel source varies with intensity, duration, diet,
  training, and mode.
- **Decision:** **REJECT**.

## Topic H — glycogen repletion

### P-H01 — Daily carbohydrate-driven glycogen repletion

- **Purpose:** refill aggregate glycogen after exercise.
- **Units:** desired kg/day; evidence reports g carbohydrate/kg body mass and
  local mmol/kg muscle.
- **Representation:** monotonic with available carbohydrate and depletion;
  diminishing as capacity is approached; capacity-bounded.
- **Recommended values:** no kg coefficient. Short-recovery evidence used
  ~1.02±0.4 g carbohydrate/kg/hour; one small 24-hour trial restored baseline
  with 7–10 but not 5 g/kg/day after deep depletion. These are scenarios, not
  production thresholds.
- **Evidence:** E-H01–E-H05.
- **Confidence:** HIGH for direction/state dependence; LOW for aggregate amount.
- **Missing carbohydrate:** unknown/neutral with wider uncertainty, not zero.
- **Sensitivity:** high due local-to-whole-body conversion and unknown capacity.
- **Decision:** **IMPLEMENT** qualitative/bounded transition; **DEFER** exact
  kg/day rate and curve.

### P-H02 — Intra-day timing modifier

- **Purpose:** accelerate refill when carbohydrate is consumed immediately.
- **Evidence:** E-H01, E-H03.
- **Confidence:** HIGH within ≤8-hour recovery; LOW relevance to once-daily
  state.
- **Fallback:** use daily total.
- **Decision:** **DEFER** for v7 daily simulation.

### P-H03 — Protein glycogen bonus

- **Purpose:** add repletion from protein independent of energy/carbohydrate.
- **Evidence:** E-H01, E-H06.
- **Confidence:** HIGH that no independent matched-energy benefit is established.
- **Decision:** **REJECT**.

### P-H04 — Glycogen capacity

- **Purpose:** upper-bound repletion.
- **Units:** kg glycogen.
- **Recommended value:** no personal capacity; Topic I retains 0.3–0.86 kg only
  as contextual adult metadata, not a plausibility bound or clamp.
- **Evidence:** E-H02, E-H05 and P-I02 evidence.
- **Decision:** **DEFER** user-specific/default capacity; see P-I02 for audit
  behavior.

## Topic I — glycogen-associated water and capacity

### P-I01 — Glycogen-associated water ratio

- **Purpose:** reconstruct body weight attributable to hydrated glycogen.
- **Units:** kg water/kg glycogen.
- **Representation:** uncertain positive co-variation, not an exact scalar or
  a validated hard interval.
- **Recommended range:** approximately **3–4 kg/kg** as a typical contextual
  prior only.
- **Bounds:** none scientifically approved; water beyond a selected associated
  component must not automatically be classified as glycogen water.
- **Population:** human depletion/loading/recovery studies; sparse and small.
- **Time scale:** coupled immediately to modeled glycogen state for mass
  accounting, while physiological equilibration is not separately parameterized.
- **Evidence:** E-I01, E-I04, E-I05, E-I07.
- **Confidence:** MODERATE for approximate population co-variation; LOW for an
  individual value and INSUFFICIENT for a hard bound.
- **Directness:** total/muscle water co-variation, not direct molecular binding.
- **Missing-data fallback:** preserve uncertainty; no user input expected.
- **Sensitivity:** high for scale-weight prediction.
- **Decision:** **IMPLEMENT** uncertain positive accounting co-variation;
  **DEFER** any hard 3–4 bound and **REJECT** an exact current-style 2.7 scalar
  unless independently justified.
- **Open:** deterministic uncertainty policy for rebuilds.

### P-I02 — Aggregate adult glycogen physiological envelope

- **Purpose:** constrain whole-body glycogen state.
- **Units:** kg glycogen.
- **Recommended envelope:** muscle 0.3–0.7 kg plus liver 0–0.16 kg; aggregate
  broad envelope **0.3–0.86 kg**.
- **Evidence:** E-I06.
- **Confidence:** MODERATE as broad adult descriptor; LOW as individual bound.
- **Conditions:** varies with muscle mass, body size, diet, training, recent
  exercise; supercompensation context can challenge ordinary range.
- **Fallback:** do not select midpoint as a naked default.
- **Decision:** **DEFER**. The 0.3–0.86 kg range is contextual metadata only,
  never a pass/fail threshold, clamp, user-specific capacity, or default.

### P-I03 — Glycogen water assigned to ECF

- **Purpose:** place associated water in extracellular-fluid deviation.
- **Evidence:** E-I02–E-I05.
- **Confidence:** MODERATE that much loading water is intracellular.
- **Decision:** **REJECT** double counting in ECF; keep accounting companion
  distinct from transient extracellular water.

### P-I04 — Glycogen/lean-measurement conversion

- **Purpose:** infer new skeletal muscle from acute DXA/MRI/ultrasound change.
- **Evidence:** E-I02, E-I03, E-I05.
- **Confidence:** HIGH that glycogen/water confounds acute size/lean outcomes.
- **Decision:** **REJECT**.

## Topic J — post-resistance transient water

### P-J01 — Immediate post-exercise fluid shift

- **Purpose:** represent short-lived pump/metabolic water after resistance work.
- **Units:** desired kg; evidence reports local MRI/ultrasound changes.
- **Representation:** nonnegative finite component, generally rapid resolution
  in accustomed/concentric contexts.
- **Recommended amplitude / decay:** none.
- **Evidence:** E-J01, E-J03, E-J06.
- **Confidence:** HIGH for existence; INSUFFICIENT for whole-body kg/half-life.
- **Decision:** **DEFER** numeric implementation; classification/ordering
  **IMPLEMENT**.

### P-J02 — Delayed damage-edema component

- **Purpose:** represent multi-day water after unaccustomed/eccentric loading.
- **Units:** desired kg over days.
- **Representation:** delayed peak possible; nonnegative; decays to zero; broad
  duration from ~1–5 days in moderate studies, longer after extreme eccentric
  protocols.
- **Evidence:** E-J02–E-J05, E-J07.
- **Confidence:** HIGH for time-course heterogeneity; INSUFFICIENT for amplitude
  and universal kernel.
- **Decision:** **DEFER** numeric implementation; broad time-window claims
  **IMPLEMENT**.

### P-J03 — Novelty/repeated-bout modifier

- **Purpose:** reduce damage-water response after recent exposure.
- **Units:** categorical accustomed/novel state.
- **Recommended value:** no multiplier.
- **Evidence:** E-J05, E-J06, E-J08.
- **Confidence:** HIGH for the local repeated-bout direction, MODERATE/LOW for
  transfer to BodyCast water state and individual ordering.
- **Missing history:** unknown novelty, not maximally novel.
- **Decision:** **DEFER** deterministic production ordering and coefficient;
  prior exposure may lower expected markers/edema on average.

### P-J04 — Eccentric-loading modifier

- **Purpose:** increase delayed edema likelihood/duration.
- **Units:** categorical emphasis; exact eccentric dose unavailable from typical
  workout records.
- **Evidence:** E-J03, E-J05, E-J07.
- **Confidence:** HIGH for local protocol direction, MODERATE/LOW for whole-body
  water applicability.
- **Decision:** **DEFER** deterministic production ordering and multiplier;
  eccentric emphasis remains contextual evidence.

### P-J05 — Sets-to-transient-water coefficient

- **Purpose:** convert resistance sets to kg water.
- **Evidence:** E-J01–E-J06.
- **Confidence:** INSUFFICIENT; local effects conflict by training status.
- **Decision:** **REJECT** as universal coefficient.

## Topic K — stepper energy expenditure and HR

### P-K01 — Stepper active-energy source hierarchy

- **Purpose:** choose workout active kcal.
- **Units:** net/active kcal per workout.
- **Representation:** provenance-aware hierarchy: device active kcal → HR-
  assisted modality estimate → broad MET fallback.
- **Recommended value:** none; source is an observation/estimate.
- **Evidence:** E-K01–E-K05, E-K09, E-G01–E-G03.
- **Confidence:** LOW/MODERATE; hierarchy is a pragmatic information policy,
  not proven universal accuracy ranking.
- **Missing fallback:** any progression through the proposed hierarchy is
  `ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER`; unknown if duration is
  absent.
- **Sensitivity:** high because EE drives energy balance.
- **Decision:** **DEFER** the hierarchy as a scientific accuracy ordering. It
  may be retained only as `ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER`,
  with provenance and uncertainty exposed.
- **Open:** device-specific bias calibration; disagreement policy.

### P-K02 — Wearable active-kcal uncertainty

- **Purpose:** prevent device estimate from being treated as exact.
- **Representation:** low-confidence observation with device/activity-specific
  uncertainty; no single percent error bound.
- **Evidence:** E-K01, E-K02.
- **Confidence:** HIGH that error is often material.
- **Decision:** **IMPLEMENT** uncertainty label; numeric error distribution
  **DEFER**.

### P-K03 — HR-assisted stepper intensity

- **Purpose:** improve fallback intensity selection.
- **Units:** relative HR/HR reserve over covered duration.
- **Representation:** time-weighted relative-intensity evidence; a valid,
  current, modality-relevant personal calibration may improve informativeness,
  but HR is not direct kcal.
- **Evidence:** E-K03–E-K05, E-K09, E-G03.
- **Confidence:** MODERATE for steady-state ordering; LOW for individual kcal
  without calibration.
- **Missing resting/max HR:** use broader modality uncertainty, not fabricated
  HR reserve.
- **Decision:** **IMPLEMENT** conditional use of current modality-relevant
  personal calibration; **DEFER** uncalibrated intensity rules and exact HR-kcal
  equations.

### P-K04 — HR sampling adequacy

- **Purpose:** determine if ~2-minute samples represent the workout.
- **Units:** temporal coverage/gap descriptors.
- **Recommended thresholds:** none scientifically validated.
- **Evidence:** E-K09; indirect.
- **Decision:** **DEFER** numeric threshold. Any chosen gap/coverage cutoff is
  `ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER`.

### P-K05 — Average/max-HR calorie conversion

- **Purpose:** estimate kcal from summary HR only.
- **Evidence:** E-K03–E-K05, E-K09.
- **Confidence:** HIGH that max lacks duration and averages hide variability.
- **Decision:** **REJECT** as standalone exact conversion.

### P-K06 — Stepper MET fallback

- **Purpose:** estimate active energy from duration and body mass.
- **Units:** gross MET requiring explicit net/resting conversion.
- **Plausible protocol anchors:** 8.6–9.6 gross MET for continuous stair ascent
  in E-G01/E-G02; not a machine-wide bound.
- **Evidence:** E-G01–E-G03.
- **Confidence:** MODERATE for vigorous ascent, LOW for individual/device.
- **Decision:** **IMPLEMENT** only the invariant that, for the same mechanical
  protocol and efficiency assumptions, gross energy is non-decreasing with
  duration; **DEFER** broad MET values and treat body-mass scaling as an
  estimate, while a universal fixed MET is **REJECT**.

### P-K07 — Active/gross energy semantic

- **Purpose:** prevent resting-energy double counting.
- **Representation:** every source tagged active/net or gross; normalize before
  use.
- **Evidence:** E-G01/E-G02 report gross; wearable sources evaluate proprietary
  EE semantics.
- **Confidence:** HIGH as energy-accounting requirement.
- **Decision:** **IMPLEMENT** invariant.

## Topic L — resistance-training heart rate

### P-L01 — HR as anabolic-dose multiplier

- **Purpose:** modify skeletal-muscle gain from workout HR.
- **Units:** candidate multiplier from average/max/zone HR.
- **Evidence:** E-A03, E-L02–E-L08 and Topic A.
- **Confidence:** HIGH that independent causal calibration is unsupported.
- **Decision:** **REJECT**.

### P-L02 — Program-derived anabolic dose

- **Purpose:** preserve separation of local resistance stimulus from cardiac
  demand.
- **Representation:** effective sets/program structure/recruitment/effort;
  missing HR does not reduce anabolic dose.
- **Evidence:** E-A03 and Topic A evidence.
- **Confidence:** HIGH.
- **Decision:** **IMPLEMENT** structural invariant.

### P-L03 — Resistance-workout HR auxiliary signal

- **Purpose:** detection, cardiovascular display, data-quality context, or
  energy-estimation support.
- **Units:** bpm/time series with device provenance.
- **Evidence:** E-L02–E-L04, E-L07, E-L08.
- **Confidence:** MODERATE.
- **Missing fallback:** no physiological penalty.
- **Decision:** **IMPLEMENT** only outside anabolic-dose calculation.

### P-L04 — Resistance wrist-HR error

- **Purpose:** represent motion/exercise-specific measurement uncertainty.
- **Pooled anchor:** mean bias −7.26 bpm (95% CI −10.46 to −4.07) in E-L07;
  not a universal correction.
- **Evidence:** E-L07, E-L08.
- **Confidence:** MODERATE due device/protocol heterogeneity.
- **Decision:** uncertainty awareness **IMPLEMENT**; fixed correction
  **REJECT**.

### P-L05 — HRV/readiness hypertrophy modifier

- **Purpose:** modify gain based on autonomic recovery.
- **Evidence:** E-L05, E-L06.
- **Confidence:** LOW/MODERATE; two small null RCTs do not prove equivalence but
  provide no benefit estimate.
- **Decision:** **REJECT** for v7.

## Topic M — sleep

### P-M01 — Multi-night sleep-duration muscle modifier

- **Purpose:** modify expected muscle adaptation under sustained restriction.
- **Units:** candidate function of sleep duration/history.
- **Evidence:** E-M01–E-M04.
- **Confidence:** MODERATE/HIGH for adverse acute mechanisms under severe
  restriction; LOW for chronic dose-response and kg outcome.
- **Recommended coefficients/thresholds:** none.
- **Missing sleep:** unknown, not zero sleep and not a penalty.
- **Decision:** **DEFER** numerical production effect; adverse-direction
  guardrail **IMPLEMENT**.

### P-M02 — Single-night sleep multiplier

- **Purpose:** change daily muscle gain after one poor night.
- **Evidence:** E-M02.
- **Confidence:** INSUFFICIENT for chronic kg conversion.
- **Decision:** **REJECT**.

### P-M03 — Sleep × energy-deficit partition modifier

- **Purpose:** alter fat versus lean loss during dieting.
- **Evidence:** E-M03.
- **Confidence:** MODERATE for adverse direction at 5.5 versus 8.5 hours over
  14 days; VERY LOW for skeletal-muscle-specific magnitude.
- **Decision:** **DEFER** the skeletal-muscle/partition interaction and numeric
  coefficient. The single n=10 DXA trial supports only a low-certainty
  directional research hypothesis.

### P-M04 — Wearable total-sleep-duration input

- **Purpose:** characterize multi-night sleep exposure.
- **Units:** hours/night with device/provenance.
- **Evidence:** E-M05, E-K01, E-M07.
- **Confidence:** MODERATE for trend/context, lower for a single night.
- **Representation:** retain raw duration and uncertainty; do not label PSG.
- **Decision:** contextual input **IMPLEMENT**; direct physiology coefficient
  **DEFER**.

### P-M05 — REM/Core/Deep physiology modifiers

- **Purpose:** alter muscle/body composition by consumer stage minutes.
- **Evidence:** E-M05, E-K01, E-M07.
- **Confidence:** HIGH that measurement agreement is inadequate for stable
  quantitative use; physiological causal calibration also absent.
- **Decision:** **REJECT** for v7.

### P-M06 — Sleep-debt threshold/decay constant

- **Purpose:** aggregate night-to-night restriction and recovery.
- **Units:** hours and days.
- **Evidence:** E-M01–E-M04.
- **Recommended value:** none.
- **Decision:** **DEFER**. Any temporary implementation constant is
  `ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER`.

## Topic N — EPOC

### P-N01 — Separate workout EPOC add-on

- **Purpose:** add recovery kcal after strength/stepper workouts.
- **Units:** active kcal over hours/days.
- **Evidence:** E-N01–E-N07.
- **Plausible study observations:** typically tens of kcal in measured
  protocols; heterogeneous and not a personal bound.
- **Confidence:** HIGH that EPOC exists; LOW for transferable prediction.
- **Sensitivity:** additive double-counting across repeated workouts.
- **Decision:** **REJECT** for v7.

### P-N02 — Workout-kcal percentage for EPOC

- **Purpose:** infer EPOC as fixed percentage of exercise energy.
- **Evidence:** E-N01–E-N07.
- **Confidence:** INSUFFICIENT across modalities/protocols.
- **Decision:** **REJECT**.

### P-N03 — Post-workout active-energy overlap

- **Purpose:** avoid counting observed recovery energy plus modeled EPOC.
- **Representation:** time/source provenance; each interval counted once.
- **Evidence:** E-N07 plus energy conservation; wearable semantics unresolved.
- **Confidence:** HIGH accounting principle.
- **Decision:** **IMPLEMENT** invariant.

### P-N04 — Future mode/intensity EPOC model

- **Purpose:** allow later explicit recovery-energy prediction.
- **Requirements:** validated modality, workload/intensity, baseline subtraction,
  duration curve, training status, and nonoverlap with measured active energy.
- **Evidence:** E-N01–E-N07.
- **Decision:** **DEFER** beyond v7.

## Independent-audit disposition summary

- **Revised IMPLEMENT records:** P-A02, P-B01, P-C02, P-D01, P-I01, P-K03,
  P-K06.
- **Downgraded IMPLEMENT → DEFER:** P-E04, P-F02, P-G02, P-I02, P-J03, P-J04,
  P-K01, P-M03.
- **Corrected primary-decision totals (70 records):** **21 IMPLEMENT, 27 DEFER,
  22 REJECT**.
- Any retained fallback, clamp, source order, sampling threshold, midpoint,
  smoothing window, or coefficient lacking direct support is
  `ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER`.











