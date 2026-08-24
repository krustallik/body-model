export function formatMetric(value: number | null, locale = "uk-UA"): string {
  return value === null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}

export function formatDateTime(value: string | null, locale = "uk-UA"): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
