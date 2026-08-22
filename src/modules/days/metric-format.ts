export function formatMetric(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 4 }).format(value);
}

export function formatDateTime(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
