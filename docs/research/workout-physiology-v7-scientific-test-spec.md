# BodyCast workout physiology v7 — scientific test specification

**Specification date:** 2026-09-17  
**Research authority:** `docs/research/workout-physiology-v7-evidence.md`  
**Parameter authority:** `docs/research/workout-physiology-v7-parameter-contract.md`  
**Claim authority:** `docs/research/workout-physiology-v7-testable-claims.md`  
**Independent audit:** `docs/research/workout-physiology-v7-independent-audit.md`  
**Machine-readable manifest:** `tests/scientific-v7/scientific-claims.manifest.ts`

## Test architecture audit

BodyCast uses Vitest 3 through the existing `vitest.config.ts`; integration
tests use `vitest.integration.config.ts`. No second runner was introduced.

- **Pure mechanisms:** `src/model/body-composition/state.ts`,
  `src/model/body-composition/glycogen.ts`, and
  `src/model/activity/workout-energy.ts`.
- **Multi-day simulator:** `simulateOneDay` / `simulateDays` in
  `src/model/physiological-simulator.ts`.
- **Canonical historical input:** `buildSimulationDays` in
  `src/modules/model-episodes/simulation-input-builder.ts`.
- **Historical calculation/rebuild:** `calculateEpisodeHistory` and
  `recalculateModelEpisode`; existing conventions are demonstrated in
  `tests/durable-source-rebuild.test.ts` and model-episode tests.
- **Forecast:** `runForecast` / `forecastModelEpisode`; current output exposes
  lean tissue, not the audited v7 skeletal-muscle and transient-water state.

The current production model is `bodycast-physiology-v6`. It has no v7 model
entry point, `skeletalMuscleKg` state, ProgramSnapshot dose contract, workout
glycogen-demand transition, transient exercise-water state, or canonical v7
HR/sleep inputs. Production code was therefore left unchanged.

## Initial classification

- Eligible audited claims: **77**.
- Claims with currently executable, meaningful assertions: **11 — ALREADY
  GREEN**.
- Claims awaiting a required v7 production contract: **66 — INFRASTRUCTURE
  BLOCKED**.
- **EXPECTED RED:** 0. A failure was not manufactured through a fake test-only
  physiology adapter.
- Unsafe claims excluded: **C-G02, C-H04, C-K02, C-M04**.

The runner also contains six skipped full-flow specifications for longitudinal
cohorts, workout/program/nutrition recalculation, forecast scenarios, and E2E.

## Executable claim-to-test mapping

| Claims | Parameters | Evidence | Test name | Type | Initial | Assertion |
|---|---|---|---|---|---|---|
| C-D04 | P-D01 | E-D01–E-D03 | missing protein remains unavailable rather than becoming measured zero | unit | ALREADY GREEN | MISSINGNESS |
| C-H01 | P-H01 | E-H01, E-H05 | more carbohydrate from the same depleted state does not reduce glycogen restoration | property | ALREADY GREEN | MONOTONICITY |
| C-I01 | P-I01 | E-I01, E-I04, E-I05, E-I07 | glycogen-associated water co-moves without asserting a universal ratio | property | ALREADY GREEN | MONOTONICITY |
| C-I02, C-MV04 | P-I03; none | E-I02–E-I05; I/J measurement definitions | body-weight reconstruction counts glycogen-associated mass exactly once | unit/property | ALREADY GREEN | CONSERVATION, NO_DOUBLE_COUNTING |
| C-I04 | P-I04 | E-I01–E-I03, E-I05 | changing glycogen-associated mass does not change lean tissue | unit | ALREADY GREEN | INVARIANT |
| C-K01 | P-K02 | E-K01, E-K02 | device active energy retains estimate provenance | unit | ALREADY GREEN | INVARIANT |
| C-K07 | P-K07 | E-G01, E-G02 | device active energy is counted once without a resting-energy adjustment | unit | ALREADY GREEN | CONSERVATION, NO_DOUBLE_COUNTING |
| C-N01 | P-N01 | E-N01–E-N07 | observed workout active energy receives no automatic EPOC add-on | unit | ALREADY GREEN | INVARIANT, NO_DOUBLE_COUNTING |
| C-N02 | P-N02 | E-N01–E-N07 | workout energy is not multiplied by a universal EPOC percentage | property | ALREADY GREEN | INVARIANT |
| C-N03 | P-N03 | E-N07 | represented workout active-energy interval is counted exactly once | unit | ALREADY GREEN | CONSERVATION, NO_DOUBLE_COUNTING |

