import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = ["schemaVersion", "mode", "sourceRunId", "sourceRunAttempt", "sourceSha", "targetSha",
  "captureRunId", "captureRunAttempt", "sourceRecordDigest", "currentRecordDigest", "compatibilityDigest"];
const FORWARD = ["sourceFailedRunId", "sourceFailedRunAttempt", "sourceFailedSha", "failureProofDigest", "sourceMarkerDigest"];
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[1-9][0-9]*$/;
function reject() { throw new Error("Previous-app capture resume receipt failed its closed-schema bindings."); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) reject();
}
export function validateCaptureResumeReceipt(receipt, expected) {
  if (!expected || !["ordinary", "forward"].includes(expected.mode)) reject();
  exactKeys(receipt, expected.mode === "forward" ? [...BASE, "forwardResume"] : BASE);
  if (receipt.schemaVersion !== 2 || receipt.mode !== expected.mode) reject();
  for (const key of BASE.filter((key) => key !== "schemaVersion" && key !== "mode")) {
    const value = receipt[key];
    if (key.endsWith("Attempt") ? !Number.isSafeInteger(value) || value < 1
      : key.endsWith("Sha") ? !SHA.test(value ?? "")
        : key.endsWith("Digest") ? !DIGEST.test(value ?? "") : typeof value !== "string" || !ID.test(value)) reject();
    // source digest for an ordinary unsigned preflight comes from the verified host archive.
    // Forward mode additionally requires the historical owner-signed record digest.
    if (expected[key] === undefined && (key !== "sourceRecordDigest" || expected.mode === "forward")) reject();
    if (expected[key] !== undefined && value !== expected[key]) reject();
  }
  if (receipt.mode === "forward") {
    exactKeys(receipt.forwardResume, FORWARD);
    exactKeys(expected.forwardResume, FORWARD);
    for (const key of FORWARD) {
      const value = receipt.forwardResume[key];
      if (key.endsWith("Attempt") ? value !== 1 : key.endsWith("Sha") ? !SHA.test(value ?? "")
        : key.endsWith("Digest") ? !DIGEST.test(value ?? "") : typeof value !== "string" || !ID.test(value)) reject();
      if (value !== expected.forwardResume[key]) reject();
    }
    if (receipt.sourceSha !== receipt.forwardResume.sourceFailedSha) reject();
  }
  return Object.freeze(receipt);
}

export function createCaptureResumeReceipt(base, { captureRunId, captureRunAttempt, forwardResume } = {}) {
  exactKeys(base, ["schemaVersion", "sourceRunId", "sourceRunAttempt", "sourceSha", "targetSha",
    "sourceRecordDigest", "currentRecordDigest", "compatibilityDigest"]);
  if (base.schemaVersion !== 1) reject();
  const receipt = { ...base, schemaVersion: 2, mode: forwardResume ? "forward" : "ordinary",
    captureRunId, captureRunAttempt, ...(forwardResume ? { forwardResume } : {}) };
  return validateCaptureResumeReceipt(receipt, receipt);
}

async function main() {
  const [mode, sourceRunId, sourceAttempt, sourceSha, targetSha, captureRunId, captureAttempt,
    failedRunId, failedSha, proofDigest, markerDigest] = process.argv.slice(2);
  if (mode !== "--produce") reject();
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 8192) reject();
  }
  const base = JSON.parse(input);
  const receipt = createCaptureResumeReceipt(base, { captureRunId, captureRunAttempt: Number(captureAttempt),
    ...(failedRunId ? { forwardResume: { sourceFailedRunId: failedRunId, sourceFailedRunAttempt: 1,
      sourceFailedSha: failedSha, failureProofDigest: proofDigest, sourceMarkerDigest: markerDigest } } : {}) });
  validateCaptureResumeReceipt(receipt, { ...receipt, sourceRunId, sourceRunAttempt: Number(sourceAttempt), sourceSha, targetSha });
  process.stdout.write(JSON.stringify(receipt));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
