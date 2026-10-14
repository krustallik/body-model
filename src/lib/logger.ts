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

/** Structured diagnostics that identify the failing code without logging error text or request data. */
export function errorDiagnosticFields(error: unknown): SafeFields {
  const errorType = errorKind(error);
  const fields: SafeFields = {
    errorType: /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(errorType) ? errorType : "UnknownError",
  };
  if (!(error instanceof Error)) return fields;

  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string" && /^(?:P\d{4}|[0-9A-Z]{5}|ERR_[A-Z0-9_]{1,24}|E[A-Z0-9]{2,10})$/.test(code)) {
    fields.errorCode = code;
  }

  const stackLines = error.stack?.slice(0, 16_384).split("\n").slice(1, 33) ?? [];
  for (const stackLine of stackLines) {
    const frame = stackLine.match(/(?:\(|\s)([^()\s]{1,256}):(\d{1,8}):(\d{1,8})\)?$/);
    if (!frame) continue;
    const normalizedPath = frame[1].replace(/\\/g, "/");
    const sourceIndex = normalizedPath.lastIndexOf("/src/");
    if (sourceIndex >= 0) {
      const sourcePath = normalizedPath.slice(sourceIndex + 5);
      if (!/^[A-Za-z0-9_./-]{1,200}$/.test(sourcePath)) continue;
      fields.errorFrame = `src/${sourcePath}:${frame[2]}:${frame[3]}`;
      break;
    }
    const bundleIndex = normalizedPath.lastIndexOf("/.next/server/");
    if (bundleIndex >= 0) {
      const bundlePath = normalizedPath.slice(bundleIndex + 14);
      if (!/^[A-Za-z0-9_./-]{1,200}$/.test(bundlePath)) continue;
      fields.errorFrame = `.next/server/${bundlePath}:${frame[2]}:${frame[3]}`;
      break;
    }
  }
  return fields;
}
