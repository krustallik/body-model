export function formatMetric(value: number | null, locale = "uk-UA"): string {
  return value === null || value === 0 ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}

export function formatDateTime(value: string | null, locale = "uk-UA"): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** User-facing duration: `7 год 48 хв` / `7h 48m`, or `—` when null. */
export function formatDurationMinutes(
  totalMinutes: number | null | undefined,
  locale: "uk" | "en" = "uk",
): string {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) {
    return "—";
  }
  const rounded = Math.round(totalMinutes);
  if (rounded <= 0) return "—";
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (locale === "uk") {
    if (hours === 0) return `${minutes} хв`;
    if (minutes === 0) return `${hours} год`;
    return `${hours} год ${minutes} хв`;
  }
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** Compact table duration `7:48` (H:MM), or `—`. */
export function formatDurationClock(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) {
    return "—";
  }
  const rounded = Math.round(totalMinutes);
  if (rounded <= 0) return "—";
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
