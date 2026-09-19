/**
 * Parse a user-typed decimal that may use a comma (iPhone decimal pad).
 */
export function parseTrainingDecimal(raw: string): number {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return Number.NaN;
  return Number(normalized);
}
