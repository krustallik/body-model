import { validateOptionalNonnegative } from "./validation";

export type ActivityComponents = {
  walkingActivityKcal: number | null | undefined;
  strengthActivityKcal: number | null | undefined;
};

/**
 * Combines known activity components. Steps are intentionally absent because
 * adding them to distance-derived walking would count the same movement twice.
 */
export function calculateActivity(components: ActivityComponents): number | null {
  validateOptionalNonnegative("walkingActivityKcal", components.walkingActivityKcal);
  validateOptionalNonnegative("strengthActivityKcal", components.strengthActivityKcal);

  if (components.walkingActivityKcal === null || components.walkingActivityKcal === undefined
      || components.strengthActivityKcal === null || components.strengthActivityKcal === undefined) {
    return null;
  }
  return components.walkingActivityKcal + components.strengthActivityKcal;
}
