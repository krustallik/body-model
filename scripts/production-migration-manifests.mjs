export const STAGE_02_MANIFEST = Object.freeze({
  id: "stage-02-strength-accounting-v1",
  migrations: Object.freeze([
    Object.freeze({ name: "20260929170000_training_load_accounting_v1", sha256: "d90a7cac525eb221ba2436c23043b6a515914d02205af47343b96337771d7f5b" }),
    Object.freeze({ name: "20260929190000_persist_strength_accounting_v1", sha256: "b33ea8679866972ac4964b6d7de92e74a237271ec25951b04e5541e12d5b8913" }),
  ]),
});

export const ACTIVE_ENERGY_UNIFIED_MANIFEST = Object.freeze({
  id: "active-energy-unified-v1",
  migrations: Object.freeze([
    Object.freeze({ name: "20261002100000_active_energy_canonical_resolution", sha256: "45711a527d809775a5ce66d3d9e529954158dcb65ed0065f70a0f948a4693a0b" }),
    Object.freeze({ name: "20261002150000_add_production_publication_generation", sha256: "9f1e38182dc3ec2449da5297786b603d8c0370498ed68db97059f640220bbbd7" }),
    Object.freeze({ name: "20261003120000_add_episode_aware_unified_experimental_physiology_v2", sha256: "0bb495d988ead0c1729f8e657b85f85bc4c20673fdedd5b61a7644cb0dcaf9b6" }),
  ]),
  requiredTablesBefore: Object.freeze([
    "Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "_prisma_migrations",
  ]),
  postflightObjects: Object.freeze([
    "ActiveEnergyCanonicalEvent", "ActiveEnergyCanonicalEvent_pkey", "ActiveEnergyCanonicalEvent_profile_key_key",
    "ActiveEnergyCanonicalEvent_superseded_by_fkey", "ActiveEnergyCanonicalEvent_revisions_nonnegative",
    "ActiveEnergyCanonicalEvent_fingerprints_hex", "ActiveEnergyCanonicalEvent_current_kcal_nonnegative",
    "ActiveEnergyCanonicalEvent_profile_date_idx", "ActiveEnergyCanonicalEvent_profile_occurrence_idx",
    "ActiveEnergyCanonicalEvent_superseded_by_idx", "ActiveEnergyEventAlias", "ActiveEnergyEventAlias_pkey",
    "ActiveEnergyEventAlias_profile_source_key", "ActiveEnergyEventAlias_event_fkey", "ActiveEnergyEventAlias_workout_fkey",
    "ActiveEnergyEventAlias_event_idx", "ActiveEnergyCandidate", "ActiveEnergyCandidate_pkey",
    "ActiveEnergyCandidate_event_fkey", "ActiveEnergyCandidate_event_source_fingerprint_key",
    "ActiveEnergyCandidate_availability_value_check", "ActiveEnergyCandidate_fingerprint_hex",
    "ActiveEnergyCandidate_event_created_idx", "ActiveEnergyResolutionRevision", "ActiveEnergyResolutionRevision_pkey",
    "ActiveEnergyResolutionRevision_event_fkey", "ActiveEnergyResolutionRevision_event_revision_key",
    "ActiveEnergyResolutionRevision_revision_positive", "ActiveEnergyResolutionRevision_fingerprint_hex",
    "ActiveEnergyResolutionRevision_value_check", "ActiveEnergyCanonicalEvent_id_seq", "ActiveEnergyEventAlias_id_seq",
    "ActiveEnergyCandidate_id_seq", "ActiveEnergyResolutionRevision_id_seq",
    "PhysiologyV7Lifecycle.productionStaleFromDate", "PhysiologyV7Lifecycle.productionPublishedGeneration",
    "PhysiologyV7Lifecycle.unifiedPublishedGeneration", "PhysiologyV7Lifecycle_productionStaleFromDate_idx",
    "DailyModelState.weightFilterVarianceKg2", "UnifiedExperimentalPhysiologyStateV2",
    "UnifiedExperimentalPhysiologyStateV2_pkey", "UnifiedExperimentalPhysiologyStateV2_profileId_fkey",
    "UnifiedExperimentalPhysiologyStateV2_modelEpisodeId_fkey",
    "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_date_key",
    "UnifiedExperimentalPhysiologyStateV2_profileId_boundaryAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_boundaryAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevision_updatedAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatus_boundaryAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_resultFingerprint_idx",
    "UnifiedExperimentalPhysiologyStateV2_id_seq",
  ]),
});

export const PRODUCTION_MIGRATION_MANIFESTS = Object.freeze({
  [ACTIVE_ENERGY_UNIFIED_MANIFEST.id]: ACTIVE_ENERGY_UNIFIED_MANIFEST,
});

export function getProductionMigrationManifest(id) {
  const manifest = PRODUCTION_MIGRATION_MANIFESTS[id];
  if (!manifest) throw new Error(`Unknown or unreviewed production migration manifest: ${String(id)}.`);
  return manifest;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
