export type AuditEligibility = "SAFE" | "SAFE_AFTER_AUDIT_REVISION" | "NOT_SAFE";
/**
 * Scientific manifest status model:
 * - GREEN — scientifically validated + executable oracle contract
 * - EXPERIMENTAL — bounded heuristic/approximation with tests, provenance, and
 *   uncertainty; implemented but NOT scientifically validated
 * - BLOCKED — no acceptable implementation yet
 * - REJECTED — intentionally not modeled after research
 *
 * Legacy aliases ALREADY_GREEN / INFRASTRUCTURE_BLOCKED are not used.
 */
export type ScientificClaimStatus = "GREEN" | "EXPERIMENTAL" | "BLOCKED" | "REJECTED";
/** @deprecated Prefer ScientificClaimStatus; kept for type search during migration. */
export type InitialState = ScientificClaimStatus;
export type TestType =
  | "unit"
  | "property"
  | "integration"
  | "longitudinal"
  | "e2e"
  | "recalculation"
  | "forecast";
export type AssertionType =
  | "BOUND"
  | "MONOTONICITY"
  | "ORDERING"
  | "CONSERVATION"
  | "SATURATION"
  | "TIME_COURSE"
  | "INVARIANT"
  | "MISSINGNESS"
  | "NO_DOUBLE_COUNTING"
  | "LONGITUDINAL"
  | "RECALCULATION";
export type Provenance =
  | "SCIENTIFIC_EVIDENCE"
  | "ENGINEERING_ASSUMPTION"
  | "MODEL_CONSERVATION_RULE"
  | "INPUT_CONTRACT";

export type ScientificClaimManifestRecord = {
  claimId: string;
  parameterIds: readonly string[];
  evidenceIds: readonly string[];
  auditEligibility: AuditEligibility;
  testFile: string;
  testName: string;
  testType: TestType;
  /** Canonical status. GREEN criteria are unchanged from prior ALREADY_GREEN. */
  status: ScientificClaimStatus;
  /**
   * Backward-compatible alias of `status` for older readers.
   * Prefer `status`.
   */
  expectedInitialState: ScientificClaimStatus;
  assertionTypes: readonly AssertionType[];
  provenance: readonly Provenance[];
  scientificAssertion: string;
  numericAssertions: readonly [];
  infrastructureBlocker?: string;
  /** Present only for EXPERIMENTAL claims; never treated as a scientific oracle. */
  experimentalImplementation?: string;
  experimentalUncertainty?: string;
  rejectionReason?: string;
};

const executableFile = "tests/scientific-v7/scientific-contract.test.ts";
const blockedFile = "tests/scientific-v7/scientific-claims.blocked.test.ts";
const rejectedFile = "tests/scientific-v7/scientific-claims.rejected.test.ts";

type RecordInput = Omit<ScientificClaimManifestRecord,
  | "testFile"
  | "testName"
  | "status"
  | "expectedInitialState"
  | "numericAssertions"
  | "experimentalImplementation"
  | "experimentalUncertainty"
  | "rejectionReason"
> & {
  title: string;
  executableTestName?: string;
  infrastructureBlocker?: string;
  experimental?: {
    implementation: string;
    testFile: string;
    testName: string;
    uncertainty: string;
  };
  rejectionReason?: string;
};

function record(input: RecordInput): ScientificClaimManifestRecord {
  if (input.rejectionReason !== undefined) {
    return {
      claimId: input.claimId,
      parameterIds: input.parameterIds,
      evidenceIds: input.evidenceIds,
      auditEligibility: input.auditEligibility,
      testFile: rejectedFile,
      testName: `[${input.claimId}] ${input.title}`,
      testType: input.testType,
      status: "REJECTED",
      expectedInitialState: "REJECTED",
      assertionTypes: input.assertionTypes,
      provenance: input.provenance,
      scientificAssertion: input.scientificAssertion,
      numericAssertions: [],
      rejectionReason: input.rejectionReason,
    };
  }
  if (input.experimental !== undefined) {
    return {
      claimId: input.claimId,
      parameterIds: input.parameterIds,
      evidenceIds: input.evidenceIds,
      auditEligibility: input.auditEligibility,
      testFile: input.experimental.testFile,
      testName: input.experimental.testName,
      testType: input.testType,
      status: "EXPERIMENTAL",
      expectedInitialState: "EXPERIMENTAL",
      assertionTypes: input.assertionTypes,
      provenance: input.provenance,
      scientificAssertion: input.scientificAssertion,
      numericAssertions: [],
      experimentalImplementation: input.experimental.implementation,
      experimentalUncertainty: input.experimental.uncertainty,
      ...(input.infrastructureBlocker === undefined
        ? {}
        : { infrastructureBlocker: input.infrastructureBlocker }),
    };
  }
  const executable = input.executableTestName !== undefined;
  return {
    claimId: input.claimId,
    parameterIds: input.parameterIds,
    evidenceIds: input.evidenceIds,
    auditEligibility: input.auditEligibility,
    testFile: executable ? executableFile : blockedFile,
    testName: input.executableTestName ?? `[${input.claimId}] ${input.title}`,
    testType: input.testType,
    status: executable ? "GREEN" : "BLOCKED",
    expectedInitialState: executable ? "GREEN" : "BLOCKED",
    assertionTypes: input.assertionTypes,
    provenance: input.provenance,
    scientificAssertion: input.scientificAssertion,
    numericAssertions: [],
    ...(input.infrastructureBlocker === undefined
      ? {}
      : { infrastructureBlocker: input.infrastructureBlocker }),
  };
}

const v7MuscleBlocker = "The v7 skeletalMuscleKg state contract exists, but no adaptation transition or proxy-safe observation contract exists.";
const v7DetrainingBlocker = "No v7 training-history/cessation state or skeletal-muscle detraining transition exists.";
const v7StepperGlycogenBlocker = "No direct v7 stepper glycogen-demand seam exists; substrate coefficients remain deferred.";
const experimentalTransientWaterImpl =
  "src/model/physiology-v7/experimental-transient-exercise-water-v1.ts";
const experimentalTransientWaterTest =
  "tests/experimental-transient-exercise-water-v1.test.ts";
const experimentalTransientWaterUncertainty =
  "Experimental finite-decay heuristic with engineering acute kg band and resolution horizons; not scientifically validated whole-body edema kg or half-life.";
const experimentalSkeletalMuscleDeltaImpl =
  "src/model/physiology-v7/experimental-skeletal-muscle-delta-v1.ts";
const experimentalSkeletalMuscleDeltaTest =
  "tests/experimental-skeletal-muscle-delta-v1.test.ts";
const experimentalSkeletalMuscleDeltaUncertainty =
  "Experimental relative skeletal-muscle delta heuristic from monthly literature-informed engineering rate bands × saturating dose/protein/energy scales; wide uncertainty; absolute skeletalMuscleKg intentionally unavailable; not scientifically validated personal kg rates.";
const experimentalLocalHypertrophyImpl =
  "src/model/physiology-v7/experimental-local-hypertrophy-response-v1.ts";
const experimentalLocalHypertrophyTest =
  "tests/experimental-local-hypertrophy-response-v1.test.ts";
const experimentalLocalHypertrophyUncertainty =
  "Experimental weekly per-muscle dimensionless saturating response from qualified direct hard-set volume; engineering τ; not kg/set, not skeletalMuscleKg, and not scientifically validated local percent change.";
const experimentalCessationDetrainingImpl =
  "src/model/physiology-v7/experimental-cessation-detraining-v1.ts";
