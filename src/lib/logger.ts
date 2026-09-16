type LogLevel = "info" | "warn" | "error";
type SafeFields = Record<string, boolean | number | string | null | undefined>;

const blockedField = /(api.?key|authorization|cookie|password|secret|payload|particles|paths)/i;

export function logEvent(level: LogLevel, event: string, fields: SafeFields = {}): void {
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => value !== undefined && !blockedField.test(key)),
  );
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeFields,
  });
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  sink(record);
}

export function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
