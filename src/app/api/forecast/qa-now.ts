/**
 * Deterministic clock for the isolated browser-QA database. Production builds
 * always use the real clock, even if these environment variables are present.
 */
export function forecastQaNow(): Date | undefined {
  if (process.env.NODE_ENV === "production" || process.env.BODYCAST_QA_MODE !== "1") {
    return undefined;
  }
  const raw = process.env.BODYCAST_QA_NOW;
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw new Error("BODYCAST_QA_NOW must be an ISO timestamp");
  return parsed;
}
