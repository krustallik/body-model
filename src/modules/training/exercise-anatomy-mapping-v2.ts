import type { CanonicalExerciseStableKey } from "./canonical-exercise-identity";

/** Additive descriptive mapping for anatomy present only in Body Map taxonomy v2. */
export const EXERCISE_ANATOMY_SNAPSHOT_V2_CONTRACT = "bodycast-exercise-anatomy-snapshot-v2" as const;
export const EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY = "anatomyMappingSnapshotV2" as const;
export const EXERCISE_ANATOMY_MAPPING_V2_VERSION = "bodycast-exercise-anatomy-mapping-v2.0.0" as const;
export const EXERCISE_ANATOMY_TAXONOMY_V2_VERSION = "bodycast-anatomy-taxonomy-v2" as const;

export type ExerciseAnatomyMappingV2Target = {
  anatomyId: string;
  role: "primary-mover" | "secondary-mover" | "stabilizer";
  coverage: "partial";
  evidence: readonly string[];
  limitation: string;
};

export type ExerciseAnatomyMappingV2 = {
  stableKey: CanonicalExerciseStableKey;
  movementConvention: { known: readonly string[]; notRecorded: readonly string[] };
  targets: readonly ExerciseAnatomyMappingV2Target[];
};

export type ExerciseAnatomySnapshotV2 = {
  contractVersion: typeof EXERCISE_ANATOMY_SNAPSHOT_V2_CONTRACT;
  mappingVersion: typeof EXERCISE_ANATOMY_MAPPING_V2_VERSION;
  taxonomyVersion: typeof EXERCISE_ANATOMY_TAXONOMY_V2_VERSION;
  stableKey: CanonicalExerciseStableKey;
  availability: "available";
  coverage: "partial";
  movementConvention: ExerciseAnatomyMappingV2["movementConvention"];
  targets: readonly Pick<ExerciseAnatomyMappingV2Target, "anatomyId" | "role" | "coverage">[];
  evidence: readonly string[];
  unresolvedDetails: readonly string[];
};

const splitSquatEvidence = ["bulgarian-split-squat-pmid-40867012"] as const;
const lungeEvidence = ["forward-lunge-pmid-39982282", "forward-lunge-pmid-32236133"] as const;
const gobletEvidence = ["goblet-squat-pmid-34341315"] as const;
const loadedCrunchEvidence = ["loaded-crunch-pmid-19376473", "loaded-curlup-pmid-29319600"] as const;
const rotationEvidence = ["trunk-rotation-pmid-9779398"] as const;

export const EXERCISE_ANATOMY_EVIDENCE_V2 = Object.freeze([
  { id: "bulgarian-split-squat-pmid-40867012", title: "Targeted muscle activation in Bulgarian split squat variations: effects of trunk position and suspension-based execution", url: "https://pubmed.ncbi.nlm.nih.gov/40867012/", limitation: "Small cross-sectional sample of trained female athletes and protocol-specific variations; acute EMG is not a per-set dose." },
  { id: "forward-lunge-pmid-39982282", title: "Effects of Step Length and Stride Variation During Forward Lunges on Lower-Extremity Muscle Activity", url: "https://pubmed.ncbi.nlm.nih.gov/39982282/", limitation: "Step length and stride materially changed muscle activity; exact user technique is not recorded." },
  { id: "forward-lunge-pmid-32236133", title: "Muscle activation during forward lunge variations", url: "https://pubmed.ncbi.nlm.nih.gov/32236133/", limitation: "The study used its own lunge setup; activation is not a longitudinal growth or dose measure." },
  { id: "goblet-squat-pmid-34341315", title: "Differences in Muscle Activity and Kinetics Between the Goblet Squat and Landmine Squat in Men and Women", url: "https://pubmed.ncbi.nlm.nih.gov/34341315/", limitation: "Measured vasti and hamstrings in a specific protocol; it does not quantify gluteal or abdominal dose." },
  { id: "loaded-crunch-pmid-19376473", title: "EMG activation of abdominal muscles in the crunch exercise performed with different external loads", url: "https://pubmed.ncbi.nlm.nih.gov/19376473/", limitation: "Acute EMG in a specific loaded crunch protocol; not a per-set dose estimate." },
  { id: "loaded-curlup-pmid-29319600", title: "Abdominal Muscle Activation During Common Modifications of the Trunk Curl-up Exercise", url: "https://pubmed.ncbi.nlm.nih.gov/29319600/", limitation: "Tested curl-up arm and twist variants, not the exact dumbbell placement or a hypertrophy outcome." },
  { id: "trunk-rotation-pmid-9779398", title: "Trunk muscle activities during asymmetric twisting motions", url: "https://pubmed.ncbi.nlm.nih.gov/9779398/", limitation: "Tested twisting exertions in defined postures, not the exact seated dumbbell Russian twist." },
].map((source) => Object.freeze(source)));

