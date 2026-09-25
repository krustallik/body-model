import type { CanonicalExerciseStableKey } from "./canonical-exercise-identity";
import { CANONICAL_MUSCLE_GROUPS_V7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildExerciseMuscleMappingSnapshotV7,
  EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT,
  parseExerciseMuscleMappingSnapshotV7,
  type ExerciseMuscleMappingSnapshotV7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";

/** Descriptive exercise-to-anatomy mapping. This is not a physiology/dose model. */
export const EXERCISE_ANATOMY_MAPPING_V1_VERSION =
  "bodycast-exercise-anatomy-mapping-v1" as const;
export const ANATOMY_TAXONOMY_V1_VERSION = "bodycast-anatomy-taxonomy-v1" as const;
export const EXERCISE_ANATOMY_SNAPSHOT_V1_CONTRACT =
  "bodycast-exercise-anatomy-snapshot-v1" as const;
export const EXERCISE_ANATOMY_SNAPSHOT_PROPERTY = "anatomyMappingSnapshotV1" as const;

/** Reuse the existing V7 group IDs as the sole analytics-group ID source. */
export const ANATOMY_ANALYTICS_GROUP_IDS_V1 = CANONICAL_MUSCLE_GROUPS_V7;
export type AnatomyAnalyticsGroupIdV1 = (typeof ANATOMY_ANALYTICS_GROUP_IDS_V1)[number];

export type AnatomyAnalyticsGroupDefinitionV1 = {
  id: AnatomyAnalyticsGroupIdV1;
  kind: "anatomical-group" | "functional-group";
  label: string;
  note: string;
};

/** Legacy analytics IDs have explicit semantics; hip_extensors is functional. */
const analyticsGroupDefinitionsV1: AnatomyAnalyticsGroupDefinitionV1[] = [
  { id: "chest", kind: "anatomical-group", label: "Chest", note: "Composite group crosswalk; not a single anatomical muscle." },
  { id: "deltoids", kind: "anatomical-group", label: "Deltoids", note: "Deltoid muscle and supported portions." },
  { id: "triceps", kind: "anatomical-group", label: "Triceps", note: "Triceps brachii; head-specific exposure is not implied by a parent target." },
  { id: "back", kind: "anatomical-group", label: "Back", note: "Upper-back muscle crosswalk; erector spinae remains in spinal_extensors." },
  { id: "biceps", kind: "anatomical-group", label: "Elbow flexor analytics group", note: "Legacy group includes crosswalked elbow flexors; it does not make brachialis a biceps head." },
  { id: "forearms", kind: "anatomical-group", label: "Forearms", note: "Forearm regions and brachioradialis crosswalk." },
  { id: "spinal_extensors", kind: "anatomical-group", label: "Spinal extensors", note: "Separate from the back crosswalk." },
  { id: "hip_extensors", kind: "functional-group", label: "Hip extensors", note: "Functional grouping of gluteal and hip-extending hamstring anatomy; not one muscle." },
];
export const ANATOMY_ANALYTICS_GROUP_DEFINITIONS_V1: readonly AnatomyAnalyticsGroupDefinitionV1[] =
  Object.freeze(analyticsGroupDefinitionsV1.map((entry) => Object.freeze(entry)));

export type AnatomyNodeKindV1 = "muscle" | "muscle-part" | "functional-region";
export type AnatomyVisualStatusV1 = "unverified" | "unsupported-surface";

export type AnatomyNodeV1 = {
  id: string;
  parentId: string | null;
  kind: AnatomyNodeKindV1;
  /** Display text belongs to the data catalog; consumers key off `id`. */
  label: string;
  visualStatus: AnatomyVisualStatusV1;
};

/** Anatomy IDs describe anatomical structures; analytics groups are a separate crosswalk. */
export const ANATOMY_TAXONOMY_V1: readonly AnatomyNodeV1[] = [
  { id: "pectoralis_major", parentId: null, kind: "muscle", label: "Pectoralis major", visualStatus: "unverified" },
  { id: "pectoralis_major_clavicular_head", parentId: "pectoralis_major", kind: "muscle-part", label: "Clavicular head of pectoralis major", visualStatus: "unverified" },
  { id: "pectoralis_major_sternocostal_head", parentId: "pectoralis_major", kind: "muscle-part", label: "Sternocostal head of pectoralis major", visualStatus: "unverified" },
  { id: "deltoid", parentId: null, kind: "muscle", label: "Deltoid", visualStatus: "unverified" },
  { id: "deltoid_anterior", parentId: "deltoid", kind: "muscle-part", label: "Anterior deltoid", visualStatus: "unverified" },
  { id: "deltoid_middle", parentId: "deltoid", kind: "muscle-part", label: "Middle (acromial) deltoid", visualStatus: "unverified" },
  { id: "deltoid_posterior", parentId: "deltoid", kind: "muscle-part", label: "Posterior deltoid", visualStatus: "unverified" },
  { id: "triceps_brachii", parentId: null, kind: "muscle", label: "Triceps brachii", visualStatus: "unverified" },
  { id: "triceps_long_head", parentId: "triceps_brachii", kind: "muscle-part", label: "Long head of triceps brachii", visualStatus: "unverified" },
  { id: "triceps_lateral_head", parentId: "triceps_brachii", kind: "muscle-part", label: "Lateral head of triceps brachii", visualStatus: "unverified" },
  { id: "triceps_medial_head", parentId: "triceps_brachii", kind: "muscle-part", label: "Medial head of triceps brachii", visualStatus: "unverified" },
  { id: "biceps_brachii", parentId: null, kind: "muscle", label: "Biceps brachii", visualStatus: "unverified" },
  { id: "biceps_brachii_long_head", parentId: "biceps_brachii", kind: "muscle-part", label: "Long head of biceps brachii", visualStatus: "unverified" },
  { id: "biceps_brachii_short_head", parentId: "biceps_brachii", kind: "muscle-part", label: "Short head of biceps brachii", visualStatus: "unverified" },
  { id: "brachialis", parentId: null, kind: "muscle", label: "Brachialis", visualStatus: "unverified" },
  { id: "brachioradialis", parentId: null, kind: "muscle", label: "Brachioradialis", visualStatus: "unverified" },
  { id: "latissimus_dorsi", parentId: null, kind: "muscle", label: "Latissimus dorsi", visualStatus: "unverified" },
  { id: "trapezius", parentId: null, kind: "muscle", label: "Trapezius", visualStatus: "unverified" },
  { id: "trapezius_upper", parentId: "trapezius", kind: "muscle-part", label: "Upper trapezius", visualStatus: "unverified" },
  { id: "trapezius_middle", parentId: "trapezius", kind: "muscle-part", label: "Middle trapezius", visualStatus: "unverified" },
  { id: "trapezius_lower", parentId: "trapezius", kind: "muscle-part", label: "Lower trapezius", visualStatus: "unverified" },
  { id: "rhomboid_region", parentId: null, kind: "functional-region", label: "Rhomboid region", visualStatus: "unsupported-surface" },
  { id: "rhomboid_major", parentId: "rhomboid_region", kind: "muscle", label: "Rhomboid major", visualStatus: "unsupported-surface" },
  { id: "rhomboid_minor", parentId: "rhomboid_region", kind: "muscle", label: "Rhomboid minor", visualStatus: "unsupported-surface" },
  { id: "forearm_flexor_region", parentId: null, kind: "functional-region", label: "Forearm flexor region", visualStatus: "unverified" },
  { id: "forearm_extensor_region", parentId: null, kind: "functional-region", label: "Forearm extensor region", visualStatus: "unverified" },
  { id: "erector_spinae", parentId: null, kind: "functional-region", label: "Erector spinae region", visualStatus: "unverified" },
  { id: "erector_spinae_lumbar_region", parentId: "erector_spinae", kind: "functional-region", label: "Lumbar erector spinae region", visualStatus: "unverified" },
  { id: "erector_spinae_thoracic_region", parentId: "erector_spinae", kind: "functional-region", label: "Thoracic erector spinae region", visualStatus: "unverified" },
  { id: "gluteus_maximus", parentId: null, kind: "muscle", label: "Gluteus maximus", visualStatus: "unverified" },
  { id: "hamstrings", parentId: null, kind: "functional-region", label: "Hip-extending hamstring region", visualStatus: "unverified" },
  { id: "biceps_femoris_long_head", parentId: "hamstrings", kind: "muscle-part", label: "Long head of biceps femoris", visualStatus: "unverified" },
  { id: "semitendinosus", parentId: "hamstrings", kind: "muscle", label: "Semitendinosus", visualStatus: "unverified" },
  { id: "semimembranosus", parentId: "hamstrings", kind: "muscle", label: "Semimembranosus", visualStatus: "unverified" },
] as const;

export const ANATOMY_VISUAL_REPRESENTATION_V1_VERSION =
  "bodycast-anatomy-visual-representation-v1" as const;
export type AnatomyVisualRepresentationKindV1 =
  | "selectable-surface"
  | "composite-selectable-surfaces"
  | "deep-occluded"
  | "schematic-detail-only"
  | "unsupported-in-current-asset";
export type AnatomyVisualRepresentationV1 = {
  anatomyId: string;
  intendedRepresentation: Exclude<AnatomyVisualRepresentationKindV1, "unsupported-in-current-asset">;
  currentAssetStatus: "unsupported-in-current-asset";
  sideMode: "left-right" | "midline";
  note: string;
};

/**
 * Presentation contract for the shared anatomy IDs. It describes honest visual
 * behavior; it does not claim that checkpoint-2's generic skin shell is segmented.
 */
const anatomyVisualRepresentationEntriesV1: AnatomyVisualRepresentationV1[] = [
  { anatomyId: "pectoralis_major", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Use one superficial surface per side; parent selection may compose both. Do not infer head-specific loading." },
  { anatomyId: "pectoralis_major_clavicular_head", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Head boundary is not a reliable skin seam on this base mesh; regional association stays qualitative." },
  { anatomyId: "pectoralis_major_sternocostal_head", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Do not split a visible chest surface into unsupported head-level exposure." },
  { anatomyId: "deltoid", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Parent view composes only the deltoid regions that have verified selectable geometry." },
  { anatomyId: "deltoid_anterior", intendedRepresentation: "selectable-surface", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Requires a manually reviewed deltopectoral and upper-arm boundary." },
  { anatomyId: "deltoid_middle", intendedRepresentation: "selectable-surface", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Requires a manually reviewed acromial/lateral boundary; no numeric stimulus claim." },
  { anatomyId: "deltoid_posterior", intendedRepresentation: "selectable-surface", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Belongs to deltoids only; do not also classify this surface as back." },
  { anatomyId: "triceps_brachii", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Parent selection may compose verified superficial triceps surfaces; head roles remain in mapping." },
  { anatomyId: "triceps_long_head", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Do not create a head-specific skin patch from the parent-only exercise mappings." },
  { anatomyId: "triceps_lateral_head", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Potentially visible anatomy, but a distinct boundary is not present in the supplied shell." },
  { anatomyId: "triceps_medial_head", intendedRepresentation: "deep-occluded", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Keep as deep anatomy; do not project it onto the skin as an independent region." },
  { anatomyId: "biceps_brachii", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "One broad superficial biceps surface per side; head identity remains broader unless separately supported." },
  { anatomyId: "biceps_brachii_long_head", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Do not infer a selectable head from a parent biceps target." },
  { anatomyId: "biceps_brachii_short_head", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Do not infer a selectable head from a parent biceps target." },
  { anatomyId: "brachialis", intendedRepresentation: "deep-occluded", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "A distinct muscle, not a biceps head; it is deep and should not be painted as a skin region." },
  { anatomyId: "brachioradialis", intendedRepresentation: "selectable-surface", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Potential superficial forearm structure; requires manual boundary verification." },
  { anatomyId: "latissimus_dorsi", intendedRepresentation: "selectable-surface", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Broad posterior/lateral surface; boundary requires manual review against axilla and waist landmarks." },
  { anatomyId: "trapezius", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Parent view may compose verified upper/middle/lower surfaces." },
  { anatomyId: "trapezius_upper", intendedRepresentation: "selectable-surface", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Requires a reviewed neck/shoulder boundary." },
  { anatomyId: "trapezius_middle", intendedRepresentation: "selectable-surface", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Keep scapular region separate from latissimus only after manual review." },
  { anatomyId: "trapezius_lower", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "A skin patch would imply a boundary not represented by the supplied shell." },
  { anatomyId: "rhomboid_region", intendedRepresentation: "deep-occluded", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Deep to trapezius; high-level back can remain selectable without a false rhomboid skin patch." },
  { anatomyId: "rhomboid_major", intendedRepresentation: "deep-occluded", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Deep to trapezius; not independently selectable on the skin shell." },
  { anatomyId: "rhomboid_minor", intendedRepresentation: "deep-occluded", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Deep to trapezius; not independently selectable on the skin shell." },
  { anatomyId: "forearm_flexor_region", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Use a broad flexor-compartment region; do not imply individual forearm muscles." },
  { anatomyId: "forearm_extensor_region", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Use a broad extensor-compartment region; do not imply individual forearm muscles." },
  { anatomyId: "erector_spinae", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Separate posterior spinal columns from trapezius/back surfaces; no overlap in group identity." },
  { anatomyId: "erector_spinae_lumbar_region", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Subregion requires an authored boundary; parent-level mapping must remain parent-level." },
  { anatomyId: "erector_spinae_thoracic_region", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Subregion requires an authored boundary; parent-level mapping must remain parent-level." },
  { anatomyId: "gluteus_maximus", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Bilateral gluteal surfaces form the glute component of the hip_extensors functional group." },
  { anatomyId: "hamstrings", intendedRepresentation: "composite-selectable-surfaces", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Represent as posterior-thigh composite, not as one single muscle." },
  { anatomyId: "biceps_femoris_long_head", intendedRepresentation: "schematic-detail-only", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Posterior-thigh composite is safer than an unsupported head boundary." },
  { anatomyId: "semitendinosus", intendedRepresentation: "deep-occluded", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Do not surface-project a deep posterior-thigh muscle from parent-level exposure." },
  { anatomyId: "semimembranosus", intendedRepresentation: "deep-occluded", currentAssetStatus: "unsupported-in-current-asset", sideMode: "left-right", note: "Do not surface-project a deep posterior-thigh muscle from parent-level exposure." },
];
export const ANATOMY_VISUAL_REPRESENTATION_V1: readonly AnatomyVisualRepresentationV1[] =
  Object.freeze(anatomyVisualRepresentationEntriesV1.map((entry) => Object.freeze(entry)));

export function stableVisualRegionIdV1(
  anatomyId: string,
  side: "left" | "right" | "midline",
  surfaceKey = "main",
): string {
  if (!ANATOMY_TAXONOMY_V1.some((node) => node.id === anatomyId)) {
    throw new Error(`Unknown anatomy ID for visual region: ${anatomyId}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(surfaceKey)) {
    throw new Error(`Invalid stable visual surface key: ${surfaceKey}`);
  }
  return `bodycast.visual-region.v1.${anatomyId}.${side}.${surfaceKey}`;
}

export type AnatomyAnalyticsCrosswalkEntryV1 = {
  anatomyId: string;
  analyticsGroupId: AnatomyAnalyticsGroupIdV1;
};

export const ANATOMY_ANALYTICS_CROSSWALK_V1: readonly AnatomyAnalyticsCrosswalkEntryV1[] = [
  ...["pectoralis_major", "pectoralis_major_clavicular_head", "pectoralis_major_sternocostal_head"]
    .map((anatomyId) => ({ anatomyId, analyticsGroupId: "chest" as const })),
  ...["deltoid", "deltoid_anterior", "deltoid_middle", "deltoid_posterior"]
    .map((anatomyId) => ({ anatomyId, analyticsGroupId: "deltoids" as const })),
  ...["triceps_brachii", "triceps_long_head", "triceps_lateral_head", "triceps_medial_head"]
    .map((anatomyId) => ({ anatomyId, analyticsGroupId: "triceps" as const })),
  ...["biceps_brachii", "biceps_brachii_long_head", "biceps_brachii_short_head", "brachialis", "brachioradialis"]
    .map((anatomyId) => ({ anatomyId, analyticsGroupId: "biceps" as const })),
  { anatomyId: "brachioradialis", analyticsGroupId: "forearms" },
  ...["latissimus_dorsi", "trapezius", "trapezius_upper", "trapezius_middle", "trapezius_lower", "rhomboid_region", "rhomboid_major", "rhomboid_minor"]
    .map((anatomyId) => ({ anatomyId, analyticsGroupId: "back" as const })),
  ...["forearm_flexor_region", "forearm_extensor_region"]
    .map((anatomyId) => ({ anatomyId, analyticsGroupId: "forearms" as const })),
  { anatomyId: "erector_spinae", analyticsGroupId: "spinal_extensors" },
  { anatomyId: "erector_spinae_lumbar_region", analyticsGroupId: "spinal_extensors" },
  { anatomyId: "erector_spinae_thoracic_region", analyticsGroupId: "spinal_extensors" },
  ...["gluteus_maximus", "hamstrings", "biceps_femoris_long_head", "semitendinosus", "semimembranosus"]
    .map((anatomyId) => ({ anatomyId, analyticsGroupId: "hip_extensors" as const })),
];

export type AnatomyEvidenceDomainV1 =
  | "anatomy-reference"
  | "exercise-biomechanics"
  | "acute-emg"
  | "longitudinal-adaptation";

export type AnatomyEvidenceSourceV1 = {
  id: string;
  title: string;
  url: string;
  domain: AnatomyEvidenceDomainV1;
  limitations: string;
};

/** Primary studies and anatomy references used for qualitative claims only. */
export const ANATOMY_EVIDENCE_SOURCES_V1: readonly AnatomyEvidenceSourceV1[] = [
  { id: "anatomy-pectoralis-ncbi", title: "StatPearls: Anatomy, Thorax, Ribs", url: "https://www.ncbi.nlm.nih.gov/books/NBK538328/", domain: "anatomy-reference", limitations: "Anatomical structure/functions; not evidence of exercise-specific stimulus." },
  { id: "anatomy-deltoid-ncbi", title: "StatPearls: Anatomy, Shoulder and Upper Limb, Deltoid Muscle", url: "https://www.ncbi.nlm.nih.gov/books/NBK537056/", domain: "anatomy-reference", limitations: "Anatomical parts/functions; not evidence of exercise-specific hypertrophy." },
  { id: "anatomy-triceps-ncbi", title: "StatPearls: Anatomy, Shoulder and Upper Limb, Triceps Muscle", url: "https://www.ncbi.nlm.nih.gov/sites/books/NBK536996/", domain: "anatomy-reference", limitations: "Confirms three heads and actions; does not resolve the logged exercise technique." },
  { id: "anatomy-elbow-flexors-ncbi", title: "StatPearls: Anatomy, Shoulder and Upper Limb, Arm Muscles", url: "https://www.ncbi.nlm.nih.gov/books/NBK554420/", domain: "anatomy-reference", limitations: "Anatomical identities/functions; does not establish relative loading during a specific curl." },
  { id: "anatomy-forearm-ncbi", title: "StatPearls: Anatomy, Shoulder and Upper Limb, Forearm Muscles", url: "https://www.ncbi.nlm.nih.gov/books/NBK536975/", domain: "anatomy-reference", limitations: "Compartment anatomy; an entire region is used where individual muscles cannot be resolved." },
  { id: "anatomy-posterior-thigh-ncbi", title: "StatPearls: Anatomy, Bony Pelvis and Lower Limb, Posterior Thigh", url: "https://www.ncbi.nlm.nih.gov/books/NBK554598/", domain: "anatomy-reference", limitations: "Separates hip-extending hamstrings from the biceps femoris short head; not exercise-specific." },
  { id: "pectoral-bench-angle-pmid-25799093", title: "Influence of bench angle on upper extremity muscular activation during bench press", url: "https://pubmed.ncbi.nlm.nih.gov/25799093/", domain: "acute-emg", limitations: "Acute barbell bench-press EMG; effects varied across movement phases and do not prove hypertrophy or exclusive clavicular loading." },
  { id: "pectoral-bench-review-2023", title: "Electromyographic Activity of the Pectoralis Major during Traditional Bench Press and Other Variants: Systematic Review and Meta-Analysis", url: "https://www.mdpi.com/2076-3417/13/8/5203", domain: "acute-emg", limitations: "Heterogeneous acute EMG protocols; clavicular findings were not uniform and are not growth estimates." },
  { id: "fly-pmid-33239937", title: "A Comparison of Muscle Activation between Barbell Bench Press and Dumbbell Flyes in Resistance-Trained Males", url: "https://pubmed.ncbi.nlm.nih.gov/33239937/", domain: "acute-emg", limitations: "Small acute comparison; does not resolve pectoralis head-specific activation or long-term adaptation." },
  { id: "fly-pmid-14626721", title: "Electromyographic analysis of the pectoralis major and anterior deltoid in horizontal flyer exercises", url: "https://pubmed.ncbi.nlm.nih.gov/14626721/", domain: "acute-emg", limitations: "Small acute study; loading phases and participants limit generalization." },
  { id: "pushup-pmid-16095413", title: "Comparison of muscle activation using various hand positions during the push-up exercise", url: "https://pubmed.ncbi.nlm.nih.gov/16095413/", domain: "acute-emg", limitations: "Tests hand positions, not the user's exact handles, depth, body angle, or long-term adaptation." },
  { id: "deltoid-exercise-pmid-33312291", title: "Different Shoulder Exercises Affect the Activation of Deltoid Portions in Resistance-Trained Individuals", url: "https://pubmed.ncbi.nlm.nih.gov/33312291/", domain: "acute-emg", limitations: "Small acute EMG study; not a measure of regional hypertrophy." },
  { id: "deltoid-review-pmid-39593452", title: "Activation of the three deltoid muscle portions during common strengthening exercises: A systematic review", url: "https://pubmed.ncbi.nlm.nih.gov/39593452/", domain: "acute-emg", limitations: "Systematic review of acute activation evidence; methods and exercise variants differ." },
  { id: "lateral-raise-rct-2025", title: "Dumbbell versus cable lateral raises for lateral deltoid hypertrophy: an experimental study", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12277279/", domain: "longitudinal-adaptation", limitations: "Specific study protocol and population; supports a qualitative lateral-deltoid association only." },
  { id: "triceps-position-rct-pmid-35819335", title: "Triceps brachii hypertrophy is substantially greater after elbow extension training performed overhead versus neutral", url: "https://pubmed.ncbi.nlm.nih.gov/35819335/", domain: "longitudinal-adaptation", limitations: "Demonstrates position matters in tested conditions; the catalog does not record shoulder position for its extensions." },
  { id: "row-review-pmid-42647355", title: "Electromyographic Analysis of Latissimus Dorsi Activation During Common Resistance Training Exercises: A Narrative Review", url: "https://pubmed.ncbi.nlm.nih.gov/42647355/", domain: "acute-emg", limitations: "Narrative review of heterogeneous EMG studies; does not identify the user's exact one-arm row trajectory." },
  { id: "pullup-pmid-32715526", title: "Avoiding high-risk rotator cuff loading: Muscle force during three pull-up techniques", url: "https://pubmed.ncbi.nlm.nih.gov/32715526/", domain: "exercise-biomechanics", limitations: "Compares three specific pull-up variants; the user's logged grip and technique are unknown." },
  { id: "pullup-pmid-28011412", title: "Electromyographic analysis of muscle activation during pull-up variations", url: "https://pubmed.ncbi.nlm.nih.gov/28011412/", domain: "acute-emg", limitations: "Small acute comparison of grip variants; cannot be applied as a head-specific or hypertrophy score." },
  { id: "back-extension-pmid-28451436", title: "Loading conditions in the spine, hip and knee during different executions of back extension exercises", url: "https://pubmed.ncbi.nlm.nih.gov/28451436/", domain: "exercise-biomechanics", limitations: "Contrasts dynamic hip and dynamic spine execution; the historical exercise record does not identify either form." },
  { id: "extension-pmid-26504276", title: "Comparison of trunk and hip muscle activity during different degrees of lumbar and hip extension", url: "https://pubmed.ncbi.nlm.nih.gov/26504276/", domain: "acute-emg", limitations: "Small acute study comparing specific extension techniques; not a hypertrophy estimate." },
  { id: "curl-pmc-10054060", title: "Biceps Brachii and Brachioradialis Excitation in Biceps Curl Exercise: Different Handgrips, Different Synergy", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10054060/", domain: "acute-emg", limitations: "Compares defined grip conditions; logged variants do not establish grip/rotation timing or head-specific growth." },
  { id: "curl-pmid-26300781", title: "Muscular coordination of biceps brachii and brachioradialis in elbow flexion with respect to hand position", url: "https://pubmed.ncbi.nlm.nih.gov/26300781/", domain: "exercise-biomechanics", limitations: "Supports task- and hand-position dependence, not a mapping for an unrecorded grip." },
  { id: "back-extension-hip-muscle-pmid-27583647", title: "Comparison of gluteus maximus and hamstring EMG activity and lumbopelvic motion during prone hip extension", url: "https://pubmed.ncbi.nlm.nih.gov/27583647/", domain: "acute-emg", limitations: "Specific prone hip-extension variants and compensations; not the catalog's unspecified hyperextension technique." },
] as const;

export type ExerciseAnatomyRoleV1 =
  | "primary-mover"
  | "secondary-mover"
  | "stabilizer"
  | "role-unspecified";
export type ExerciseAnatomyTargetV1 = {
  anatomyId: string;
  role: ExerciseAnatomyRoleV1;
  coverage: "supported" | "partial" | "parent-only";
  evidenceIds: readonly string[];
  limitation: string;
};
export type RegionalAssociationV1 = {
  anatomyId: string;
  kind: "qualitative-non-exclusive-association";
  evidenceIds: readonly string[];
  limitation: string;
};
export type MovementConventionV1 = {
  id: string;
  version: "bodycast-movement-conventions-v1";
  known: readonly string[];
  notRecorded: readonly string[];
};
export type ExerciseAnatomyMappingV1 = {
  mappingVersion: typeof EXERCISE_ANATOMY_MAPPING_V1_VERSION;
  taxonomyVersion: typeof ANATOMY_TAXONOMY_V1_VERSION;
  stableKey: CanonicalExerciseStableKey;
  coverage: "supported" | "partial";
  movementConvention: MovementConventionV1;
  targets: readonly ExerciseAnatomyTargetV1[];
  supportedRegionalAssociations: readonly RegionalAssociationV1[];
  unresolvedDetails: readonly string[];
};

const A = {
  pectoralis: "anatomy-pectoralis-ncbi",
  deltoid: "anatomy-deltoid-ncbi",
  triceps: "anatomy-triceps-ncbi",
  elbowFlexors: "anatomy-elbow-flexors-ncbi",
  forearm: "anatomy-forearm-ncbi",
  posteriorThigh: "anatomy-posterior-thigh-ncbi",
  benchAngle: "pectoral-bench-angle-pmid-25799093",
  benchReview: "pectoral-bench-review-2023",
  fly: "fly-pmid-33239937",
  flyClassic: "fly-pmid-14626721",
  pushup: "pushup-pmid-16095413",
  shoulderPress: "deltoid-exercise-pmid-33312291",
  deltoidReview: "deltoid-review-pmid-39593452",
  lateralRct: "lateral-raise-rct-2025",
  tricepsPosition: "triceps-position-rct-pmid-35819335",
  row: "row-review-pmid-42647355",
  pullup: "pullup-pmid-32715526",
  pullupEmg: "pullup-pmid-28011412",
  backExtension: "back-extension-pmid-28451436",
  extensionEmg: "extension-pmid-26504276",
  curl: "curl-pmc-10054060",
  curlTask: "curl-pmid-26300781",
  hipExtension: "back-extension-hip-muscle-pmid-27583647",
} as const;

function convention(
  id: string,
  known: readonly string[],
  notRecorded: readonly string[],
): MovementConventionV1 {
  return { id, version: "bodycast-movement-conventions-v1", known, notRecorded };
}

function target(
  anatomyId: string,
  role: ExerciseAnatomyRoleV1,
  coverage: ExerciseAnatomyTargetV1["coverage"],
  evidenceIds: readonly string[],
  limitation: string,
): ExerciseAnatomyTargetV1 {
  return { anatomyId, role, coverage, evidenceIds, limitation };
}

const noSubregionClaim = "No finer head/region allocation is supported for the recorded convention.";

/** Registry keyed only by stableKey. No display-name or fuzzy-name lookup is permitted. */
const mutableExerciseAnatomyEntries: Map<
  CanonicalExerciseStableKey,
  ExerciseAnatomyMappingV1
> = new Map([
  ["incline_dumbbell_press_30deg", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "incline_dumbbell_press_30deg",
    coverage: "partial",
    movementConvention: convention("incline-dumbbell-press-30deg-v1", ["dumbbell press", "incline angle identified as 30 degrees"], ["grip", "range of motion", "elbow path", "individual shoulder plane"]),
    targets: [
      target("pectoralis_major", "primary-mover", "supported", [A.pectoralis, A.benchAngle, A.benchReview], "The pectoralis major is the primary broad target; studies of bench angles do not establish exclusive upper-chest work."),
      target("pectoralis_major_clavicular_head", "primary-mover", "partial", [A.pectoralis, A.benchAngle, A.benchReview], "Qualitative association only: acute regional findings at moderate incline are heterogeneous and do not prove greater hypertrophy."),
      target("deltoid_anterior", "secondary-mover", "supported", [A.deltoid, A.shoulderPress, A.benchAngle], "Anterior deltoid contributes to pressing; its share is not quantified."),
      target("triceps_brachii", "secondary-mover", "parent-only", [A.triceps], "Elbow extension is present; shoulder position and head-specific contribution are not inferred."),
    ],
    supportedRegionalAssociations: [{ anatomyId: "pectoralis_major_clavicular_head", kind: "qualitative-non-exclusive-association", evidenceIds: [A.benchAngle, A.benchReview], limitation: "The 30-degree association is not a claim that only the clavicular head works; acute EMG findings vary by protocol and phase and are not hypertrophy estimates." }],
    unresolvedDetails: ["No exclusive upper-chest claim", "No individual triceps-head emphasis"],
  }],
  ["flat_dumbbell_fly", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "flat_dumbbell_fly",
    coverage: "partial",
    movementConvention: convention("flat-dumbbell-fly-v1", ["dumbbell fly", "flat bench identity"], ["humeral rotation", "elbow flexion angle", "range of motion", "depth"]),
    targets: [
      target("pectoralis_major", "primary-mover", "parent-only", [A.pectoralis, A.fly, A.flyClassic], "The exercise supports a pectoralis-major target; head-level mapping is not established."),
      target("deltoid_anterior", "secondary-mover", "partial", [A.deltoid, A.fly, A.flyClassic], "Anterior deltoid activity is reported in acute fly studies, but is not treated as a quantified stimulus."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: [noSubregionClaim, "Exact arm path and humeral rotation are not recorded."],
  }],
  ["pushup_handles", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "pushup_handles",
    coverage: "partial",
    movementConvention: convention("pushup-handles-v1", ["push-up", "handles are named in exercise identity"], ["hand spacing", "body inclination", "depth", "handle stability"]),
    targets: [
      target("pectoralis_major", "primary-mover", "parent-only", [A.pectoralis, A.pushup], "Push-up studies support broad pectoralis participation; handle-specific subregion effects are not established."),
      target("triceps_brachii", "primary-mover", "parent-only", [A.triceps, A.pushup], "Triceps contribute to elbow extension; no head-specific contribution is inferred."),
      target("deltoid_anterior", "secondary-mover", "partial", [A.deltoid, A.pushup], "Evidence from push-up variants supports anterior shoulder participation, with limited transfer to this exact handle setup."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: [noSubregionClaim, "Handle support may change wrist position, but this mapping does not imply a muscle-region effect."],
  }],
  ["seated_dumbbell_press", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "seated_dumbbell_press",
    coverage: "partial",
    movementConvention: convention("seated-dumbbell-press-v1", ["seated dumbbell press"], ["bench backrest angle", "grip", "press plane", "range of motion"]),
    targets: [
      target("deltoid", "primary-mover", "parent-only", [A.deltoid, A.shoulderPress], "Pressing studies support broad deltoid participation; the catalog does not identify a precise press path."),
      target("triceps_brachii", "secondary-mover", "parent-only", [A.triceps, A.shoulderPress], "Elbow extension is involved; no head-specific emphasis is assigned."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: [noSubregionClaim],
  }],
  ["one_arm_lateral_raise", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "one_arm_lateral_raise",
    coverage: "partial",
    movementConvention: convention("one-arm-dumbbell-lateral-raise-v1", ["one-arm dumbbell lateral raise", "arm-abduction pattern"], ["scapular vs frontal plane", "humeral rotation", "trunk compensation", "exact range of motion"]),
    targets: [
      target("deltoid", "primary-mover", "supported", [A.deltoid, A.deltoidReview, A.lateralRct], "The deltoid is the broad target of arm abduction."),
      target("deltoid_middle", "primary-mover", "partial", [A.deltoid, A.deltoidReview, A.lateralRct], "Middle-deltoid association is supported qualitatively; lateral-raise EMG and one longitudinal study do not create a per-head score."),
    ],
    supportedRegionalAssociations: [{ anatomyId: "deltoid_middle", kind: "qualitative-non-exclusive-association", evidenceIds: [A.deltoidReview, A.lateralRct], limitation: "The review concerns acute activation and the trial used its own protocol; neither justifies a numeric or individual growth claim." }],
    unresolvedDetails: ["No claim that other deltoid portions are inactive."],
  }],
  ["one_arm_cable_triceps_extension", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "one_arm_cable_triceps_extension",
    coverage: "partial",
    movementConvention: convention("one-arm-cable-triceps-extension-v1", ["single-arm cable elbow extension"], ["shoulder position", "cable line", "grip", "range of motion"]),
    targets: [target("triceps_brachii", "primary-mover", "parent-only", [A.triceps, A.tricepsPosition], "Triceps brachii extends the elbow; the study showing shoulder-position differences makes the unrecorded arm position material, so no head is emphasized.")],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["Long/lateral/medial head contribution is not resolved."],
  }],
  ["bent_over_one_arm_dumbbell_triceps_extension", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "bent_over_one_arm_dumbbell_triceps_extension",
    coverage: "partial",
    movementConvention: convention("bent-over-one-arm-dumbbell-triceps-extension-v1", ["single-arm dumbbell elbow extension", "bent-over posture is named"], ["upper-arm angle", "shoulder extension angle", "torso angle", "range of motion"]),
    targets: [target("triceps_brachii", "primary-mover", "parent-only", [A.triceps, A.tricepsPosition], "Elbow extension supports a broad triceps target; the upper-arm/shoulder position needed for head emphasis is not stored.")],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["No kickback-specific head claim; bent-over naming does not fix humeral position."],
  }],
  ["one_arm_seated_cable_row", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "one_arm_seated_cable_row",
    coverage: "partial",
    movementConvention: convention("one-arm-seated-cable-row-v1", ["seated cable row", "one-arm execution"], ["handle/grip", "elbow path", "scapular excursion", "torso motion", "range of motion"]),
    targets: [
      target("latissimus_dorsi", "role-unspecified", "partial", [A.row], "Rows involve the back, but grip and humeral/scapular path alter regional contributions; no lat-focused claim is made."),
      target("trapezius", "role-unspecified", "parent-only", [A.row], "Scapular control is relevant to rows, but which trapezius portion participates most is not inferable from the entry."),
      target("rhomboid_region", "role-unspecified", "partial", [A.row], "Scapular retraction can involve the rhomboid region; recorded technique does not resolve its amount or exact role."),
      target("biceps_brachii", "secondary-mover", "partial", [A.elbowFlexors, A.row], "Elbow flexion contributes; grip and elbow path are unspecified."),
      target("brachialis", "secondary-mover", "partial", [A.elbowFlexors, A.row], "Elbow flexor participation is plausible, but no share is estimated."),
      target("brachioradialis", "secondary-mover", "partial", [A.elbowFlexors, A.row], "Elbow flexor/grip contribution varies with forearm position, which is not recorded."),
      target("forearm_flexor_region", "stabilizer", "partial", [A.forearm, A.row], "Grip requires forearm participation; exact muscle-level loading is unavailable."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["No grip, elbow path, or lat-versus-scapular emphasis claim."],
  }],
  ["pull_up", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "pull_up",
    coverage: "partial",
    movementConvention: convention("pull-up-v1", ["bodyweight pull-up on a bar"], ["grip orientation/width", "assistance", "top/bottom range", "scapular strategy", "tempo"]),
    targets: [
      target("latissimus_dorsi", "primary-mover", "partial", [A.row, A.pullup, A.pullupEmg], "A broad vertical-pull target is supported; studies show technique-dependent patterns, so no lat subregion or grip bias is assigned."),
      target("trapezius", "stabilizer", "parent-only", [A.deltoid, A.pullup, A.pullupEmg], "Scapular stabilizer participation is supported generally; the specific portion and loading are not resolved."),
      target("biceps_brachii", "secondary-mover", "partial", [A.elbowFlexors, A.pullup, A.pullupEmg], "Elbow flexors contribute, with variant-dependent activity."),
      target("brachialis", "secondary-mover", "partial", [A.elbowFlexors, A.pullup], "Elbow flexor participation; relative contribution is grip/technique dependent."),
      target("brachioradialis", "secondary-mover", "partial", [A.elbowFlexors, A.pullupEmg], "Forearm/elbow flexor participates in tested variants; no grip is inferred."),
      target("forearm_flexor_region", "stabilizer", "partial", [A.forearm, A.pullupEmg], "Bar grip requires forearm contribution, but recorded sets do not measure grip or individual forearm muscles."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["No grip-specific, lat-versus-arm, or head-specific ranking."],
  }],
  ["hyperextension", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "hyperextension",
    coverage: "partial",
    movementConvention: convention("hyperextension-v1", ["hyperextension/back-extension identity"], ["bench design", "dynamic hip vs spine strategy", "lumbar range", "hip range", "load placement"]),
    targets: [
      target("erector_spinae", "role-unspecified", "partial", [A.backExtension, A.extensionEmg], "Trunk extensor participation is supported, but the dynamic versus isometric contribution depends on execution."),
      target("gluteus_maximus", "role-unspecified", "partial", [A.backExtension, A.extensionEmg, A.hipExtension], "Hip-extensor participation is plausible across studied variants; the logged entry does not identify a hip-dominant technique."),
      target("hamstrings", "role-unspecified", "partial", [A.posteriorThigh, A.backExtension, A.extensionEmg, A.hipExtension], "Hip-extending hamstrings can participate; individual muscles and emphasis cannot be resolved."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["Spinal-dominant versus hip-dominant execution is unknown.", "Biceps femoris short head is excluded from the hip-extensor mapping because it does not extend the hip."],
  }],
  ["one_arm_concentration_curl", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "one_arm_concentration_curl",
    coverage: "partial",
    movementConvention: convention("one-arm-concentration-curl-v1", ["single-arm concentration curl"], ["grip/supination", "upper-arm stabilization details", "range of motion", "tempo"]),
    targets: [
      target("biceps_brachii", "primary-mover", "parent-only", [A.elbowFlexors, A.curl, A.curlTask], "Biceps brachii participates in elbow flexion; no long/short head allocation is made."),
      target("brachialis", "secondary-mover", "partial", [A.elbowFlexors, A.curl], "Brachialis is a separate elbow flexor, not a biceps head."),
      target("brachioradialis", "secondary-mover", "partial", [A.elbowFlexors, A.curlTask], "Forearm orientation affects the synergy, but the catalog does not record it."),
      target("forearm_flexor_region", "stabilizer", "partial", [A.forearm, A.curl], "Grip stabilization is plausible; no individual forearm load is claimed."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["No biceps-head or brachioradialis emphasis from the exercise name."],
  }],
  ["incline_seated_rotating_dumbbell_curl", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "incline_seated_rotating_dumbbell_curl",
    coverage: "partial",
    movementConvention: convention("incline-seated-rotating-dumbbell-curl-v1", ["seated dumbbell curl", "incline and rotating variation are named"], ["bench angle", "rotation endpoint/timing", "shoulder extension angle", "range of motion"]),
    targets: [
      target("biceps_brachii", "primary-mover", "parent-only", [A.elbowFlexors, A.curl, A.curlTask], "Elbow flexion supports a broad biceps target; the recorded identity does not resolve head-specific mechanics."),
      target("brachialis", "secondary-mover", "partial", [A.elbowFlexors, A.curl], "Brachialis participates as a distinct elbow flexor; contribution is not quantified."),
      target("brachioradialis", "secondary-mover", "partial", [A.elbowFlexors, A.curlTask], "Rotation/forearm position can alter synergy, but exact rotation timing is not stored."),
      target("forearm_flexor_region", "stabilizer", "partial", [A.forearm, A.curl], "Grip stabilization is plausible; no per-muscle load is claimed."),
    ],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["No biceps long/short head emphasis.", "The word rotating does not define when or how far the forearm rotates."],
  }],
  ["supported_dumbbell_wrist_curl", {
    mappingVersion: EXERCISE_ANATOMY_MAPPING_V1_VERSION,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey: "supported_dumbbell_wrist_curl",
    coverage: "supported",
    movementConvention: convention("supported-dumbbell-wrist-curl-v1", ["dumbbell wrist curl", "forearm support is named"], ["forearm rotation/palm orientation", "range of motion", "finger contribution"]),
    targets: [target("forearm_flexor_region", "primary-mover", "supported", [A.forearm], "Wrist flexion is associated with the forearm flexor region; individual flexor muscles are not separated.")],
    supportedRegionalAssociations: [],
    unresolvedDetails: ["No individual flexor muscle or precise wrist/finger contribution is assigned."],
  }],
]);

function freezeExerciseAnatomyMappingV1(
  mapping: ExerciseAnatomyMappingV1,
): ExerciseAnatomyMappingV1 {
  return Object.freeze({
    ...mapping,
    movementConvention: Object.freeze({
      ...mapping.movementConvention,
      known: Object.freeze([...mapping.movementConvention.known]),
      notRecorded: Object.freeze([...mapping.movementConvention.notRecorded]),
    }),
    targets: Object.freeze(mapping.targets.map((entry) => Object.freeze({
      ...entry,
      evidenceIds: Object.freeze([...entry.evidenceIds]),
    }))),
    supportedRegionalAssociations: Object.freeze(mapping.supportedRegionalAssociations.map((entry) => Object.freeze({
      ...entry,
      evidenceIds: Object.freeze([...entry.evidenceIds]),
    }))),
    unresolvedDetails: Object.freeze([...mapping.unresolvedDetails]),
  });
}

function immutableReadonlyMapV1<K, V>(backing: Map<K, V>): ReadonlyMap<K, V> {
  const view = Object.freeze({
    get size() { return backing.size; },
    get(key: K) { return backing.get(key); },
    has(key: K) { return backing.has(key); },
    entries() { return backing.entries(); },
    keys() { return backing.keys(); },
    values() { return backing.values(); },
    forEach(
      this: ReadonlyMap<K, V>,
      callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) {
      backing.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
    },
    [Symbol.iterator]() { return backing[Symbol.iterator](); },
  });
  return view;
}

/** No mutable Map handle or mutable registry record escapes this module. */
export const EXERCISE_ANATOMY_MAPPING_REGISTRY_V1: ReadonlyMap<
  CanonicalExerciseStableKey,
  ExerciseAnatomyMappingV1
> = immutableReadonlyMapV1(new Map(
  [...mutableExerciseAnatomyEntries].map(([key, mapping]) => [key, freezeExerciseAnatomyMappingV1(mapping)]),
));

export type AnatomySnapshotTargetV1 = {
  anatomyId: string;
  role: ExerciseAnatomyRoleV1;
  coverage: ExerciseAnatomyTargetV1["coverage"];
};
export type AvailableExerciseAnatomySnapshotV1 = {
  contractVersion: typeof EXERCISE_ANATOMY_SNAPSHOT_V1_CONTRACT;
  availability: "available";
  mappingVersion: typeof EXERCISE_ANATOMY_MAPPING_V1_VERSION;
  taxonomyVersion: typeof ANATOMY_TAXONOMY_V1_VERSION;
  stableKey: CanonicalExerciseStableKey;
  provenance: "versioned-registry-snapshot" | "retrospective-interpretation";
  coverage: "supported" | "partial";
  movementConvention: MovementConventionV1;
  targets: readonly AnatomySnapshotTargetV1[];
  supportedRegionalAssociations: readonly RegionalAssociationV1[];
  unresolvedDetails: readonly string[];
  sourceSnapshotContract?: typeof EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT;
  sourceSnapshotMappingVersion?: string;
};
export type UnavailableExerciseAnatomySnapshotV1 = {
  contractVersion: typeof EXERCISE_ANATOMY_SNAPSHOT_V1_CONTRACT;
  availability: "unavailable";
  mappingVersion: null;
  taxonomyVersion: typeof ANATOMY_TAXONOMY_V1_VERSION;
  stableKey: string | null;
  provenance: null;
  reason: "missing-stable-key" | "unregistered-stable-key" | "invalid-recorded-snapshot";
  targets: readonly [];
};
export type ExerciseAnatomySnapshotV1 =
  | AvailableExerciseAnatomySnapshotV1
  | UnavailableExerciseAnatomySnapshotV1;

function unavailableSnapshot(
  stableKey: string | null,
  reason: UnavailableExerciseAnatomySnapshotV1["reason"],
): UnavailableExerciseAnatomySnapshotV1 {
  return {
    contractVersion: EXERCISE_ANATOMY_SNAPSHOT_V1_CONTRACT,
    availability: "unavailable",
    mappingVersion: null,
    taxonomyVersion: ANATOMY_TAXONOMY_V1_VERSION,
    stableKey,
    provenance: null,
    reason,
    targets: [],
  };
}

function availableSnapshot(
  mapping: ExerciseAnatomyMappingV1,
  provenance: AvailableExerciseAnatomySnapshotV1["provenance"],
  source?: { contract: typeof EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT; mappingVersion: string },
): AvailableExerciseAnatomySnapshotV1 {
  return {
    contractVersion: EXERCISE_ANATOMY_SNAPSHOT_V1_CONTRACT,
    availability: "available",
    mappingVersion: mapping.mappingVersion,
    taxonomyVersion: mapping.taxonomyVersion,
    stableKey: mapping.stableKey,
    provenance,
    coverage: mapping.coverage,
    movementConvention: {
      ...mapping.movementConvention,
      known: [...mapping.movementConvention.known],
      notRecorded: [...mapping.movementConvention.notRecorded],
    },
    targets: mapping.targets.map(({ anatomyId, role, coverage }) => ({ anatomyId, role, coverage })),
    supportedRegionalAssociations: mapping.supportedRegionalAssociations.map((association) => ({
      ...association,
      evidenceIds: [...association.evidenceIds],
    })),
    unresolvedDetails: [...mapping.unresolvedDetails],
    ...(source ? {
      sourceSnapshotContract: source.contract,
      sourceSnapshotMappingVersion: source.mappingVersion,
    } : {}),
  };
}

export function lookupExerciseAnatomyMappingV1(
  stableKey: string | null | undefined,
): ExerciseAnatomyMappingV1 | null {
  if (stableKey == null || stableKey === "") return null;
  return EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.get(stableKey as CanonicalExerciseStableKey) ?? null;
}

export function buildExerciseAnatomySnapshotV1(
  stableKey: string | null | undefined,
): ExerciseAnatomySnapshotV1 {
  if (stableKey == null || stableKey === "") {
    return unavailableSnapshot(null, "missing-stable-key");
  }
  const mapping = lookupExerciseAnatomyMappingV1(stableKey);
  return mapping
    ? availableSnapshot(mapping, "versioned-registry-snapshot")
    : unavailableSnapshot(stableKey, "unregistered-stable-key");
}

/**
 * Derive (never persist over) an interpretation for old V7-only records.
 * Identity is taken only from the immutable recorded V7 snapshot.
 */
export function retrospectiveExerciseAnatomyInterpretationV1(
  recordedMuscleMappingSnapshot: unknown,
): ExerciseAnatomySnapshotV1 {
  const recorded = parseExerciseMuscleMappingSnapshotV7(recordedMuscleMappingSnapshot);
  if (!recorded) return unavailableSnapshot(null, "invalid-recorded-snapshot");
  if (!recorded.stableKey) return unavailableSnapshot(null, "missing-stable-key");
  const mapping = lookupExerciseAnatomyMappingV1(recorded.stableKey);
  if (!mapping) return unavailableSnapshot(recorded.stableKey, "unregistered-stable-key");
  return availableSnapshot(mapping, "retrospective-interpretation", {
    contract: EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT,
    mappingVersion: recorded.mappingVersion ?? "unavailable",
  });
}

export function parseExerciseAnatomySnapshotV1(value: unknown): ExerciseAnatomySnapshotV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.contractVersion !== EXERCISE_ANATOMY_SNAPSHOT_V1_CONTRACT) return null;
  if (raw.availability === "unavailable") {
    if (
      raw.mappingVersion !== null
      || raw.taxonomyVersion !== ANATOMY_TAXONOMY_V1_VERSION
      || !Array.isArray(raw.targets)
      || raw.targets.length !== 0
    ) return null;
    const reason = raw.reason;
    if (reason !== "missing-stable-key" && reason !== "unregistered-stable-key" && reason !== "invalid-recorded-snapshot") return null;
    const stableKey = typeof raw.stableKey === "string" && raw.stableKey.length > 0 ? raw.stableKey : null;
    if (reason === "missing-stable-key" && stableKey !== null) return null;
    if (reason === "unregistered-stable-key" && (stableKey === null || lookupExerciseAnatomyMappingV1(stableKey))) return null;
    return unavailableSnapshot(stableKey, reason);
  }
  if (raw.availability !== "available") return null;
  if (raw.mappingVersion !== EXERCISE_ANATOMY_MAPPING_V1_VERSION || raw.taxonomyVersion !== ANATOMY_TAXONOMY_V1_VERSION) return null;
  if (typeof raw.stableKey !== "string" || !lookupExerciseAnatomyMappingV1(raw.stableKey)) return null;
  if (raw.provenance !== "versioned-registry-snapshot" && raw.provenance !== "retrospective-interpretation") return null;
  const expected = buildExerciseAnatomySnapshotV1(raw.stableKey);
  if (expected.availability !== "available") return null;
  if (!Array.isArray(raw.targets) || raw.targets.length !== expected.targets.length) return null;
  for (let index = 0; index < expected.targets.length; index += 1) {
    const actual = raw.targets[index];
    const wanted = expected.targets[index];
    if (!actual || typeof actual !== "object" || Array.isArray(actual) || !wanted) return null;
    const target = actual as Record<string, unknown>;
    if (target.anatomyId !== wanted.anatomyId || target.role !== wanted.role || target.coverage !== wanted.coverage) return null;
  }
  if (!raw.movementConvention || typeof raw.movementConvention !== "object" || Array.isArray(raw.movementConvention)) return null;
  const movement = raw.movementConvention as Record<string, unknown>;
  if (
    movement.id !== expected.movementConvention.id
    || movement.version !== expected.movementConvention.version
    || !sameStringArray(movement.known, expected.movementConvention.known)
    || !sameStringArray(movement.notRecorded, expected.movementConvention.notRecorded)
  ) return null;
  if (!Array.isArray(raw.supportedRegionalAssociations) || raw.supportedRegionalAssociations.length !== expected.supportedRegionalAssociations.length) return null;
  for (let index = 0; index < expected.supportedRegionalAssociations.length; index += 1) {
    const actual = raw.supportedRegionalAssociations[index];
    const wanted = expected.supportedRegionalAssociations[index];
    if (!actual || typeof actual !== "object" || Array.isArray(actual) || !wanted) return null;
    const association = actual as Record<string, unknown>;
    if (
      association.anatomyId !== wanted.anatomyId
      || association.kind !== wanted.kind
      || association.limitation !== wanted.limitation
      || !sameStringArray(association.evidenceIds, wanted.evidenceIds)
    ) return null;
  }
  if (!sameStringArray(raw.unresolvedDetails, expected.unresolvedDetails)) return null;
  if (raw.coverage !== expected.coverage) return null;
  if (raw.provenance === "retrospective-interpretation") {
    if (raw.sourceSnapshotContract !== EXERCISE_MUSCLE_MAPPING_SNAPSHOT_V7_CONTRACT || typeof raw.sourceSnapshotMappingVersion !== "string") return null;
    return { ...expected, provenance: "retrospective-interpretation", sourceSnapshotContract: raw.sourceSnapshotContract, sourceSnapshotMappingVersion: raw.sourceSnapshotMappingVersion };
  }
  return expected;
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

export function parseExerciseAnatomySnapshotFromCombinedV1(value: unknown): ExerciseAnatomySnapshotV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseExerciseAnatomySnapshotV1((value as Record<string, unknown>)[EXERCISE_ANATOMY_SNAPSHOT_PROPERTY]);
}

/**
 * Resolve a persisted combined snapshot without consulting the mutable catalog.
 * Existing V7-only rows get a separately-provenanced interpretation; a present
 * but invalid anatomy extension is not silently replaced with a new mapping.
 */
export function resolveStoredExerciseAnatomySnapshotV1(value: unknown): ExerciseAnatomySnapshotV1 {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, EXERCISE_ANATOMY_SNAPSHOT_PROPERTY)) {
      const parsed = parseExerciseAnatomySnapshotV1(record[EXERCISE_ANATOMY_SNAPSHOT_PROPERTY]);
      if (parsed) return parsed;
      const recordedV7 = parseExerciseMuscleMappingSnapshotV7(value);
      return unavailableSnapshot(recordedV7?.stableKey ?? null, "invalid-recorded-snapshot");
    }
  }
  return retrospectiveExerciseAnatomyInterpretationV1(value);
}

/** Machine-checkable catalog validation; intentionally independent of UI labels. */
export function validateExerciseAnatomyRegistryV1(
  expectedStableKeys: readonly string[],
): string[] {
  const errors: string[] = [];
  const analyticsDefinitionIds = new Set<string>();
  for (const definition of ANATOMY_ANALYTICS_GROUP_DEFINITIONS_V1) {
    if (analyticsDefinitionIds.has(definition.id)) errors.push(`duplicate analytics group definition: ${definition.id}`);
    analyticsDefinitionIds.add(definition.id);
  }
  for (const groupId of ANATOMY_ANALYTICS_GROUP_IDS_V1) {
    if (!analyticsDefinitionIds.has(groupId)) errors.push(`missing analytics group definition: ${groupId}`);
  }
  for (const groupId of analyticsDefinitionIds) {
    if (!(ANATOMY_ANALYTICS_GROUP_IDS_V1 as readonly string[]).includes(groupId)) {
      errors.push(`noncanonical analytics group definition: ${groupId}`);
    }
  }

  const nodeById = new Map<string, AnatomyNodeV1>();
  for (const node of ANATOMY_TAXONOMY_V1) {
    if (nodeById.has(node.id)) errors.push(`duplicate anatomy ID: ${node.id}`);
    nodeById.set(node.id, node);
  }
  for (const node of ANATOMY_TAXONOMY_V1) {
    if (node.parentId && !nodeById.has(node.parentId)) errors.push(`orphan parent ${node.parentId} for ${node.id}`);
    const seen = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (seen.has(parentId)) {
        errors.push(`taxonomy cycle at ${node.id}`);
        break;
      }
      seen.add(parentId);
      parentId = nodeById.get(parentId)?.parentId ?? null;
    }
  }
  const evidenceIds = new Set(ANATOMY_EVIDENCE_SOURCES_V1.map((source) => source.id));
  for (const mapping of EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.values()) {
    if (mapping.mappingVersion !== EXERCISE_ANATOMY_MAPPING_V1_VERSION) {
      errors.push(`wrong mapping version in ${mapping.stableKey}`);
    }
    if (mapping.taxonomyVersion !== ANATOMY_TAXONOMY_V1_VERSION) {
      errors.push(`wrong taxonomy version in ${mapping.stableKey}`);
    }
    const targetKeys = new Set<string>();
    for (const exerciseTarget of mapping.targets) {
      const targetKey = `${exerciseTarget.anatomyId}:${exerciseTarget.role}`;
      if (targetKeys.has(targetKey)) errors.push(`duplicate target ${targetKey} in ${mapping.stableKey}`);
      targetKeys.add(targetKey);
      if (!(["primary-mover", "secondary-mover", "stabilizer", "role-unspecified"] as string[]).includes(exerciseTarget.role)) {
        errors.push(`invalid target role in ${mapping.stableKey}: ${exerciseTarget.role}`);
      }
      if (!(["supported", "partial", "parent-only"] as string[]).includes(exerciseTarget.coverage)) {
        errors.push(`invalid target coverage in ${mapping.stableKey}: ${exerciseTarget.coverage}`);
      }
      if (!nodeById.has(exerciseTarget.anatomyId)) errors.push(`orphan target ${exerciseTarget.anatomyId} in ${mapping.stableKey}`);
      if (!ANATOMY_ANALYTICS_CROSSWALK_V1.some((entry) => entry.anatomyId === exerciseTarget.anatomyId)) {
        errors.push(`target has no analytics crosswalk ${exerciseTarget.anatomyId} in ${mapping.stableKey}`);
      }
      if (exerciseTarget.evidenceIds.length === 0) errors.push(`target lacks evidence reference in ${mapping.stableKey}: ${exerciseTarget.anatomyId}`);
      for (const id of exerciseTarget.evidenceIds) if (!evidenceIds.has(id)) errors.push(`unknown evidence ${id} in ${mapping.stableKey}`);
    }
    for (const association of mapping.supportedRegionalAssociations) {
      if (!nodeById.has(association.anatomyId)) errors.push(`orphan regional association ${association.anatomyId} in ${mapping.stableKey}`);
      if (association.kind !== "qualitative-non-exclusive-association") {
        errors.push(`invalid regional association kind in ${mapping.stableKey}: ${association.kind}`);
      }
      if (association.evidenceIds.length === 0) errors.push(`regional association lacks evidence in ${mapping.stableKey}: ${association.anatomyId}`);
      for (const id of association.evidenceIds) if (!evidenceIds.has(id)) errors.push(`unknown evidence ${id} in ${mapping.stableKey}`);
    }
  }
  const crosswalkPairs = new Set<string>();
  for (const entry of ANATOMY_ANALYTICS_CROSSWALK_V1) {
    if (!nodeById.has(entry.anatomyId)) errors.push(`crosswalk references unknown anatomy ID ${entry.anatomyId}`);
    if (!(ANATOMY_ANALYTICS_GROUP_IDS_V1 as readonly string[]).includes(entry.analyticsGroupId)) errors.push(`crosswalk references unknown analytics group ${entry.analyticsGroupId}`);
    const pair = `${entry.anatomyId}:${entry.analyticsGroupId}`;
    if (crosswalkPairs.has(pair)) errors.push(`duplicate analytics crosswalk pair ${pair}`);
    crosswalkPairs.add(pair);
  }
  for (const node of ANATOMY_TAXONOMY_V1) {
    if (!ANATOMY_ANALYTICS_CROSSWALK_V1.some((entry) => entry.anatomyId === node.id)) {
      errors.push(`anatomy ID has no analytics crosswalk: ${node.id}`);
    }
  }
  const visualIds = new Set<string>();
  for (const representation of ANATOMY_VISUAL_REPRESENTATION_V1) {
    if (visualIds.has(representation.anatomyId)) errors.push(`duplicate visual representation: ${representation.anatomyId}`);
    visualIds.add(representation.anatomyId);
    if (!nodeById.has(representation.anatomyId)) errors.push(`visual representation references unknown anatomy ID: ${representation.anatomyId}`);
    if (representation.currentAssetStatus !== "unsupported-in-current-asset") {
      errors.push(`unexpected current-asset selection claim: ${representation.anatomyId}`);
    }
  }
  for (const anatomyId of nodeById.keys()) {
    if (!visualIds.has(anatomyId)) errors.push(`missing visual representation: ${anatomyId}`);
  }
  const expected = new Set(expectedStableKeys);
  for (const key of expected) if (!EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.has(key as CanonicalExerciseStableKey)) errors.push(`missing canonical exercise mapping ${key}`);
  for (const key of EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.keys()) if (!expected.has(key)) errors.push(`noncanonical exercise mapping ${key}`);
  if (EXERCISE_ANATOMY_MAPPING_REGISTRY_V1.size !== expected.size) errors.push("canonical exercise mapping count does not match expected count");
  for (const source of ANATOMY_EVIDENCE_SOURCES_V1) {
    if (!/^https:\/\//.test(source.url)) errors.push(`evidence source ${source.id} has a non-HTTPS URL`);
  }
  return errors;
}

export type AnatomySetInputV1 = {
  setId: string;
  anatomySnapshot: ExerciseAnatomySnapshotV1 | null;
};
export type AnatomyExposureCountV1 = { id: string; uniqueSetCount: number };
export type AnatomyExposureRoleCountV1 = {
  id: string;
  role: ExerciseAnatomyRoleV1;
  uniqueSetCount: number;
};
export type AnatomyExposureSummaryV1 = {
  unit: "unique-recorded-strength-sets";
  recordedSetCount: number;
  mappedSetCount: number;
  unavailableSetCount: number;
  /** Union counts; never sum these across anatomy IDs or analytics groups. */
  byAnatomyId: AnatomyExposureCountV1[];
  byAnalyticsGroupId: AnatomyExposureCountV1[];
  /** Role buckets preserve primary/secondary/stabilizer/unspecified semantics. */
  byAnatomyRole: AnatomyExposureRoleCountV1[];
  byAnalyticsGroupRole: AnatomyExposureRoleCountV1[];
};

/**
 * Generic set-association rollup. It consumes IDs/targets only; adding a registry
 * entry does not require an exercise-specific reducer branch.
 */
export function aggregateExerciseAnatomyExposureV1(
  inputSets: readonly AnatomySetInputV1[],
): AnatomyExposureSummaryV1 {
  const setIds = new Set(inputSets.map((set) => set.setId));
  const anatomyRoleSets = new Map<string, Map<ExerciseAnatomyRoleV1, Set<string>>>();
  const analyticsRoleSets = new Map<string, Map<ExerciseAnatomyRoleV1, Set<string>>>();
  const mappedSetIds = new Set<string>();
  const nodeById = new Map(ANATOMY_TAXONOMY_V1.map((node) => [node.id, node]));
  const crosswalk = new Map<string, AnatomyAnalyticsGroupIdV1[]>();
  for (const entry of ANATOMY_ANALYTICS_CROSSWALK_V1) {
    const groups = crosswalk.get(entry.anatomyId) ?? [];
    groups.push(entry.analyticsGroupId);
    crosswalk.set(entry.anatomyId, groups);
  }

  const addRoleSet = (
    target: Map<string, Map<ExerciseAnatomyRoleV1, Set<string>>>,
    id: string,
    role: ExerciseAnatomyRoleV1,
    setId: string,
  ) => {
    const roles = target.get(id) ?? new Map<ExerciseAnatomyRoleV1, Set<string>>();
    const ids = roles.get(role) ?? new Set<string>();
    ids.add(setId);
    roles.set(role, ids);
    target.set(id, roles);
  };

  for (const set of inputSets) {
    const parsed = set.anatomySnapshot;
    if (!parsed || parsed.availability !== "available") continue;
    let setHasMappedTarget = false;
    for (const mappingTarget of parsed.targets) {
      let node = nodeById.get(mappingTarget.anatomyId);
      while (node) {
        setHasMappedTarget = true;
        addRoleSet(anatomyRoleSets, node.id, mappingTarget.role, set.setId);
        for (const groupId of crosswalk.get(node.id) ?? []) {
          addRoleSet(analyticsRoleSets, groupId, mappingTarget.role, set.setId);
        }
        node = node.parentId ? nodeById.get(node.parentId) : undefined;
      }
    }
    if (setHasMappedTarget) mappedSetIds.add(set.setId);
  }

  const summarize = (rolesById: Map<string, Map<ExerciseAnatomyRoleV1, Set<string>>>) => {
    const uniqueCounts: AnatomyExposureCountV1[] = [];
    const roleCounts: AnatomyExposureRoleCountV1[] = [];
    for (const [id, roleSets] of rolesById) {
      const union = new Set<string>();
      for (const [role, ids] of roleSets) {
        for (const setId of ids) union.add(setId);
        roleCounts.push({ id, role, uniqueSetCount: ids.size });
      }
      uniqueCounts.push({ id, uniqueSetCount: union.size });
    }
    uniqueCounts.sort((a, b) => a.id.localeCompare(b.id));
    roleCounts.sort((a, b) => a.id.localeCompare(b.id) || a.role.localeCompare(b.role));
    return { uniqueCounts, roleCounts };
  };
  const anatomySummary = summarize(anatomyRoleSets);
  const analyticsSummary = summarize(analyticsRoleSets);

  return {
    unit: "unique-recorded-strength-sets",
    recordedSetCount: setIds.size,
    mappedSetCount: mappedSetIds.size,
    unavailableSetCount: setIds.size - mappedSetIds.size,
    byAnatomyId: anatomySummary.uniqueCounts,
    byAnalyticsGroupId: analyticsSummary.uniqueCounts,
    byAnatomyRole: anatomySummary.roleCounts,
    byAnalyticsGroupRole: analyticsSummary.roleCounts,
  };
}

/** V7 contract plus an additive, versioned anatomy extension for new diary rows. */
export type ExerciseMappingSnapshotWithAnatomyV1 = ExerciseMuscleMappingSnapshotV7 & {
  [EXERCISE_ANATOMY_SNAPSHOT_PROPERTY]: ExerciseAnatomySnapshotV1;
};

export function exerciseMappingSnapshotWithAnatomyV1(
  stableKey: string | null | undefined,
): ExerciseMappingSnapshotWithAnatomyV1 {
  return {
    ...buildExerciseMuscleMappingSnapshotV7(stableKey),
    [EXERCISE_ANATOMY_SNAPSHOT_PROPERTY]: buildExerciseAnatomySnapshotV1(stableKey),
  };
}