All executable tests are in
`tests/scientific-v7/scientific-contract.test.ts`.

## Infrastructure-blocked claim index

Every item below maps to one skipped test in
`tests/scientific-v7/scientific-claims.blocked.test.ts`. Its exact test name,
evidence IDs, parameter IDs, audit eligibility, assertion text, provenance, and
blocker are machine-readable in the manifest.

| Claims | Required production contract | Test types / assertion types |
|---|---|---|
| C-A01–C-A06 | ProgramSnapshot, effective-set/muscle mapping, v7 dose and adaptation outputs | unit/property/integration; MONOTONICITY, INVARIANT, BOUND, SATURATION, MISSINGNESS |
| C-B01–C-B04, C-D01–C-D03, C-D05, C-E01–C-E06 | distinct `skeletalMuscleKg` adaptation state and proxy-safe observation contract | unit/property/integration/longitudinal; ORDERING, BOUND, INVARIANT, LONGITUDINAL |
| C-B05, C-C01–C-C04, C-C06 | training-history, cessation/reduced-dose state, resumption transition | longitudinal; TIME_COURSE, ORDERING, LONGITUDINAL |
| C-C05, C-MV01–C-MV03, C-MV05 | measurement-role/provenance contract separating local, lean, strength, MPS, and skeletal muscle | unit/integration/longitudinal; INVARIANT, ORDERING |
| C-F01–C-F05 | recruited-muscle workout dose connected to glycogen demand | unit/property/integration; BOUND, CONSERVATION, MONOTONICITY, INVARIANT |
| C-G01, C-G03, C-G04 | v7 stepper glycogen-demand seam without a deferred substrate coefficient | unit/property/integration; BOUND, CONSERVATION, MONOTONICITY, INVARIANT |
| C-H02, C-I05 | individualized capacity state; universal 0.3–0.86 kg clamps remain forbidden | unit/property; BOUND, SATURATION, INVARIANT |
| C-H03, C-H05 | explicit daily timing policy and energy-matched protein-substitution input | unit/integration; INVARIANT, NO_DOUBLE_COUNTING |
| C-I03 | water-observation classifier separating associated and other transient water | unit; INVARIANT |
| C-J01–C-J06 | transient exercise-water state with cause provenance and baseline-directed decay | unit/property/longitudinal; INVARIANT, TIME_COURSE, ORDERING, BOUND |
| C-K03–C-K06, C-L01–C-L05 | HR coverage/calibration contract and independently observable anabolic dose | unit/property/integration; ORDERING, INVARIANT, MISSINGNESS, MONOTONICITY |
| C-M01–C-M03, C-M05–C-M07 | sleep duration/device provenance and bounded v7 context output | unit/integration/longitudinal; BOUND, INVARIANT, MISSINGNESS |
| C-N04 | runtime scientific-decision/provenance explanation for omitted EPOC | unit; INVARIANT |

### Full parameter/evidence traceability

The following compact ledger is a human-readable mirror of the manifest. `R`
means SAFE AFTER AUDIT REVISION; `S` means SAFE. All rows are
INFRASTRUCTURE BLOCKED unless listed in the executable table above.

- A: C-A01/R → P-A02 → E-A01,E-A02,E-A03; C-A02/R → P-A03 → E-A02,E-A11,E-A14;
  C-A03/S → P-A01,P-A06 → E-A02,E-A08,E-A10,E-A14; C-A04/R → P-A04 → E-A09,E-A13;
  C-A05/R → P-A05 → E-A04,E-A10; C-A06/S → P-A07 → E-A02,E-A05,E-A06,E-A07,E-A12.