/** Descriptive target registry only; no dose, coefficient, or V7 formula is defined here. */
function defineMappingV2(mapping: ExerciseAnatomyMappingV2): ExerciseAnatomyMappingV2 {
  return Object.freeze({
    ...mapping,
    movementConvention: Object.freeze({
      known: Object.freeze([...mapping.movementConvention.known]),
      notRecorded: Object.freeze([...mapping.movementConvention.notRecorded]),
    }),
    targets: Object.freeze(mapping.targets.map((target) => Object.freeze({
      ...target,
      evidence: Object.freeze([...target.evidence]),
    }))),
  });
}

export const EXERCISE_ANATOMY_MAPPING_REGISTRY_V2: Readonly<Record<string, ExerciseAnatomyMappingV2 | undefined>> = Object.freeze({
  bulgarian_split_squat: defineMappingV2({
    stableKey: "bulgarian_split_squat",
    movementConvention: { known: ["rear-foot-elevated split squat", "dumbbell pair shown"], notRecorded: ["stance length", "trunk inclination", "depth", "front-foot position"] },
    targets: [
      { anatomyId: "quadriceps_femoris", role: "primary-mover", coverage: "partial", evidence: splitSquatEvidence, limitation: "Quadriceps are involved; protocol-dependent muscle activation does not establish an individual dose or exclusive emphasis." },
      { anatomyId: "gluteus_maximus", role: "primary-mover", coverage: "partial", evidence: splitSquatEvidence, limitation: "Gluteal involvement varies with execution; no per-muscle dose is inferred." },
      { anatomyId: "posterior_thigh", role: "secondary-mover", coverage: "partial", evidence: splitSquatEvidence, limitation: "Posterior-thigh contribution is not ranked or quantified for the unrecorded stance and trunk position." },
      { anatomyId: "abdominal_wall", role: "stabilizer", coverage: "partial", evidence: splitSquatEvidence, limitation: "Trunk stabilization is a movement demand, not a measured abdominal training dose." },
    ],
  }),
  forward_dumbbell_lunge: defineMappingV2({
    stableKey: "forward_dumbbell_lunge",
    movementConvention: { known: ["forward lunge", "dumbbell pair shown"], notRecorded: ["step length", "trunk inclination", "depth", "walking versus in-place sequence"] },
    targets: [
      { anatomyId: "quadriceps_femoris", role: "primary-mover", coverage: "partial", evidence: lungeEvidence, limitation: "Quadriceps are involved; step length and execution change measured muscle activity, so no individual dose is inferred." },
      { anatomyId: "gluteus_maximus", role: "primary-mover", coverage: "partial", evidence: lungeEvidence, limitation: "Gluteal involvement is supported but varies with execution; no individual dose is inferred." },
      { anatomyId: "posterior_thigh", role: "secondary-mover", coverage: "partial", evidence: lungeEvidence, limitation: "Posterior-thigh contribution is not ranked or quantified." },
      { anatomyId: "calf_complex", role: "stabilizer", coverage: "partial", evidence: lungeEvidence, limitation: "Calf activity depends on the tested technique and is not a measured training dose." },
      { anatomyId: "abdominal_wall", role: "stabilizer", coverage: "partial", evidence: lungeEvidence, limitation: "Trunk stabilization is a movement demand, not a measured abdominal training dose." },
    ],
  }),
  goblet_squat: defineMappingV2({
    stableKey: "goblet_squat",
    movementConvention: { known: ["dumbbell held at the chest"], notRecorded: ["stance", "depth", "torso inclination", "heel elevation"] },
    targets: [
      { anatomyId: "quadriceps_femoris", role: "primary-mover", coverage: "partial", evidence: gobletEvidence, limitation: "The comparison supports quadriceps involvement, not an individual dose or a universal ranking across squat techniques." },
      { anatomyId: "gluteus_maximus", role: "primary-mover", coverage: "partial", evidence: gobletEvidence, limitation: "Hip extension is part of the squat task; this source does not quantify gluteal dose." },
      { anatomyId: "adductor_region", role: "secondary-mover", coverage: "partial", evidence: gobletEvidence, limitation: "Adductor involvement is not resolved by the cited comparison; shown as a broad secondary association only." },
      { anatomyId: "abdominal_wall", role: "stabilizer", coverage: "partial", evidence: gobletEvidence, limitation: "The anterior load requires trunk control; no abdominal dose is inferred." },
    ],
  }),
  dumbbell_crunch: defineMappingV2({
    stableKey: "dumbbell_crunch",
    movementConvention: { known: ["loaded trunk curl-up with a dumbbell held at the chest"], notRecorded: ["dumbbell position", "range of motion", "tempo"] },
    targets: [
      { anatomyId: "rectus_abdominis", role: "primary-mover", coverage: "partial", evidence: loadedCrunchEvidence, limitation: "Loaded curl-up studies report trunk-muscle activation; they do not provide a per-set physiological dose." },
      { anatomyId: "external_oblique", role: "secondary-mover", coverage: "partial", evidence: loadedCrunchEvidence, limitation: "Oblique activity is reported in curl-up variants; its amount is not resolved for the exact execution." },
      { anatomyId: "internal_oblique", role: "secondary-mover", coverage: "partial", evidence: loadedCrunchEvidence, limitation: "Oblique activity is reported in curl-up variants; its amount is not resolved for the exact execution." },
    ],
  }),
  dumbbell_russian_twist: defineMappingV2({
    stableKey: "dumbbell_russian_twist",
    movementConvention: { known: ["seated trunk rotation with a dumbbell"], notRecorded: ["feet support", "rotation range", "hip motion", "dumbbell path"] },
    targets: [
      { anatomyId: "external_oblique", role: "primary-mover", coverage: "partial", evidence: rotationEvidence, limitation: "Rotation recruits obliques, but studied trunk-rotation variants do not establish a quantified dose for this exact exercise." },
      { anatomyId: "internal_oblique", role: "primary-mover", coverage: "partial", evidence: rotationEvidence, limitation: "Rotation recruits obliques, but studied trunk-rotation variants do not establish a quantified dose for this exact exercise." },
      { anatomyId: "rectus_abdominis", role: "secondary-mover", coverage: "partial", evidence: rotationEvidence, limitation: "Trunk flexor activity can accompany rotation; contribution is not quantified." },
    ],
  }),
});