const experimentalCessationDetrainingTest =
  "tests/experimental-cessation-detraining-v1.test.ts";
const experimentalCessationDetrainingUncertainty =
  "Experimental relative cessation/detraining heuristic with an engineering grace period and non-positive monthly atrophy band; not a scientifically validated atrophy curve, skeletalMuscleKg, or muscle-memory bonus.";
const experimentalRetrainingIdentificationImpl =
  "src/model/physiology-v7/experimental-retraining-identification-v1.ts";
const experimentalRetrainingIdentificationTest =
  "tests/experimental-retraining-identification-v1.test.ts";
const experimentalRetrainingIdentificationUncertainty =
  "Experimental heuristic retraining identification label reusing the 14-day cessation grace period solely as an engineering threshold; it is not a universal scientific duration, does not modify skeletal-muscle delta or protein/energy/training-status math, and contains no quantitative muscle-memory bonus.";
const experimentalFfmRetentionImpl =
  "src/model/physiology-v7/experimental-ffm-retention-v1.ts";
const experimentalFfmRetentionTest =
  "tests/experimental-ffm-retention-v1.test.ts";
const experimentalFfmRetentionUncertainty =
  "Experimental dimensionless FFM/slow-nonfat retention heuristic under energy deficit from observed protein and verified RT; Hall/Forbes mean is reference only; not skeletalMuscleKg and not scientifically validated personal retention kg.";
const experimentalBodyRecompositionImpl =
  "src/model/physiology-v7/experimental-body-recomposition-v1.ts";
const experimentalBodyRecompositionTest =
  "tests/experimental-body-recomposition-v1.test.ts";
const experimentalBodyRecompositionUncertainty =
  "Experimental heuristic longitudinal compatibility classifier combining read-only FatWeightShadowV1 fat change with relative skeletal-muscle delta; FFM retention is context only; no absolute skeletalMuscleKg, residual allocation, or scientifically validated personal recomposition truth.";
const experimentalPersonalEnergyCalibrationImpl =
  "src/model/activity/experimental-personal-energy-calibration-v1.ts";
const experimentalPersonalEnergyCalibrationTest =
  "tests/experimental-personal-energy-calibration-v1.test.ts";
const experimentalPersonalEnergyCalibrationUncertainty =
  "Experimental modality/device-specific validation-coverage heuristic: repeated current compatible shadow observations may narrow an estimator interval, but Garmin is diagnostic only, HR is context only, no kcal point estimate is calibrated, and no calorimetry oracle is claimed.";
const experimentalMeasurementValidationImpl =
  "src/model/physiology-v7/experimental-measurement-validation-v1.ts";
const experimentalMeasurementValidationTest =
  "tests/experimental-measurement-validation-v1.test.ts";
const experimentalMeasurementValidationUncertainty =
  "Experimental measurement-protocol consistency heuristic: only three or more standardized same endpoint/source/device/site observations use a 0.85 width multiplier; mixed or nonstandard series use 1.25, missing evidence is unavailable, and no observation is a universal truth or latent-state update.";
const v7SleepBlocker = "Canonical v7 sleep provenance/duration inputs and bounded sleep-context output do not exist.";

/** Claim IDs intentionally excluded from scientific GREEN/BLOCKED eligibility. */
export const UNSAFE_CLAIM_IDS = ["C-G02", "C-H04", "C-K02", "C-M04"] as const;