- B: C-B01/R → P-B01 → E-B01,E-B04,E-B05,E-B06; C-B02/S → P-B01 → E-B01,E-B04,E-B06;
  C-B03/S → P-B02 → E-B02,E-B07,E-B08; C-B04/S → P-B05 → E-B02,E-B03,E-B07;
  C-B05/S → P-B04 → E-B10,E-B11,E-B12,E-B13.
- C: C-C01/S → P-C01 → E-C01,E-C02; C-C02/R → P-C01 → E-C01,E-C03;
  C-C03/R → P-C02 → E-C04,E-C05; C-C04/R → P-C02 → E-C04;
  C-C05/S → P-C03 → E-C03,E-B13; C-C06/S → P-C05 → E-C06,E-C07,E-B13.
- D: C-D01/R → P-D01 → E-D01,E-D02,E-D03; C-D02/R → P-D02 → E-D04,E-D05,E-D06,E-D07,E-D10;
  C-D03/S → P-D01,P-D05 → E-D01,E-D03; C-D04/S → P-D01 → E-D01,E-D02,E-D03;
  C-D05/R → P-D04 → E-D08,E-D09.
- E: C-E01/S → P-E01 → E-E01,E-E04; C-E02/R → P-E01,P-E02 → E-E02,E-E03;
  C-E03/R → P-E02 → E-E02; C-E04/S → P-E03 → E-E05,E-E06;
  C-E05/S → P-E04 → E-E06; C-E06/S → P-E05 → E-E01,E-E05,E-E06.
- F: C-F01/S → P-F01 → E-F01,E-F02,E-F03,E-F04; C-F02/S → P-F01 → E-F01,E-F02,E-F03;
  C-F03/R → P-F02 → E-F01; C-F04/S → P-F01 → E-F01,E-F02;
  C-F05/S → P-F04 → E-F01,E-F02,E-F03,E-F04,E-G05,E-G06,E-G07,E-G08.
- G: C-G01/S → P-G01 → E-G05,E-G06,E-G07; C-G03/R → P-G01 → E-G05,E-G07;
  C-G04/S → P-G03 → E-F01,E-G05,E-G06,E-G07,E-G08.
- H: C-H01/S → P-H01 → E-H01,E-H05; C-H02/S → P-H01,P-H04 → E-H02,E-H05;
  C-H03/R → P-H02 → E-H02,E-H04; C-H05/S → P-H03 → E-H01,E-H06.
- I: C-I01/R → P-I01 → E-I01,E-I04,E-I05,E-I07; C-I02/S → P-I03 → E-I02,E-I03,E-I04,E-I05;
  C-I03/R → P-I01 → E-I04,E-I05; C-I04/S → P-I04 → E-I01,E-I02,E-I03,E-I05;
  C-I05/R → P-I02 → E-I06.
- J: C-J01/S → P-J01,P-J02 → E-J01–E-J07; C-J02/R → P-J01,P-J02 → E-J03,E-J05,E-J06,E-J07;
  C-J03/R → P-J03 → E-J05,E-J08; C-J04/S → P-J01 → E-J06;
  C-J05/S → P-J02 → E-J02,E-J03,E-J04,E-J05,E-J07; C-J06/R → P-J01,P-J02 → E-J03–E-J07.
- K: C-K01/S → P-K02 → E-K01,E-K02; C-K03/R → P-K03 → E-K03,E-K04,E-K05;
  C-K04/S → P-K04 → E-K09; C-K05/S → P-K05 → E-K03,E-K04,E-K05;
  C-K06/R → P-K06 → E-G01,E-G02,E-G03; C-K07/S → P-K07 → E-G01,E-G02.