const canonicalAnatomyIds = new Set([
  "abdominal_wall", "rectus_abdominis", "external_oblique", "internal_oblique", "transversus_abdominis",
  "quadriceps_femoris", "rectus_femoris", "vastus_lateralis", "vastus_medialis", "vastus_intermedius",
  "posterior_thigh", "biceps_femoris_short_head", "gluteus_medius", "gluteus_minimus", "adductor_region",
  "adductor_longus", "adductor_brevis", "adductor_magnus", "gracilis", "pectineus", "hip_abductor_region",
  "tensor_fasciae_latae", "hip_flexor_region", "iliacus", "psoas_major", "calf_complex",
  "gastrocnemius_lateral_head", "gastrocnemius_medial_head", "soleus", "anterior_lower_leg_compartment",
  "tibialis_anterior", "extensor_digitorum_longus", "lateral_lower_leg_compartment", "fibularis_longus",
  "fibularis_brevis", "rotator_cuff", "supraspinatus", "infraspinatus", "teres_minor", "subscapularis",
  "serratus_anterior", "pectoralis_major", "pectoralis_major_clavicular_head", "pectoralis_major_sternocostal_head",
  "deltoid", "deltoid_anterior", "deltoid_middle", "deltoid_posterior", "triceps_brachii", "triceps_long_head",
  "triceps_lateral_head", "triceps_medial_head", "biceps_brachii", "biceps_brachii_long_head",
  "biceps_brachii_short_head", "brachialis", "brachioradialis", "latissimus_dorsi", "trapezius",
  "trapezius_upper", "trapezius_middle", "trapezius_lower", "rhomboid_region", "rhomboid_major",
  "rhomboid_minor", "forearm_flexor_region", "forearm_extensor_region", "erector_spinae",
  "erector_spinae_lumbar_region", "erector_spinae_thoracic_region", "gluteus_maximus", "hamstrings",
  "biceps_femoris_long_head", "semitendinosus", "semimembranosus",
]);

