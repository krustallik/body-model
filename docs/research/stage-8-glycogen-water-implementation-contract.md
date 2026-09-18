# Stage 8A — glycogen and water implementation contract audit

Status: audit/contract only, 2026-09-18. This document applies the approved
v7 evidence record and independent audit; it does not add a glycogen/water
transition, alter scientific-claim status, modify production physiology, or add
a database migration.

## 1. Canonical v7 state semantics

`PhysiologyV7State` already structurally exposes the following independent
mass compartments, all in kg:

| State field | Current type / validation | Stage-8 canonical interpretation |
|---|---|---|
| `fatMassKg` | finite, nonnegative | independent fat mass; unchanged here |
| `skeletalMuscleKg` | finite/nonnegative or `null` | separate muscle tissue; never a glycogen or water target |
| `otherLeanTissueKg` | finite, nonnegative | non-muscle lean tissue; no glycogen-water changes may be moved here |
| `glycogenKg` | finite, nonnegative | **modeled aggregate body glycogen mass** (muscle plus liver combined), not a measured local store, not a fraction of a universal capacity |
| `glycogenWaterKg` | finite, nonnegative | selected associated-water accounting companion to `glycogenKg`, distinct from ECF and transient water |
| `ecfDeviationKg` | finite, signed | change from a separately defined ECF baseline only; never a residual bucket |
| `transientExerciseWaterKg` | finite, nonnegative | workout-associated transient water only, never glycogen water or tissue |

The current v7 structural contract has no provenance fields for individual
compartments and no executable v7 transition. `skeletalMuscleKg` may be `null`;
all other listed components are numeric. `reconstructPhysiologyV7MassKg` returns
`null` when skeletal muscle is unavailable; otherwise it sums every listed
component exactly once. `ecfDeviationKg` is intentionally signed.

The one aggregate glycogen field cannot identify muscle versus liver glycogen.
The evidence is sufficient to label this as an aggregate *model state*, but not
to infer an individual muscle/liver split. Future workout depletion therefore
must not silently imply that a whole-body pool represents recruited-muscle
availability.

## 2. Current source-data inventory

| Domain | Durable/current source | Availability and provenance | Stage-8 consequence |
|---|---|---|---|
| Nutrition | `DailyHealthData` and immutable `HealthSyncSnapshot`: `caloriesKcal`, `proteinG`, `fatG`, **`carbsG`** | Each is nullable. Simulation input can retain observed values, bridge nutrition with explicit observed/imputed provenance, or leave it unavailable. | Carbohydrate grams/day are available when supplied; missing carbs are unknown, never zero and never calories-derived. |
| Body | `weightKg`, `bodyFatPercent`; v6 persisted `leanTissueKg` model state | Health observations are nullable. Generic lean tissue is a v6 modeled compartment, not skeletal muscle or a glycogen observation. | Useful later for whole-mass validation only; no lean→glycogen/muscle conversion. |
| Strength | Immutable StrengthSet records, sessions, mapping snapshots; `QualifiedResistanceTrainingDoseV7`; exposure history | Recorded reps, load context, optional RIR, qualified hard-set count, mapped muscle groups, duration only if matched workout, and explicit unresolved/legacy states. HR is contextual only. | Strong source evidence for local exercise context, insufficient for kg aggregate depletion. Tonnage and HR remain excluded from a depletion multiplier. |
| Stepper/stair | Workout interval/duration, device active energy, bracketed Health snapshots, derived step delta/rate, HR context, MS100 assignment/reference facts | Bracketed steps/rate are derived with explicit edge-gap limitations. Garmin energy is `device-estimate`, active semantics; HR can be unavailable/loaded. MS100 references are targets for energy calibration, not physiology. | Enough to preserve event/context and active-energy provenance; not enough for a glycogen fraction or mechanical-resistance inference. |
| Dates/coverage | Local calendar simulation days; `workoutFeedObserved`, snapshots, durable workouts | Feed observed/no workout differs from absent or legacy feed. | No workout must not create depletion; unknown feed must remain unknown, not rest. |

Apple Health can provide body weight/fat, nutrition values, workouts, and HR
samples. It does not provide raw Xiaomi impedance through this contract. The Mi
Body Composition Scale 2 “muscle mass” must not be ingested as
`skeletalMuscleKg`.

## 3. Existing v6 behavior is not a v7 approval