- L: C-L01/R → P-L01,P-L02 → E-A03,E-L02,E-L03,E-L04; C-L02/S → P-L02 → E-A03;
  C-L03/S → P-L01,P-L02 → E-A03,E-L02,E-L03,E-L04; C-L04/R → P-L04 → E-L07,E-L08;
  C-L05/R → P-L05 → E-L05,E-L06.
- M: C-M01/R → P-M01 → E-M01,E-M02; C-M02/S → P-M01 → E-M01,E-M02;
  C-M03/S → P-M02 → E-M01,E-M02,E-M03,E-M04; C-M05/S → P-M04 → E-M01–E-M05,E-K01,E-M07;
  C-M06/S → P-M05 → E-M05,E-K01,E-M07; C-M07/S → P-M04 → E-M05,E-K01,E-M07.
- N: C-N01/S → P-N01 → E-N01–E-N07; C-N02/S → P-N02 → E-N01–E-N07;
  C-N03/S → P-N03 → E-N07; C-N04/S → P-N01 → E-N01–E-N06.
- Measurement: C-MV01/S → none → E-MV01–E-MV04,E-MV09;
  C-MV02/S → none → E-MV05–E-MV07,E-I03–E-I07;
  C-MV03/S → none → E-MV08,E-MV09; C-MV04/S → none → Topics I/J and conservation;
  C-MV05/S → none → E-MV01–E-MV07.

## Full-flow and recalculation specifications

These are explicit skipped tests, not silent omissions:

1. `V7-LONGITUDINAL-COHORTS`: matched rest, 3×/4× strength, stepper,
   low/adequate protein, deficit/maintenance/surplus, novice/advanced,
   detraining, missing-HR, and missing-sleep cohorts.
2. `V7-RECALC-WORKOUT`: historical workout edit rebuilds day D forward.
3. `V7-RECALC-PROGRAM`: ProgramSnapshot attachment/change rebuilds dose-dependent
   state.
4. `V7-RECALC-NUTRITION`: nutrition edit rebuilds all dependent v7 state under
   one calculation revision.
5. `V7-FORECAST`: matched future scenarios expose fat, skeletal muscle,
   glycogen/water, and total weight.
6. `V7-E2E`: durable source history flows through canonical v7 input, state
   transitions, historical rebuild, and forecast.

## Bounds, tolerances, and fixture provenance

- The manifest contains **no exact numeric scientific expectations**.
- Numeric values in executable tests are controlled fixture inputs, marked by
  the manifest as INPUT CONTRACT or MODEL CONSERVATION RULE where applicable;
  they are not physiological constants.
- Executable assertions use sign, ordering, identity, missingness, and
  provenance. No arbitrary ±5%/±10% tolerance is used.
- The 3–4 glycogen-water relationship is tested only for co-directionality, not
  as a hard ratio. The 0.3–0.86 kg adult range is not encoded as a clamp.
- Fallback hierarchy behavior is not a scientific test. It remains an
  ENGINEERING ASSUMPTION and unsafe C-K02 is excluded.
- Local imaging, DXA/FFM, acute MPS, cycling-to-stepper transfer, uncalibrated
  HR, and acute sleep evidence are never silently treated as direct whole-body
  skeletal-muscle evidence.

## Required test seams and implementation dependency order

1. Introduce a versioned v7 state/output contract separating fat,
   `skeletalMuscleKg`, other lean tissue, glycogen, glycogen-associated water,
   transient exercise water, and ECF, with provenance.
2. Introduce durable ProgramSnapshot and canonical effective-dose inputs.
3. Add pure resistance-dose/adaptation and detraining interfaces.
4. Add workout glycogen demand and bounded repletion interfaces without
   inventing deferred coefficients or universal capacity.
5. Add transient exercise-water state and baseline-directed decay.
6. Add HR/calibration and sleep provenance/context inputs; keep rejected and
   deferred multipliers absent.
7. Thread the state through episode calculation, persistence, deterministic
   rebuild/fingerprinting, and calculation revision.
8. Extend forecast scenarios/outputs, then activate longitudinal, recalculation,
   forecast, and E2E specifications.

No production seam was added in this specification stage.
