/**
 * CI smoke: deterministic lightweight subset of initialization validation.
 * Full suite (`validate:initialization`) is multi-minute; this runs one known case.
 *
 * Run: npm run validate:initialization:smoke
 */
import { prepareEpisodeInitialization } from "../../src/modules/model-episodes/episode-initialization";
import {
  buildInitializationValidationSources,
  initValidationProfile,
  INIT_VALIDATION_END_DATE,
} from "../../tests/initialization-validation-fixtures";

const sources = buildInitializationValidationSources({
  personalOffsetKcalPerDay: 0,
});
const result = prepareEpisodeInitialization({
  profile: initValidationProfile,
  days: sources.days,
  sources,
  startDate: INIT_VALIDATION_END_DATE,
});

const ok = result.initializationStatus === "strong"
  && Number.isFinite(result.initialPersonalOffsetKcalPerDay)
  && Math.abs(result.initialPersonalOffsetKcalPerDay ?? Number.NaN) <= 40
  && result.appliedPersonalOffsetKcalPerDay === result.initialPersonalOffsetKcalPerDay;

console.log(
  `${ok ? "PASS" : "FAIL"} initialization-smoke — status=${result.initializationStatus}`
  + ` estimated=${result.initialPersonalOffsetKcalPerDay}`
  + ` applied=${result.appliedPersonalOffsetKcalPerDay}`,
);
if (!ok) process.exit(1);