The legacy Hall/NIDDK body-composition path currently has a numeric glycogen
ODE, a default `initialGlycogenKg: 0.5`, and fixed
`GLYCOGEN_WATER_KG_PER_KG: 2.7`. It reconstructs v6 `leanTissueKg + glycogen +
2.7×glycogen + ECF`. These are legacy v6 model assumptions. The approved v7
record explicitly rejects importing the 0.5 kg default, a universal capacity,
or a fixed 2.7/3/4 water ratio as a v7 scientific claim.

## 4. Mechanism decisions

### Initialization

No approved individualized absolute glycogen initialization exists. The
descriptive 0.3–0.86 kg adult aggregate envelope (P-I02/E-I06) is contextual
metadata only, not a default, clamp, or personal capacity. It varies with body
size, muscle mass, diet, recent exercise, and supercompensation. Because
`skeletalMuscleKg` may be unavailable, it cannot be required to initialize the
pool.

**Decision:** 8B may define an explicit supplied/uncertain initialization
interface, but must return unavailable/blocked when no justified initial pool
or capacity is supplied. It must not choose a midpoint or derive one from body
weight, generic lean tissue, calories, or skeletal muscle.

### Resistance-training depletion

P-F01 establishes that recruited local muscle glycogen falls after resistance
exercise (mean local concentration −104.3 mmol/kg dry muscle; heterogeneous and
not whole-body kg). Hard sets, mapped muscles, and duration are valid context.
P-F02's contained-session ordering remains research-only; the audit downgraded
it to DEFER for production. P-F03 rejects a simple load multiplier and P-F04
rejects active-kcal→glycogen conversion.

**Decision:** no quantitative aggregate `glycogenKg` depletion in 8B from
strength inputs. Preserve qualified dose/mapping/unresolved evidence for a
future source-aware demand contract. Qualitative claims/invariants can state
that a valid exercise-only demand is nonpositive and store-bounded only when a
future demand is explicitly supplied; they cannot fabricate a demand from sets.

### Stepper depletion

There is no direct stepper/stair glycogen-depletion study. Duration and protocol
intensity support energy context, while aerobic substrate evidence transfers
only indirectly. P-G01 and P-G02 are DEFER; P-G03 rejects a universal
active-kcal glycogen fraction. Garmin active calories must retain device-estimate
provenance, and step delta/rate is not machine mechanical work.

**Decision:** no quantitative stepper glycogen depletion in 8B. Keep source
facts available for later research/calibration; do not use HR, duration, step
rate, body mass, or Garmin kcal to manufacture a glycogen rate.

### Repletion

P-H01 is approved **qualitative** logic: with the same depleted state and
recovery interval, more observed carbohydrate does not reduce refill
opportunity; repletion is depletion- and capacity-dependent. It has no approved
aggregate kg/day curve. Carbohydrate timing is DEFER at daily resolution
(P-H02); protein adds no independent energy-matched bonus (P-H03 REJECT); a
personal/default capacity is DEFER (P-H04).

**Decision:** `carbsG` is a real nullable source. Numeric repletion is blocked
unless an explicit capacity and an approved aggregate rate/curve are separately
introduced. `carbsG: null` must propagate unavailable repletion, not `0 g` or a
calorie-derived estimate.

### Glycogen-associated water

P-I01 is approved for uncertain positive population co-variation only. Its
typical contextual range is approximately 3–4 kg water/kg glycogen; it is not a
fixed molecular ratio, individual estimate, hard bound, or clipping policy.
P-I03 rejects assigning the same water to ECF; P-I04 rejects interpreting
glycogen/water changes as lean or muscle tissue. P-I02's aggregate envelope is
DEFER contextual metadata.

**Decision:** 8C can implement an explicitly parameterized, deterministic
rebuildable *accounting policy* only if its uncertainty policy is supplied and
output records that the relation is an uncertain co-variation. It must keep
`glycogenWaterKg` separate and cannot use a fixed universal default ratio.

### Transient exercise water

P-J01/P-J02 support local acute/delayed phenomena and broad heterogeneous timing,
but not whole-body kg amplitude or universal decay kernel. P-J03/P-J04
(novelty/repeated-bout and eccentric modifiers) are DEFER because ordinary
records cannot reliably identify the response. P-J05 rejects sets→kg water.