/** Eligible audited claims only (GREEN / EXPERIMENTAL / BLOCKED). REJECTED are separate. */
export const SCIENTIFIC_V7_CLAIMS: readonly ScientificClaimManifestRecord[] = [
  record({
    claimId: "C-A01",
    title: "higher supported volume does not lower group-expected local hypertrophy",
    parameterIds: ["P-A02"],
    evidenceIds: ["E-A01", "E-A02", "E-A03"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["MONOTONICITY"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Within the supported low-to-moderate range, added effective volume does not lower group-expected local hypertrophy; global concavity is not required.",
    experimental: {
      implementation: experimentalLocalHypertrophyImpl,
      testFile: experimentalLocalHypertrophyTest,
      testName: "higher supported volume does not lower group-expected local hypertrophy (C-A01)",
      uncertainty: experimentalLocalHypertrophyUncertainty,
    },
  }),
  record({ claimId: "C-A02", title: "volume-equated frequency has no required independent positive effect", parameterIds: ["P-A03"], evidenceIds: ["E-A02", "E-A11", "E-A14"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "With effective weekly volume equated, v7 adds no required positive frequency multiplier and does not require exact physiological equality.", executableTestName: "volume-equated frequency has no required independent positive effect" }),
  record({ claimId: "C-A03", title: "hard-set dose remains available without tonnage", parameterIds: ["P-A01", "P-A06"], evidenceIds: ["E-A02", "E-A08", "E-A10", "E-A14"], auditEligibility: "SAFE", testType: "integration", assertionTypes: ["MISSINGNESS", "INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "Valid program sets and muscle mapping preserve a training dose when tonnage is absent.", executableTestName: "hard-set dose remains available without tonnage" }),
  record({ claimId: "C-A04", title: "momentary failure is not mandatory", parameterIds: ["P-A04"], evidenceIds: ["E-A09", "E-A13"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Near-failure and failure training can both be effective; v7 requires neither exact equality nor a categorical failure bonus.", executableTestName: "momentary failure is not mandatory" }),
  record({ claimId: "C-A05", title: "load is not a standalone hypertrophy multiplier", parameterIds: ["P-A05"], evidenceIds: ["E-A04", "E-A10"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Within studied loads with sufficient effort and comparable effective work, lower load does not automatically mean lower hypertrophy.", executableTestName: "load is not a standalone hypertrophy multiplier" }),
  record({ claimId: "C-A06", title: "no unsupported hard volume cap", parameterIds: ["P-A07"], evidenceIds: ["E-A02", "E-A05", "E-A06", "E-A07", "E-A12"], auditEligibility: "SAFE", testType: "property", assertionTypes: ["BOUND", "SATURATION"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "No universal set cutoff forces zero or negative hypertrophy solely because it is crossed.", executableTestName: "no unsupported hard volume cap" }),

  record({
    claimId: "C-B01",
    title: "training status shifts a response prior without pairwise determinism",
    parameterIds: ["P-B01"],
    evidenceIds: ["E-B01", "E-B04", "E-B05", "E-B06"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "longitudinal",
    assertionTypes: ["ORDERING"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Training status may shift the group prior but cannot deterministically order every novice-advanced pair.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "training status shifts a response prior without pairwise determinism (C-B01)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({
    claimId: "C-B02",
    title: "experience does not create an exact gain rate",
    parameterIds: ["P-B01"],
    evidenceIds: ["E-B01", "E-B04", "E-B06"],
    auditEligibility: "SAFE",
    testType: "unit",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Experience category cannot determine exact skeletal-muscle kilograms per day or month.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "experience does not create an exact gain rate (C-B02)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({
    claimId: "C-B03",
    title: "program novelty is not chronic muscle",
    parameterIds: ["P-B02"],
    evidenceIds: ["E-B02", "E-B07", "E-B08"],
    auditEligibility: "SAFE",
    testType: "longitudinal",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Novelty alone creates no immediate skeletal-muscle tissue bonus.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "program novelty is not chronic muscle (C-B03)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({
    claimId: "C-B04",
    title: "acute MPS cannot directly set long-term gain",
    parameterIds: ["P-B05"],
    evidenceIds: ["E-B02", "E-B03", "E-B07"],
    auditEligibility: "SAFE",
    testType: "longitudinal",
    assertionTypes: ["INVARIANT", "LONGITUDINAL"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "An acute MPS percentage is not a chronic skeletal-muscle gain coefficient.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "acute MPS cannot directly set long-term gain (C-B04)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({ claimId: "C-B05", title: "muscle memory receives no unsupported numeric bonus", parameterIds: ["P-B04"], evidenceIds: ["E-B10", "E-B11", "E-B12", "E-B13"], auditEligibility: "SAFE", testType: "longitudinal", assertionTypes: ["INVARIANT", "MISSINGNESS"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT", "ENGINEERING_ASSUMPTION"], scientificAssertion: "Qualified training resumption may be experimentally identified only after a verified grace-qualified cessation/detraining episode; missing coverage and ordinary rest do not qualify, and the label adds no quantitative muscle-memory bonus or skeletal-muscle delta modification.", experimental: { implementation: experimentalRetrainingIdentificationImpl, testFile: experimentalRetrainingIdentificationTest, testName: "labels qualified training after verified cessation as experimental retraining (C-B05)", uncertainty: experimentalRetrainingIdentificationUncertainty } }),

  record({
    claimId: "C-C01",
    title: "cessation does not instantly remove muscle tissue",
    parameterIds: ["P-C01"],
    evidenceIds: ["E-C01", "E-C02"],
    auditEligibility: "SAFE",
    testType: "longitudinal",
    assertionTypes: ["TIME_COURSE", "LONGITUDINAL"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Verified cessation creates no same-day negative skeletal-muscle step solely from cessation.",
    experimental: {
      implementation: experimentalCessationDetrainingImpl,
      testFile: experimentalCessationDetrainingTest,
      testName: "cessation does not instantly remove muscle tissue (C-C01)",
      uncertainty: experimentalCessationDetrainingUncertainty,
    },
  }),
  record({
    claimId: "C-C02",
    title: "longer cessation creates no artificial recovery bonus",
    parameterIds: ["P-C01"],
    evidenceIds: ["E-C01", "E-C03"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "longitudinal",
    assertionTypes: ["TIME_COURSE"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "With other conditions fixed, longer continuous cessation creates no artificial recovery or bonus; no universal atrophy curve is required.",
    experimental: {
      implementation: experimentalCessationDetrainingImpl,
      testFile: experimentalCessationDetrainingTest,
      testName: "longer cessation cannot produce less cumulative loss inside supported domain (C-C02)",
      uncertainty: experimentalCessationDetrainingUncertainty,
    },
  }),
  record({ claimId: "C-C03", title: "validated nonzero loading is not complete cessation", parameterIds: ["P-C02"], evidenceIds: ["E-C04", "E-C05"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "longitudinal", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "Validated nonzero loading is not automatically complete cessation; maintenance magnitude is untested.", executableTestName: "validated nonzero loading is not complete cessation" }),
  record({ claimId: "C-C04", title: "age-specific maintenance uncertainty is preserved", parameterIds: ["P-C02"], evidenceIds: ["E-C04"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "longitudinal", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Age uncertainty is preserved without a directional multiplier from one protocol.", infrastructureBlocker: v7DetrainingBlocker }),
  record({ claimId: "C-C05", title: "strength loss is not muscle loss", parameterIds: ["P-C03"], evidenceIds: ["E-C03", "E-B13"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Strength decline cannot be converted directly into skeletal-muscle loss.", executableTestName: "strength loss is not muscle loss" }),
  record({ claimId: "C-C06", title: "resumption restores stimulus without invented memory gain", parameterIds: ["P-C05"], evidenceIds: ["E-C06", "E-C07", "E-B13"], auditEligibility: "SAFE", testType: "longitudinal", assertionTypes: ["LONGITUDINAL"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Training resumption restores stimulus without an automatic quantitative memory bonus.", executableTestName: "resumption restores stimulus without invented memory gain" }),

  record({
    claimId: "C-D01",
    title: "protein benefit is non-worsening and bounded",
    parameterIds: ["P-D01"],
    evidenceIds: ["E-D01", "E-D02", "E-D03"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["MONOTONICITY", "SATURATION"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Across studied low-to-adequate population intakes, higher protein does not worsen expected adaptation; 1.62 g/kg/day is not a switch.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "protein benefit is non-worsening and bounded (C-D01)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({
    claimId: "C-D02",
    title: "protein does not worsen retention during studied deficits",
    parameterIds: ["P-D02"],
    evidenceIds: ["E-D04", "E-D05", "E-D06", "E-D07", "E-D10"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["MONOTONICITY"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Within studied deficit/intake ranges, higher protein does not worsen expected proxy retention and does not guarantee skeletal-muscle gain.",
    experimental: {
      implementation: experimentalFfmRetentionImpl,
      testFile: experimentalFfmRetentionTest,
      testName: "protein does not worsen retention during studied deficits (C-D02)",
      uncertainty: experimentalFfmRetentionUncertainty,
    },
  }),
  record({
    claimId: "C-D03",
    title: "adequate protein cannot override training and physiological bounds",
    parameterIds: ["P-D01", "P-D05"],
    evidenceIds: ["E-D01", "E-D03"],
    auditEligibility: "SAFE",
    testType: "integration",
    assertionTypes: ["BOUND"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Protein alone cannot create unlimited training-mediated skeletal-muscle gain.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "adequate protein cannot override training and physiological bounds (C-D03)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({ claimId: "C-D04", title: "missing protein remains missing rather than measured zero", parameterIds: ["P-D01"], evidenceIds: ["E-D01", "E-D02", "E-D03"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["MISSINGNESS"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "Missing protein is reported as unavailable and is not silently converted into measured zero.", executableTestName: "missing protein remains unavailable rather than becoming measured zero" }),
  record({
    claimId: "C-D05",
    title: "protein timing has no separate v7 coefficient",
    parameterIds: ["P-D04"],
    evidenceIds: ["E-D08", "E-D09"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "unit",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "V7 omits a separate timing coefficient because evidence is insufficient, not because physiology is proven equal.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "protein timing has no separate v7 coefficient (C-D05)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),

  record({
    claimId: "C-E01",
    title: "larger sustained deficit does not improve expected muscle gain",
    parameterIds: ["P-E01"],
    evidenceIds: ["E-E01", "E-E04"],
    auditEligibility: "SAFE",
    testType: "property",
    assertionTypes: ["MONOTONICITY"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "A larger sustained deficit does not improve expected training-mediated muscle gain solely because it is larger.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "larger sustained deficit does not improve expected muscle gain (C-E01)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({
    claimId: "C-E02",
    title: "deficit does not make recomposition impossible",
    parameterIds: ["P-E01", "P-E02"],
    evidenceIds: ["E-E02", "E-E03"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "longitudinal",
    assertionTypes: ["BOUND"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Recomposition remains possible without treating DXA/FFM as skeletal-muscle tissue.",
    experimental: {
      implementation: experimentalBodyRecompositionImpl,
      testFile: experimentalBodyRecompositionTest,
      testName: "classifies fat loss plus positive relative SM delta as supported recomposition (C-E02)",
      uncertainty: experimentalBodyRecompositionUncertainty,
    },
  }),
  record({
    claimId: "C-E03",
    title: "resistance training does not worsen expected FFM retention",
    parameterIds: ["P-E02"],
    evidenceIds: ["E-E02"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "longitudinal",
    assertionTypes: ["ORDERING"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Resistance training does not worsen expected FFM retention versus diet only; skeletal-muscle magnitude remains uncertain.",
    experimental: {
      implementation: experimentalFfmRetentionImpl,
      testFile: experimentalFfmRetentionTest,
      testName: "resistance training does not worsen expected FFM retention versus diet-only (C-E03)",
      uncertainty: experimentalFfmRetentionUncertainty,
    },
  }),
  record({
    claimId: "C-E04",
    title: "surplus is not required for all hypertrophy",
    parameterIds: ["P-E03"],
    evidenceIds: ["E-E05", "E-E06"],
    auditEligibility: "SAFE",
    testType: "longitudinal",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Maintenance may permit muscle gain; absence of surplus alone cannot force zero hypertrophy.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "surplus is not required for all hypertrophy (C-E04)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({
    claimId: "C-E05",
    title: "larger surplus cannot yield unlimited muscle",
    parameterIds: ["P-E04"],
    evidenceIds: ["E-E06"],
    auditEligibility: "SAFE",
    testType: "property",
    assertionTypes: ["BOUND"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Skeletal-muscle response remains bounded as surplus increases; no linear kcal-to-muscle conversion is allowed.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "larger surplus cannot yield unlimited muscle (C-E05)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),
  record({
    claimId: "C-E06",
    title: "deficit and surplus are not mirror images",
    parameterIds: ["P-E05"],
    evidenceIds: ["E-E01", "E-E05", "E-E06"],
    auditEligibility: "SAFE",
    testType: "unit",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Equal-magnitude deficit and surplus cannot be forced through one symmetric muscle multiplier.",
    experimental: {
      implementation: experimentalSkeletalMuscleDeltaImpl,
      testFile: experimentalSkeletalMuscleDeltaTest,
      testName: "deficit and surplus are not mirror images (C-E06)",
      uncertainty: experimentalSkeletalMuscleDeltaUncertainty,
    },
  }),

  record({
    claimId: "C-F01",
    title: "strength workouts consume rather than create glycogen",
    parameterIds: ["P-F01"],
    evidenceIds: ["E-F01", "E-F02", "E-F03", "E-F04"],
    auditEligibility: "SAFE",
    testType: "unit",
    assertionTypes: ["BOUND"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "The exercise-only strength-workout glycogen transition is nonpositive.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-strength-glycogen-demand-v1.ts",
      testFile: "tests/experimental-strength-glycogen-demand-v1.test.ts",
      testName: "keeps exercise-only glycogen delta nonpositive (C-F01)",
      uncertainty: "Experimental heuristic with engineering order-of-magnitude kg band from local biopsy evidence; not scientifically validated whole-body kg.",
    },
  }),
  record({
    claimId: "C-F02",
    title: "strength-workout depletion is store bounded",
    parameterIds: ["P-F01"],
    evidenceIds: ["E-F01", "E-F02", "E-F03"],
    auditEligibility: "SAFE",
    testType: "property",
    assertionTypes: ["BOUND", "CONSERVATION"],
    provenance: ["SCIENTIFIC_EVIDENCE", "MODEL_CONSERVATION_RULE"],
    scientificAssertion: "Workout depletion cannot exceed available glycogen and cannot make the store negative.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-strength-glycogen-demand-v1.ts",
      testFile: "tests/experimental-strength-glycogen-demand-v1.test.ts",
      testName: "bounds depletion to the available glycogen store (C-F02)",
      uncertainty: "Store bound is exact conservation; magnitude remains an experimental heuristic approximation.",
    },
  }),
  record({
    claimId: "C-F03",
    title: "additional contained comparable work does not lower cumulative demand",
    parameterIds: ["P-F02"],
    evidenceIds: ["E-F01"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["MONOTONICITY"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "In an isolated no-refeeding session, a higher-set condition containing all lower-set work plus comparable added work does not have lower cumulative demand.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-strength-glycogen-demand-v1.ts",
      testFile: "tests/experimental-strength-glycogen-demand-v1.test.ts",
      testName: "does not lower estimated demand when contained comparable work increases (C-F03)",
      uncertainty: "Experimental heuristic monotonicity uses saturating direct-set scale (engineering τ); not the −11.2 mmol/kgdm/set ecological coefficient.",
    },
  }),
  record({
    claimId: "C-F04",
    title: "muscle recruitment matters for glycogen demand",
    parameterIds: ["P-F01"],
    evidenceIds: ["E-F01", "E-F02"],
    auditEligibility: "SAFE",
    testType: "unit",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Local glycogen demand cannot be applied universally without muscle mapping.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-strength-glycogen-demand-v1.ts",
      testFile: "tests/experimental-strength-glycogen-demand-v1.test.ts",
      testName: "uses muscle mapping so equal set counts are not universal (C-F04)",
      uncertainty: "Heuristic uses coarse large/small recruitment class for asymmetric uncertainty; continuous per-group mass weights are intentionally rejected.",
    },
  }),
  record({
    claimId: "C-F05",
    title: "resistance and aerobic glycogen conversions are not interchangeable",
    parameterIds: ["P-F04"],
    evidenceIds: ["E-F01", "E-F02", "E-F03", "E-F04", "E-G05", "E-G06", "E-G07", "E-G08"],
    auditEligibility: "SAFE",
    testType: "integration",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Equal active energy does not mandate equal glycogen depletion across resistance and aerobic modalities.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-stepper-glycogen-demand-v1.ts",
      testFile: "tests/experimental-stepper-glycogen-demand-v1.test.ts",
      testName: "allows strength vs stepper glycogen demand to differ at equal active kcal (C-G04, C-F05)",
      uncertainty: "Experimental strength and stepper heuristics are independent dose drivers; equal ignored active-kcal context does not force equal depletion.",
    },
  }),

  record({
    claimId: "C-G01",
    title: "stepper glycogen demand is nonnegative and state bounded",
    parameterIds: ["P-G01"],
    evidenceIds: ["E-G05", "E-G06", "E-G07"],
    auditEligibility: "SAFE",
    testType: "unit",
    assertionTypes: ["BOUND", "CONSERVATION"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "A completed stepper bout may reduce glycogen but cannot create glycogen or deplete more than the available store.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-stepper-glycogen-demand-v1.ts",
      testFile: "tests/experimental-stepper-glycogen-demand-v1.test.ts",
      testName: "keeps exercise-only glycogen delta nonpositive and store-bounded (C-G01)",
      uncertainty: "Experimental MS100 step/duration saturating heuristic with engineering whole-body kg band; not scientifically validated personal substrate fractions.",
    },
  }),
  record({
    claimId: "C-G03",
    title: "matched-bout energy is nondecreasing with duration without fixed substrate rate",
    parameterIds: ["P-G01"],
    evidenceIds: ["E-G05", "E-G07"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["MONOTONICITY"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "For one continuous matched bout, total energy is nondecreasing with duration; muscle glycogen and carbohydrate fraction need not be monotonic.",
    experimental: {
      implementation: "src/model/activity/experimental-stepper-active-energy-v1.ts",
      testFile: "tests/experimental-stepper-active-energy-v1.test.ts",
      testName: "keeps matched-bout total energy nondecreasing without imposing a fixed glycogen rate (C-G03)",
      uncertainty: "Experimental MS100 mechanical vertical-work heuristic with engineering geometry and efficiency priors; it establishes only matched-protocol energy direction, not personal calorimetry, glycogen depletion, or a substrate fraction/rate.",
    },
  }),
  record({
    claimId: "C-G04",
    title: "equal active energy does not imply equal glycogen use",
    parameterIds: ["P-G03"],
    evidenceIds: ["E-F01", "E-G05", "E-G06", "E-G07", "E-G08"],
    auditEligibility: "SAFE",
    testType: "integration",
    assertionTypes: ["INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Equal active energy across profiles or modalities does not require equal glycogen depletion.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-stepper-glycogen-demand-v1.ts",
      testFile: "tests/experimental-stepper-glycogen-demand-v1.test.ts",
      testName: "allows strength vs stepper glycogen demand to differ at equal active kcal (C-G04, C-F05)",
      uncertainty: "Experimental cross-modality check uses independent strength and stepper heuristics; kcal is ignored context only.",
    },
  }),

  record({ claimId: "C-H01", title: "more carbohydrate does not reduce refill opportunity", parameterIds: ["P-H01"], evidenceIds: ["E-H01", "E-H05"], auditEligibility: "SAFE", testType: "property", assertionTypes: ["MONOTONICITY"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "From the same depleted state and recovery interval, more available carbohydrate within the studied range does not produce less glycogen restoration.", executableTestName: "more carbohydrate from the same depleted state does not reduce glycogen restoration" }),
  record({
    claimId: "C-H02",
    title: "repletion is capacity bounded",
    parameterIds: ["P-H01", "P-H04"],
    evidenceIds: ["E-H02", "E-H05"],
    auditEligibility: "SAFE",
    testType: "property",
    assertionTypes: ["BOUND", "SATURATION"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Available storage space bounds repletion without a universal capacity value.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-glycogen-repletion-v1.ts",
      testFile: "tests/experimental-glycogen-repletion-v1.test.ts",
      testName: "bounds repletion to defensible store headroom without inventing personal capacity (C-H02)",
      uncertainty: "Experimental heuristic daily carb-saturating repletion with engineering τ and kg envelope; clamps only to exercise-depletion refill headroom when available; adult literature range never becomes personal capacity; not scientifically validated.",
    },
  }),
  record({ claimId: "C-H03", title: "daily v7 need not apply meal-frequency effect", parameterIds: ["P-H02"], evidenceIds: ["E-H02", "E-H04"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "At daily resolution with no second workout, v7 need not apply a meal-frequency effect; physiological equality is not asserted.", executableTestName: "daily v7 need not apply meal-frequency effect" }),
  record({ claimId: "C-H05", title: "protein is not double-counted as a glycogen bonus", parameterIds: ["P-H03"], evidenceIds: ["E-H01", "E-H06"], auditEligibility: "SAFE", testType: "integration", assertionTypes: ["NO_DOUBLE_COUNTING", "INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "With carbohydrate and energy matched, v7 adds no independent protein glycogen bonus.", executableTestName: "protein is not double-counted as a glycogen bonus" }),

  record({ claimId: "C-I01", title: "associated water co-moves with glycogen without a hard ratio", parameterIds: ["P-I01"], evidenceIds: ["E-I01", "E-I04", "E-I05", "E-I07"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "property", assertionTypes: ["MONOTONICITY"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Associated water changes in the same direction as glycogen; approximately 3-4 kg/kg is not tested as a hard or personal bound.", executableTestName: "glycogen-associated water co-moves without asserting a universal ratio" }),
  record({ claimId: "C-I02", title: "glycogen water is counted once", parameterIds: ["P-I03"], evidenceIds: ["E-I02", "E-I03", "E-I04", "E-I05"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["NO_DOUBLE_COUNTING", "CONSERVATION"], provenance: ["SCIENTIFIC_EVIDENCE", "MODEL_CONSERVATION_RULE"], scientificAssertion: "The same glycogen-associated water mass appears in exactly one reconstructed compartment.", executableTestName: "body-weight reconstruction counts glycogen-associated mass exactly once" }),
  record({ claimId: "C-I03", title: "additional hydration is not automatically glycogen water", parameterIds: ["P-I01"], evidenceIds: ["E-I04", "E-I05"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT", "MISSINGNESS"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT", "ENGINEERING_ASSUMPTION"], scientificAssertion: "Hydration, total-body-water, and ECF observations remain context rather than glycogen water; only compatible glycogen-change evidence selects an uncertain associated-water estimate, with ambiguous or missing water unresolved and no residual allocation.", experimental: { implementation: experimentalMeasurementValidationImpl, testFile: experimentalMeasurementValidationTest, testName: "keeps hydration observations out of glycogen water without compatible glycogen evidence (C-I03)", uncertainty: experimentalMeasurementValidationUncertainty } }),
  record({ claimId: "C-I04", title: "glycogen loading is not hypertrophy", parameterIds: ["P-I04"], evidenceIds: ["E-I01", "E-I02", "E-I03", "E-I05"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE", "MODEL_CONSERVATION_RULE"], scientificAssertion: "Changing glycogen and associated water does not change the lean-tissue compartment or create skeletal-muscle tissue.", executableTestName: "changing glycogen-associated mass does not change lean tissue" }),
  record({ claimId: "C-I05", title: "adult glycogen range is contextual rather than a universal clamp", parameterIds: ["P-I02"], evidenceIds: ["E-I06"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "The 0.3-0.86 kg adult range is metadata only and never a pass/fail threshold, universal clamp, personal capacity, or default.", executableTestName: "adult glycogen range is contextual rather than a universal clamp" }),

  record({ claimId: "C-J01", title: "acute swelling is not muscle tissue", parameterIds: ["P-J01", "P-J02"], evidenceIds: ["E-J01", "E-J02", "E-J03", "E-J04", "E-J05", "E-J06", "E-J07"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Acute post-workout swelling enters transient water, never immediate skeletal-muscle tissue.", executableTestName: "acute swelling is not muscle tissue" }),
  record({
    claimId: "C-J02",
    title: "different transient-water time courses are permitted",
    parameterIds: ["P-J01", "P-J02"],
    evidenceIds: ["E-J03", "E-J05", "E-J06", "E-J07"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "longitudinal",
    assertionTypes: ["TIME_COURSE"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Different time courses are permitted; v7 need not infer a response class or force two components.",
    experimental: {
      implementation: experimentalTransientWaterImpl,
      testFile: experimentalTransientWaterTest,
      testName: "permits distinct accustomed vs novel resolution domains without a two-component force (C-J02)",
      uncertainty: experimentalTransientWaterUncertainty,
    },
  }),
  record({
    claimId: "C-J03",
    title: "prior exposure may attenuate damage response on average",
    parameterIds: ["P-J03"],
    evidenceIds: ["E-J05", "E-J08"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "longitudinal",
    assertionTypes: ["ORDERING"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Prior exposure may lower expected markers or edema on average; deterministic non-increase is not required.",
    experimental: {
      implementation: experimentalTransientWaterImpl,
      testFile: experimentalTransientWaterTest,
      testName: "uses exposure for resolution domain only without inventing attenuation coefficients (C-J03)",
      uncertainty: `${experimentalTransientWaterUncertainty} Exposure affects horizon domain/uncertainty only; no exact repeated-bout attenuation coefficient.`,
    },
  }),
  record({
    claimId: "C-J04",
    title: "routine trained workout may resolve rapidly",
    parameterIds: ["P-J01"],
    evidenceIds: ["E-J06"],
    auditEligibility: "SAFE",
    testType: "longitudinal",
    assertionTypes: ["TIME_COURSE"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "The model permits no sustained edema beyond the next day after an accustomed trained session.",
    experimental: {
      implementation: experimentalTransientWaterImpl,
      testFile: experimentalTransientWaterTest,
      testName: "permits accustomed resolution about the next day (C-J04)",
      uncertainty: experimentalTransientWaterUncertainty,
    },
  }),
  record({
    claimId: "C-J05",
    title: "damaging bout may persist across days",
    parameterIds: ["P-J02"],
    evidenceIds: ["E-J02", "E-J03", "E-J04", "E-J05", "E-J07"],
    auditEligibility: "SAFE",
    testType: "longitudinal",
    assertionTypes: ["TIME_COURSE"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Novel damaging bouts may remain elevated across days without treating extreme tails as routine.",
    experimental: {
      implementation: experimentalTransientWaterImpl,
      testFile: experimentalTransientWaterTest,
      testName: "permits novel multi-day elevation without extreme tails (C-J05)",
      uncertainty: experimentalTransientWaterUncertainty,
    },
  }),
  record({
    claimId: "C-J06",
    title: "isolated transient water trends toward baseline",
    parameterIds: ["P-J01", "P-J02"],
    evidenceIds: ["E-J03", "E-J04", "E-J05", "E-J06", "E-J07"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["TIME_COURSE", "BOUND"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Absent new causes, an isolated transient component remains finite and trends toward baseline without an exact zero time or half-life.",
    experimental: {
      implementation: experimentalTransientWaterImpl,
      testFile: experimentalTransientWaterTest,
      testName: "decays isolated transient water monotonically toward baseline (C-J06)",
      uncertainty: experimentalTransientWaterUncertainty,
    },
  }),

  record({ claimId: "C-K01", title: "wearable active energy retains estimate provenance", parameterIds: ["P-K02"], evidenceIds: ["E-K01", "E-K02"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "Device active energy retains source provenance and is not labeled criterion calorimetry.", executableTestName: "device active energy retains estimate provenance" }),
  record({ claimId: "C-K03", title: "valid current modality-relevant personal calibration can reduce uncertainty", parameterIds: ["P-K03"], evidenceIds: ["E-K03", "E-K04", "E-K05"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["ORDERING", "MISSINGNESS"], provenance: ["SCIENTIFIC_EVIDENCE", "ENGINEERING_ASSUMPTION"], scientificAssertion: "Repeated current personal observations from one compatible modality/device source may narrow experimental epistemic uncertainty without treating Garmin or HR as energy truth.", experimental: { implementation: experimentalPersonalEnergyCalibrationImpl, testFile: experimentalPersonalEnergyCalibrationTest, testName: "narrows experimental uncertainty after repeated same-modality/device compatible observations (C-K03)", uncertainty: experimentalPersonalEnergyCalibrationUncertainty } }),
  record({ claimId: "C-K04", title: "sparse HR cannot recover unobserved transitions", parameterIds: ["P-K04"], evidenceIds: ["E-K09"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Equal sparse average/max HR does not require equal true energy expenditure; no validated sampling cutoff is invented.", executableTestName: "sparse HR cannot recover unobserved transitions" }),
  record({ claimId: "C-K05", title: "maximum HR alone is not calorie dose", parameterIds: ["P-K05"], evidenceIds: ["E-K03", "E-K04", "E-K05"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Maximum HR without duration cannot determine active energy.", executableTestName: "maximum HR alone does not determine active energy" }),
  record({
    claimId: "C-K06",
    title: "matched mechanical stepper protocol energy is nondecreasing with duration",
    parameterIds: ["P-K06"],
    evidenceIds: ["E-G01", "E-G02", "E-G03"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["MONOTONICITY"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "For the same mechanical protocol and efficiency assumptions, gross energy is nondecreasing with duration; body-mass scaling is not exact.",
    experimental: {
      implementation: "src/model/activity/experimental-stepper-active-energy-v1.ts",
      testFile: "tests/experimental-stepper-active-energy-v1.test.ts",
      testName: "keeps matched mechanical protocol energy nondecreasing with duration (C-K06)",
      uncertainty: "Experimental mechanical vertical-work heuristic with engineering MS100 step-height and net-efficiency priors; not scientifically validated personal calorimetry and not a fixed MET fallback.",
    },
  }),
  record({
    claimId: "C-K08",
    title: "resistance diary can estimate active energy independently of Garmin",
    parameterIds: ["P-K07"],
    evidenceIds: ["E-K01", "E-K02"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "unit",
    assertionTypes: ["MISSINGNESS", "INVARIANT"],
    provenance: ["SCIENTIFIC_EVIDENCE", "ENGINEERING_ASSUMPTION"],
    scientificAssertion: "A resistance diary session may produce an independent experimental active-energy estimate from body mass, elapsed duration, and observed session context without treating Garmin as truth, without HR/RIR→kcal formulas, and without universal kcal/set, kcal/rep, or kcal/tonnage coefficients.",
    experimental: {
      implementation: "src/modules/training/experimental-strength-active-energy-v1.ts",
      testFile: "tests/experimental-strength-active-energy-v1.test.ts",
      testName: "estimates positive active kcal for a valid LIVE session (C-K08)",
      uncertainty: "Experimental session-level mass×duration×engineering net-MET band with LIVE density/class context; wide engineering priors; not scientifically validated personal calorimetry.",
    },
  }),
  record({ claimId: "C-K07", title: "active and gross energy semantics are not mixed", parameterIds: ["P-K07"], evidenceIds: ["E-G01", "E-G02"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["NO_DOUBLE_COUNTING", "CONSERVATION"], provenance: ["SCIENTIFIC_EVIDENCE", "MODEL_CONSERVATION_RULE", "INPUT_CONTRACT"], scientificAssertion: "Device active energy is used once without adding or subtracting a resting component in the active-energy resolver.", executableTestName: "device active energy is counted once without a resting-energy adjustment" }),

  record({ claimId: "C-L01", title: "resistance-training HR adds no independent hypertrophy multiplier", parameterIds: ["P-L01", "P-L02"], evidenceIds: ["E-A03", "E-L02", "E-L03", "E-L04"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "property", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "After program dose is represented, v7 adds no independent causal HR multiplier without claiming HR has zero residual information.", executableTestName: "resistance-training HR adds no independent hypertrophy multiplier" }),
  record({ claimId: "C-L02", title: "missing HR does not erase strength stimulus", parameterIds: ["P-L02"], evidenceIds: ["E-A03"], auditEligibility: "SAFE", testType: "integration", assertionTypes: ["MISSINGNESS", "INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "A valid resistance program retains anabolic dose when HR is missing.", executableTestName: "missing HR does not erase strength stimulus" }),
  record({ claimId: "C-L03", title: "equal HR does not imply equal local stimulus", parameterIds: ["P-L01", "P-L02"], evidenceIds: ["E-A03", "E-L02", "E-L03", "E-L04"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Equal HR summaries do not require equal local or whole-body anabolic dose.", executableTestName: "equal HR does not imply equal local stimulus" }),
  record({ claimId: "C-L04", title: "resistance HR uncertainty remains activity and device specific", parameterIds: ["P-L04"], evidenceIds: ["E-L07", "E-L08"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT", "MISSINGNESS"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "Resistance-training HR uncertainty remains activity-, movement-, and device-specific context; no universal resistance-versus-cardio error ranking or HR→kcal conversion is claimed.", experimental: { implementation: experimentalPersonalEnergyCalibrationImpl, testFile: experimentalPersonalEnergyCalibrationTest, testName: "labels resistance HR uncertainty as device/activity-specific without a universal cardio ranking (C-L04)", uncertainty: experimentalPersonalEnergyCalibrationUncertainty } }),
  record({ claimId: "C-L05", title: "HRV has no validated v7 hypertrophy coefficient", parameterIds: ["P-L05"], evidenceIds: ["E-L05", "E-L06"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "V7 adds no independent HRV hypertrophy coefficient; null small trials do not prove physiological equivalence.", executableTestName: "HRV has no validated v7 hypertrophy coefficient" }),

  record({ claimId: "C-M01", title: "severe multi-night restriction creates no positive anabolic bonus", parameterIds: ["P-M01"], evidenceIds: ["E-M01", "E-M02"], auditEligibility: "SAFE_AFTER_AUDIT_REVISION", testType: "longitudinal", assertionTypes: ["BOUND"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Severe multi-night restriction creates no positive anabolic bonus solely through sleep; no exact chronic penalty is required.", infrastructureBlocker: v7SleepBlocker }),
  record({ claimId: "C-M02", title: "acute sleep-related MPS is not chronic muscle kilograms", parameterIds: ["P-M01"], evidenceIds: ["E-M01", "E-M02"], auditEligibility: "SAFE", testType: "longitudinal", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Acute MPS percentages are not directly applied to chronic skeletal-muscle kilograms.", executableTestName: "acute sleep-related MPS is not chronic muscle kilograms" }),
  record({ claimId: "C-M03", title: "one poor night has no exact daily multiplier", parameterIds: ["P-M02"], evidenceIds: ["E-M01", "E-M02", "E-M03", "E-M04"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "An isolated low sleep duration does not create a precise daily muscle/fat coefficient.", executableTestName: "one poor night has no exact daily multiplier" }),
  record({ claimId: "C-M05", title: "missing sleep remains unknown", parameterIds: ["P-M04"], evidenceIds: ["E-M01", "E-M02", "E-M03", "E-M04", "E-M05", "E-K01", "E-M07"], auditEligibility: "SAFE", testType: "integration", assertionTypes: ["MISSINGNESS"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "Missing sleep is not zero sleep and creates no automatic muscle penalty.", executableTestName: "missing sleep remains unknown" }),
  record({ claimId: "C-M06", title: "consumer sleep stages do not drive v7 physiology", parameterIds: ["P-M05"], evidenceIds: ["E-M05", "E-K01", "E-M07"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "REM/Core/Deep values do not independently alter v7 body-composition outputs.", executableTestName: "consumer sleep stages do not drive v7 physiology" }),
  record({ claimId: "C-M07", title: "wearable sleep is not PSG", parameterIds: ["P-M04"], evidenceIds: ["E-M05", "E-K01", "E-M07"], auditEligibility: "SAFE", testType: "integration", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT"], scientificAssertion: "Consumer sleep retains device provenance and measurement uncertainty rather than being labeled PSG.", executableTestName: "wearable sleep is not PSG" }),

  record({ claimId: "C-N01", title: "no automatic EPOC add-on", parameterIds: ["P-N01"], evidenceIds: ["E-N01", "E-N02", "E-N03", "E-N04", "E-N05", "E-N06", "E-N07"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["NO_DOUBLE_COUNTING", "INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE", "MODEL_CONSERVATION_RULE"], scientificAssertion: "The workout-energy resolver adds no inferred post-workout calorie amount to observed active energy.", executableTestName: "observed workout active energy receives no automatic EPOC add-on" }),
  record({ claimId: "C-N02", title: "no universal EPOC percentage", parameterIds: ["P-N02"], evidenceIds: ["E-N01", "E-N02", "E-N03", "E-N04", "E-N05", "E-N06", "E-N07"], auditEligibility: "SAFE", testType: "property", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Workout active energy is not multiplied by a generic EPOC percentage.", executableTestName: "workout energy is not multiplied by a universal EPOC percentage" }),
  record({ claimId: "C-N03", title: "observed recovery energy is counted once", parameterIds: ["P-N03"], evidenceIds: ["E-N07"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["NO_DOUBLE_COUNTING", "CONSERVATION"], provenance: ["SCIENTIFIC_EVIDENCE", "MODEL_CONSERVATION_RULE"], scientificAssertion: "An observed active-energy interval is represented once and not supplemented by modeled EPOC.", executableTestName: "the represented workout active-energy interval is counted exactly once" }),
  record({ claimId: "C-N04", title: "excluding an EPOC add-on does not deny EPOC physiology", parameterIds: ["P-N01"], evidenceIds: ["E-N01", "E-N02", "E-N03", "E-N04", "E-N05", "E-N06"], auditEligibility: "SAFE", testType: "unit", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "The v7 exclusion is an uncertainty/double-counting decision, not a claim that postexercise oxygen consumption is physiologically zero.", executableTestName: "excluding an EPOC add-on does not deny EPOC physiology" }),

  record({ claimId: "C-MV01", title: "local hypertrophy is not whole-body hypertrophy", parameterIds: [], evidenceIds: ["E-MV01", "E-MV02", "E-MV03", "E-MV04", "E-MV09"], auditEligibility: "SAFE", testType: "integration", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "A local muscle percentage is not applied to total skeletalMuscleKg.", executableTestName: "local hypertrophy is not whole-body hypertrophy" }),
  record({ claimId: "C-MV02", title: "lean mass is not skeletal muscle", parameterIds: [], evidenceIds: ["E-MV05", "E-MV06", "E-MV07", "E-I03", "E-I04", "E-I05", "E-I06", "E-I07"], auditEligibility: "SAFE", testType: "integration", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "DXA/BIA lean endpoints remain proxy data and are not automatically skeletal-muscle tissue.", executableTestName: "lean mass is not skeletal muscle" }),
  record({ claimId: "C-MV03", title: "acute MPS is not accumulated muscle mass", parameterIds: [], evidenceIds: ["E-MV08", "E-MV09"], auditEligibility: "SAFE", testType: "longitudinal", assertionTypes: ["INVARIANT"], provenance: ["SCIENTIFIC_EVIDENCE"], scientificAssertion: "Acute tracer synthesis percentages have no direct chronic kilogram conversion.", executableTestName: "acute MPS is not accumulated muscle mass" }),
  record({ claimId: "C-MV04", title: "body weight conserves total mass without identifying composition", parameterIds: [], evidenceIds: ["E-I01", "E-I02", "E-I03", "E-I04", "E-I05", "E-J01", "E-J02", "E-J03", "E-J04", "E-J05", "E-J06", "E-J07"], auditEligibility: "SAFE", testType: "property", assertionTypes: ["CONSERVATION"], provenance: ["MODEL_CONSERVATION_RULE"], scientificAssertion: "Reconstructed weight equals the modeled component sum while weight alone does not identify tissue composition.", executableTestName: "body-weight reconstruction counts glycogen-associated mass exactly once" }),
  record({ claimId: "C-MV05", title: "longitudinal method consistency affects uncertainty", parameterIds: [], evidenceIds: ["E-MV01", "E-MV02", "E-MV03", "E-MV04", "E-MV05", "E-MV06", "E-MV07"], auditEligibility: "SAFE", testType: "longitudinal", assertionTypes: ["ORDERING", "MISSINGNESS"], provenance: ["SCIENTIFIC_EVIDENCE", "INPUT_CONTRACT", "ENGINEERING_ASSUMPTION"], scientificAssertion: "Repeated standardized same endpoint/source/device/site series may narrow experimental uncertainty, while mixed devices, sites, hydration, or acute-exercise conditions widen or prevent narrowing; BIA, DXA, scale, and local endpoints retain their roles and no method is universal truth.", experimental: { implementation: experimentalMeasurementValidationImpl, testFile: experimentalMeasurementValidationTest, testName: "widens experimental uncertainty for mixed measurement methods and devices (C-MV05)", uncertainty: experimentalMeasurementValidationUncertainty } }),
  record({
    claimId: "C-FW01",
    title: "personal fat/weight uncertainty is explicit without residual allocation",
    parameterIds: ["P-FW01"],
    evidenceIds: ["E-MV05", "E-MV06", "E-MV07"],
    auditEligibility: "SAFE_AFTER_AUDIT_REVISION",
    testType: "property",
    assertionTypes: ["BOUND", "MISSINGNESS", "NO_DOUBLE_COUNTING"],
    provenance: ["SCIENTIFIC_EVIDENCE", "ENGINEERING_ASSUMPTION", "INPUT_CONTRACT"],
    scientificAssertion: "FatWeightShadow mean trajectories carry explicit fat and modeled-weight uncertainty bounds; scale weight and BIA may calibrate or widen uncertainty but never overwrite tissue state or allocate residuals into fat, muscle, glycogen, water, or ECF.",
    experimental: {
      implementation: "src/model/physiology-v7/experimental-fat-weight-uncertainty-v1.ts",
      testFile: "tests/experimental-fat-weight-uncertainty-v1.test.ts",
      testName: "keeps the FatWeightShadowV1 mean point estimate unchanged (C-FW01)",
      uncertainty: "Experimental heuristic half-width bands around unchanged Hall/Forbes mean; engineering scale/fat priors with gap widening and compatible-observation narrowing; not scientifically validated personal SDs.",
    },
  }),
];

/**
 * Intentionally not modeled as scientific claims after research/audit.
 * These keep claim IDs and metadata but are REJECTED, not BLOCKED.
 */
export const SCIENTIFIC_V7_REJECTED_CLAIMS: readonly ScientificClaimManifestRecord[] = [
  record({
    claimId: "C-G02",
    title: "relative intensity orders carbohydrate reliance",
    parameterIds: ["P-G02"],
    evidenceIds: ["E-G05", "E-G06", "E-G01", "E-G02", "E-G03", "E-G04"],
    auditEligibility: "NOT_SAFE",
    testType: "property",
    assertionTypes: ["MONOTONICITY"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Matched stepper relative intensity must not lower carbohydrate reliance; direct stepper substrate evidence is insufficient for a scientific invariant.",
    rejectionReason: "Independent audit: NOT SAFE. Direct stepper substrate evidence is absent and cross-modality ordering is too strong; keep deferred research expectation only, not a v7 production/scientific claim.",
  }),
  record({
    claimId: "C-H04",
    title: "short recovery preserves timing relevance",
    parameterIds: ["P-H02"],
    evidenceIds: ["E-H01", "E-H03"],
    auditEligibility: "NOT_SAFE",
    testType: "unit",
    assertionTypes: ["TIME_COURSE"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Immediate carbohydrate after short recovery can produce faster interim repletion; intraday timing remains deferred.",
    rejectionReason: "Independent audit: NOT SAFE. Direction is credible but the intraday timing feature is deferred and is not a v7 production invariant.",
  }),
  record({
    claimId: "C-K02",
    title: "source hierarchy degrades explicitly",
    parameterIds: ["P-K01"],
    evidenceIds: ["E-K01", "E-K02", "E-K03", "E-K04", "E-K05", "E-K09", "E-G01", "E-G02", "E-G03"],
    auditEligibility: "NOT_SAFE",
    testType: "unit",
    assertionTypes: ["ORDERING"],
    provenance: ["ENGINEERING_ASSUMPTION"],
    scientificAssertion: "Device → HR-assisted → MET fallback may be an engineering policy; evidence does not establish a universal scientific accuracy ordering.",
    rejectionReason: "Independent audit: NOT SAFE as scientific accuracy ordering. Acceptable only as labelled engineering fallback policy, not a scientific claim.",
  }),
  record({
    claimId: "C-M04",
    title: "sleep-restricted diet can shift partition adversely",
    parameterIds: ["P-M03"],
    evidenceIds: ["E-M03"],
    auditEligibility: "NOT_SAFE",
    testType: "longitudinal",
    assertionTypes: ["ORDERING"],
    provenance: ["SCIENTIFIC_EVIDENCE"],
    scientificAssertion: "Severe shorter sleep under deficit may permit less fat loss / more nonfat loss; one small DXA trial cannot support production skeletal-muscle assertion.",
    rejectionReason: "Independent audit: NOT SAFE. One n=10 DXA crossover supports only low-certainty direction; do not encode a production partition assertion.",
  }),
];

export const ALL_SCIENTIFIC_V7_CLAIM_RECORDS: readonly ScientificClaimManifestRecord[] = [
  ...SCIENTIFIC_V7_CLAIMS,
  ...SCIENTIFIC_V7_REJECTED_CLAIMS,
];

export const SCIENTIFIC_V7_FLOW_BLOCKERS = [
  { id: "V7-LONGITUDINAL-COHORTS", testType: "longitudinal", testName: "audited matched cohorts expose skeletal muscle, glycogen water, fat, and total weight", reason: "The v7 state and canonical session/HR seam exist, but no sleep input, transitions, or cohort harness exists." },
  { id: "V7-RECALC-WORKOUT", testType: "recalculation", testName: "historical workout edit rebuilds day D and all dependent v7 states", reason: "Episode persistence has no v7 workout-physiology state or calculation revision." },
  { id: "V7-RECALC-PROGRAM", testType: "recalculation", testName: "program attachment change rebuilds the stimulus-dependent trajectory", reason: "The durable session snapshot and v7 input fingerprint exist, but they are not attached to persisted episode recalculation." },
  { id: "V7-RECALC-NUTRITION", testType: "recalculation", testName: "nutrition edit rebuilds dependent v7 physiology without mixed revisions", reason: "The episode rebuild exists, but v7 muscle/workout-glycogen/transient-water dependencies do not." },
  { id: "V7-FORECAST", testType: "forecast", testName: "matched future v7 scenarios expose fat, skeletal muscle, glycogen water, and total weight", reason: "Forecast outputs leanTissueKg and lack v7 ProgramSnapshot, skeletalMuscleKg, transient water, HR, and sleep inputs." },
  { id: "V7-E2E", testType: "e2e", testName: "durable sources flow through canonical v7 input, rebuild, and forecast", reason: "The v7 canonical input contract exists, but no repository loader, simulator entry point, persistence, or forecast integration exists." },
] as const;

export type ScientificManifestStatusCounts = {
  GREEN: number;
  EXPERIMENTAL: number;
  BLOCKED: number;
  REJECTED: number;
  eligible: number;
  tracked: number;
};

/**
 * Reporting helper. EXPERIMENTAL is listed separately and must never be summed
 * into GREEN / scientific-validation counts.
 */
export function summarizeScientificManifestStatus(
  records: readonly ScientificClaimManifestRecord[] = ALL_SCIENTIFIC_V7_CLAIM_RECORDS,
): ScientificManifestStatusCounts & {
  note: string;
} {
  const counts: ScientificManifestStatusCounts = {
    GREEN: 0,
    EXPERIMENTAL: 0,
    BLOCKED: 0,
    REJECTED: 0,
    eligible: 0,
    tracked: records.length,
  };
  for (const claim of records) {
    counts[claim.status] += 1;
  }
  counts.eligible = counts.GREEN + counts.EXPERIMENTAL + counts.BLOCKED;
  return {
    ...counts,
    note: "EXPERIMENTAL implementations are bounded heuristics with tests/provenance/uncertainty; they do not count as scientific validation.",
  };
}