export function buildExerciseAnatomySnapshotV2(stableKey: string | null | undefined): ExerciseAnatomySnapshotV2 | null {
  if (!stableKey) return null;
  const mapping = EXERCISE_ANATOMY_MAPPING_REGISTRY_V2[stableKey];
  if (!mapping) return null;
  if (mapping.targets.some(({ anatomyId }) => !canonicalAnatomyIds.has(anatomyId))) {
    throw new Error(`Unknown Body Map v2 anatomy target for ${stableKey}`);
  }
  return {
    contractVersion: EXERCISE_ANATOMY_SNAPSHOT_V2_CONTRACT,
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V2_VERSION,
    taxonomyVersion: EXERCISE_ANATOMY_TAXONOMY_V2_VERSION,
    stableKey: mapping.stableKey,
    availability: "available",
    coverage: "partial",
    movementConvention: { known: [...mapping.movementConvention.known], notRecorded: [...mapping.movementConvention.notRecorded] },
    targets: mapping.targets.map(({ anatomyId, role, coverage }) => ({ anatomyId, role, coverage })),
    evidence: [...new Set(mapping.targets.flatMap(({ evidence }) => evidence))],
    unresolvedDetails: ["Technique is not fully represented by the session record.", "Targets describe qualitative anatomy only; they do not define V7 physiology or a numerical training dose."],
  };
}

export function parseExerciseAnatomySnapshotV2(value: unknown): ExerciseAnatomySnapshotV2 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.contractVersion !== EXERCISE_ANATOMY_SNAPSHOT_V2_CONTRACT
    || raw.mappingVersion !== EXERCISE_ANATOMY_MAPPING_V2_VERSION
    || raw.taxonomyVersion !== EXERCISE_ANATOMY_TAXONOMY_V2_VERSION
    || raw.availability !== "available"
    || raw.coverage !== "partial"
    || typeof raw.stableKey !== "string") return null;
  const expected = buildExerciseAnatomySnapshotV2(raw.stableKey);
  if (!expected) return null;
  const movement = raw.movementConvention && typeof raw.movementConvention === "object" && !Array.isArray(raw.movementConvention)
    ? raw.movementConvention as Record<string, unknown>
    : null;
  const targetRows = Array.isArray(raw.targets) ? raw.targets : null;
  const targetsMatch = targetRows !== null
    && targetRows.length === expected.targets.length
    && targetRows.every((entry, index) => {
      const target = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
      const wanted = expected.targets[index];
      return target?.anatomyId === wanted.anatomyId
        && target.role === wanted.role
        && target.coverage === wanted.coverage;
    });
  if (raw.stableKey !== expected.stableKey
    || raw.coverage !== expected.coverage
    || !movement
    || JSON.stringify(movement.known) !== JSON.stringify(expected.movementConvention.known)
    || JSON.stringify(movement.notRecorded) !== JSON.stringify(expected.movementConvention.notRecorded)
    || !targetsMatch
    || JSON.stringify(raw.evidence) !== JSON.stringify(expected.evidence)
    || JSON.stringify(raw.unresolvedDetails) !== JSON.stringify(expected.unresolvedDetails)) return null;
  return expected;
}