**Decision:** 8D can establish cause/provenance and unavailable/qualitative
state semantics, but no numeric transient-water transition is currently
approved. Strength and stepper must not be assigned the same transient-water
effect; stepper evidence is especially absent.

### ECF deviation

`ecfDeviationKg` may represent only a signed deviation from a defined ECF
baseline, distinct from glycogen-associated (mostly intracellular-context)
water and exercise transient water. Current v7 sources contain no sodium,
hydration, validated ECF measurement, or v7 baseline/transition contract.

**Decision:** 8D must keep ECF carry/contextual only. It must not absorb mass
reconstruction error, glycogen water, workout edema, or missing nutrition.

## 5. Parameter inventory

| Parameter | Decision | Unit / allowed behavior | Evidence | Future consumer |
|---|---|---|---|---|
| P-F01 resistance glycogen demand | DEFER | desired kg/workout; only local mmol/kg dry-muscle evidence | E-F01–F04 | future 8B demand input, never a set coefficient |
| P-F02 set ordering | DEFER | hard sets, tightly conditioned research ordering | E-F01 | future research test only |
| P-F03 load multiplier | REJECT | — | E-F01 | none |
| P-F04 kcal→glycogen | REJECT | — | E-F01–F04 | none |
| P-G01 stepper demand | DEFER | desired kg/workout; no value/range | E-G01–G08 | future calibrated stepper module |
| P-G02 stepper intensity ordering | DEFER | no strict production monotonicity | E-G05–G06 (extrapolated) | research only |
| P-G03 active-kcal fraction | REJECT | — | E-G05–G08 | none |
| P-H01 carb repletion | IMPLEMENT qualitative only | monotonic, depleted-state/capacity dependent; no kg/day coefficient | E-H01–H05 | 8B availability/provenance contract |
| P-H02 timing | DEFER | no daily timing modifier | E-H01/H03 | none in daily model |
| P-H03 protein bonus | REJECT | — | E-H01/H06 | none |
| P-H04 capacity | DEFER | kg, explicit future input only | E-H02/H05, I06 | 8B capacity interface |
| P-I01 associated water | IMPLEMENT uncertain accounting relation | typical 3–4 kg/kg contextual prior, no hard bound/default | E-I01/I04/I05/I07 | 8C water companion policy |
| P-I02 adult envelope | DEFER | 0.3–0.86 kg metadata only | E-I06 | diagnostics/research only |
| P-I03 ECF assignment | REJECT | no double count | E-I02–I05 | invariant |
| P-I04 lean conversion | REJECT | no tissue conversion | E-I02/I03/I05 | invariant |
| P-J01 immediate water | DEFER numeric | local existence; no kg/decay | E-J01/J03/J06 | 8D cause contract |
| P-J02 delayed edema | DEFER numeric | broad 1–5+ day window; no kernel/amplitude | E-J02–J05/J07 | 8D cause contract |
| P-J03 novelty | DEFER | contextual only, no multiplier | E-J05/J06/J08 | later research |
| P-J04 eccentric | DEFER | contextual only, no multiplier | E-J03/J05/J07 | later research |
| P-J05 sets→water | REJECT | — | E-J01–J06 | none |

## 6. Claim map

| Claim(s) | Oracle / current status | Minimum seam | Proposed slice |
|---|---|---|---|
| C-F01/F02/F04/F05 | nonpositive, store bounded, recruitment/modalities distinct; BLOCKED | provenance-bearing supplied-demand/state contract | 8B |
| C-F03 | contained added work does not lower demand; BLOCKED / audit says research-only | only after a direct demand model exists | defer beyond 8E |
| C-G01/G03/G04 | stepper bounded demand / duration-energy / no equal-kcal identity; BLOCKED | stepper substrate calibration, not current sources | defer beyond 8E |
| C-H01 | carb monotonicity; GREEN current isolated contract | preserve; v7 needs source/provenance output | 8B/8E |
| C-H02/H03/H05 | capacity, daily timing, no protein bonus; BLOCKED | explicit capacity and nutrition transition interface | 8B/8E |
| C-I01/I02/I04/MV04 | uncertain co-movement, count once, no tissue conversion, mass conservation; GREEN current isolated contracts | separate v7 water compartment plus accounting output | 8C/8E |
| C-I03/I05 | no extra-water classification; adult range not clamp; BLOCKED | water provenance/diagnostic policy | 8C |
| C-J01–J06 | transient water distinct/time-course-safe claims; BLOCKED | cause provenance and eventually calibrated amplitude/decay | 8D |

