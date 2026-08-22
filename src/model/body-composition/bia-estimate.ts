export type InitialBodyFatEstimate = {
  estimatePercent: number;
  observationCount: number;
  method: "median";
  /** Median absolute deviation, expressed in body-fat percentage points. */
  spreadPercent: number;
};

export type BodyFatObservationValue = number | null | undefined;

function median(sortedValues: readonly number[]): number {
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middle];
  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function validateObservation(value: number): void {
  if (!Number.isFinite(value)) throw new TypeError("bodyFatPercent observation must be finite");
  if (value < 0 || value > 100) {
    throw new RangeError("bodyFatPercent observation must be between 0 and 100");
  }
}

/**
 * Estimates initial body-fat percentage using the median and reports MAD.
 * Missing observations are ignored, never converted to zero. Non-missing
 * invalid observations reject the entire calculation instead of disappearing.
 */
export function estimateInitialBodyFatPercent(
  observations: readonly BodyFatObservationValue[],
): InitialBodyFatEstimate | null {
  const validValues: number[] = [];

  for (const observation of observations) {
    if (observation === null || observation === undefined) continue;
    validateObservation(observation);
    validValues.push(observation);
  }

  if (validValues.length === 0) return null;

  validValues.sort((left, right) => left - right);
  const estimatePercent = median(validValues);
  const absoluteDeviations = validValues
    .map((value) => Math.abs(value - estimatePercent))
    .sort((left, right) => left - right);

  return {
    estimatePercent,
    observationCount: validValues.length,
    method: "median",
    spreadPercent: median(absoluteDeviations),
  };
}
