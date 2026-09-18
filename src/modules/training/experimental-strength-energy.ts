/**
 * @deprecated Prefer `./experimental-strength-active-energy-v1`.
 * Kept so older imports resolve during the V1 cutover.
 */
export {
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION as EXPERIMENTAL_STRENGTH_ENERGY_MODEL_REVISION,
  extractExperimentalStrengthActiveEnergyFeaturesV1 as extractExperimentalStrengthEnergyFeatures,
  estimateExperimentalStrengthActiveEnergyV1,
  experimentalStrengthActiveEnergyV1Fingerprint,
  type ExperimentalStrengthActiveEnergyFeaturesV1 as ExperimentalStrengthEnergyFeatures,
  type ExperimentalStrengthActiveEnergyResultV1 as ExperimentalStrengthEnergyResult,
} from "./experimental-strength-active-energy-v1";