No claim is unskipped in 8A. The scientific manifest currently remains 22 GREEN
/ 55 BLOCKED; the runner has 61 skipped specifications because it also includes
full-flow blockers.

## 7. Mass-accounting invariants

For available v7 state:

```text
mass = fatMassKg + skeletalMuscleKg + otherLeanTissueKg
     + glycogenKg + glycogenWaterKg
     + ecfDeviationKg + transientExerciseWaterKg
```

* A glycogen change changes glycogen mass once and its selected associated water
  once; the latter cannot also change ECF or transient-water mass.
* Water from an exercise edema mechanism cannot enter glycogen water or lean/
  skeletal muscle.
* `ecfDeviationKg` is signed but not a balancing residual.
* No numeric component may become negative; reconstruction is unavailable when
  skeletal muscle is unavailable.
* A Stage-7 unavailable muscle transition remains `not-modeled` / carry-forward
  semantics and is unaffected by glycogen/water work.

## 8. Proposed implementation sequence

**8B — source/provenance and glycogen-state boundary (numeric behavior: no).**
Inputs: current aggregate state, `carbsG` with nutrition provenance, qualified
strength/stepper evidence. Outputs: canonical source availability, explicit
unavailable initialization/capacity/repletion/demand decisions, and no made-up
kg delta. Targets source correctness and eventual C-H01 wiring; does not target
F/G numeric claims. Blockers: capacity and kg rates.

**8C — glycogen-associated-water accounting boundary (numeric behavior: only
if an explicit uncertain policy is supplied).** Inputs: glycogen state/change
and policy provenance. Outputs: separate `glycogenWaterKg`, co-variation
uncertainty, no-ECF/no-tissue conversion invariant. Targets I accounting claims.
Blocker: no universal/personal water ratio.

**8D — transient-water and ECF provenance boundary (numeric behavior: no).**
Inputs: workout/mapping/history source facts. Outputs: separate causes and
unavailable numeric amplitude/decay, signed ECF carry/context. Targets J
separation without a pseudo-kg effect. Blockers: whole-body amplitude, decay,
novelty/eccentric observability, ECF source inputs.

**8E — v7 pipeline/rebuild/forecast integration (numeric behavior: only values
that earlier slices can justify).** Inputs: the contracts above. Outputs:
deterministic fingerprints, rebuild provenance, mass invariants, and only
genuinely executable claim activation. Blockers: no v7 persistence/simulator/
forecast entry point and unresolved numeric mechanisms.

## 9. Test-first plan

Future tests must cover: missing versus observed-zero carbohydrate; no exercise
does not invent demand; legacy/unobserved workout semantics remain distinct;
no carb data is not zero carbs; any supplied demand is nonpositive and bounded
by an explicitly supplied store; no negative glycogen; repletion requires
observed carbohydrate and explicit capacity; glycogen-water co-moves under an
explicit policy but has no hard ratio; exact one-time water accounting; ECF
signed semantics; no ECF/transient/glycogen-water double count; mass
reconstruction; deterministic fingerprints/rebuilds; no HR, tonnage, or Garmin
kcal glycogen multiplier; and Stage-7 muscle carry-forward unchanged.

Do not add strength-set or stepper monotonic depletion tests as production
oracles until a whole-body demand transition is calibrated. Do not add transient
decay assertions until an amplitude/kernel is approved.

## 10. Direct answers to blocker questions

| Question | Answer |
|---|---|
| A. Carbohydrate grams/day? | Yes, nullable `carbsG` with observed/imputed/unavailable provenance. |
| B. Numeric repletion now? | No: current sources can provide carbs, but aggregate capacity and kg/day repletion curve are unapproved. |
| C. Numeric strength depletion? | No: local concentration evidence lacks recruited-mass/aggregate conversion. |
| D. Numeric stepper depletion? | No: no direct stepper substrate/depletion calibration. |
| E. Glycogen-water numeric? | Only an explicit uncertain accounting policy is potentially defensible; no fixed ratio/default/clamp. |
| F. Transient exercise water numeric? | No: only local effects and broad timing, no whole-body kg/decay. |
| G. ECF numeric? | Context/carry only: no v7 ECF baseline/input/transition source. |
