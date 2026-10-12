import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const DUMP_BOUNDARY = /^BODYCAST_PGDUMP_INVOCATION_AT=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/;
const SENSITIVE_ASSIGNMENT = /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|ENCRYPTION_KEY|DATABASE_URL|CONNECTION_STRING)[A-Z0-9_]*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const LONG_BASE64 = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{96,}={0,2}(?![A-Za-z0-9+/=])/g;

function isValidUtcTimestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === value;
}

function redactDiagnosticLine(line) {
  if (/[\u0000-\u001F\u007F]/.test(line)) return null;
  if (/BODYCAST_[A-Z0-9_]*B64=/i.test(line)) return null;
  if (/::|##\[/.test(line)) return null;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|-----END [A-Z ]*PRIVATE KEY-----/.test(line.trim())) return null;
  if (/^[A-Za-z0-9+/=]{40,}$/.test(line.trim())) return null;

  const redacted = line
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]")
    .replace(LONG_BASE64, "[REDACTED]")
    .slice(0, 500);
  return redacted;
}

export function summarizeNoAppHostFailure(stderr, { sshExitCode, encryptExitCode }) {
  if (typeof stderr !== "string") throw new Error("Host diagnostics must be text.");

  const lines = stderr.split(/\r\n|[\r\n]/);
  const dumpMarkerLines = lines.filter((line) => line.startsWith("BODYCAST_PGDUMP_INVOCATION_AT="));
  const dumpMarker = dumpMarkerLines.length === 1 ? dumpMarkerLines[0].match(DUMP_BOUNDARY) : null;
  const dumpInvoked = Boolean(dumpMarker && isValidUtcTimestamp(dumpMarker[1]));
  const markerSummary = dumpMarkerLines.length === 0
    ? "not observed"
    : dumpInvoked ? "observed once" : "ambiguous or malformed";
  const diagnostics = lines
    .filter((line) => !line.startsWith("BODYCAST_PGDUMP_INVOCATION_AT="))
    .map(redactDiagnosticLine)
    .filter((line) => line !== null && line.trim().length > 0)
    .slice(-40)
    .map((line) => `host stderr: ${line}`);

  return [
    `No-app host backup pipeline failed (SSH exit ${sshExitCode}; encryption exit ${encryptExitCode}).`,
    `pg_dump invocation boundary marker: ${markerSummary}.`,
    ...(diagnostics.length > 0 ? ["Sanitized host diagnostics:", ...diagnostics] : []),
  ].join("\n");
}

function main() {
  const [stderrPath, sshExitCode, encryptExitCode] = process.argv.slice(2);
  if (!stderrPath || !/^-?\d+$/.test(sshExitCode ?? "") || !/^-?\d+$/.test(encryptExitCode ?? "")) {
    throw new Error("Usage: production-no-app-host-failure-summary.mjs <stderr-file> <ssh-exit> <encryption-exit>");
  }
  process.stderr.write(summarizeNoAppHostFailure(readFileSync(stderrPath, "utf8"), {
    sshExitCode,
    encryptExitCode,
  }));
  process.stderr.write("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Could not summarize no-app host failure safely: ${error.message}\n`);
    process.exitCode = 1;
  }
}
