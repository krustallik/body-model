#!/usr/bin/env node
import net from "node:net";
import { canonicalJson } from "./canonical.mjs";
import { validateProductionOperationRequest } from "./operation-broker.mjs";

export const PRODUCTION_OPERATION_SOCKET = "/run/bodycast/production-operations.sock";

const REQUIRED = Object.freeze({
  "ordinary-release": ["request-id", "release-sha", "canonical-main-sha", "release-mode"],
  "traffic-check": ["request-id", "release-sha", "canonical-main-sha", "authorization-context-id"],
  "v3-postflight": ["request-id", "release-sha", "canonical-main-sha", "authorization-context-id"],
  "migration-readiness": ["request-id", "release-sha", "canonical-main-sha", "migration-manifest-id"],
  "forward-migration": ["request-id", "release-sha", "canonical-main-sha", "migration-manifest-id", "authorization-context-id"],
  "traffic-maintenance": ["request-id", "release-sha", "canonical-main-sha", "authorization-context-id"],
  "traffic-serve": ["request-id", "release-sha", "canonical-main-sha", "authorization-context-id"],
  "recovery-state": ["request-id"],
  "recovery-bootstrap": ["request-id", "failed-state", "evidence-id", "rollout-receipt-id"],
  "recovery-rebuild-projection": ["request-id"],
  "recovery-transition": ["request-id", "recovery-case-id", "transition", "expected-generation", "expected-record-digest", "evidence-id", "authorization-envelope-b64", "policy-attestation-b64", "rollout-receipt-id"],
  "recovery-finalize": ["request-id", "recovery-case-id", "expected-generation", "expected-record-digest", "evidence-id"],
  "recovery-operation-replay": ["request-id", "recovery-case-id", "expected-generation", "expected-record-digest", "operation-id"],
  readiness: ["request-id"],
});

export function parseOperationArguments(argv) {
  const [operation, ...args] = argv;
  if (!REQUIRED[operation]) throw new Error("Operation is not allowlisted.");
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--") || values[flag.slice(2)] !== undefined || index + 1 >= args.length) {
      throw new Error("Operation arguments must be unique --name value pairs.");
    }
    values[flag.slice(2)] = args[++index];
  }
  const required = REQUIRED[operation];
  if (Object.keys(values).length !== required.length || required.some((key) => values[key] === undefined)) {
    throw new Error("Operation argument set is incomplete or contains unknown fields.");
  }
  const map = {
    "request-id": "requestId",
    "recovery-case-id": "recoveryCaseId",
    "release-sha": "releaseSha",
    "canonical-main-sha": "canonicalMainSha",
    "release-mode": "releaseMode",
    "failed-state": "failedState",
    "migration-manifest-id": "migrationManifestId",
    "authorization-context-id": "authorizationContextId",
    "expected-generation": "expectedGeneration",
    "expected-record-digest": "expectedRecordDigest",
    "operation-id": "operationId",
    "evidence-id": "evidenceId",
    "rollout-receipt-id": "rolloutReceiptId",
    transition: "transition",
  };
  const request = { schemaVersion: 1, operation };
  for (const [key, value] of Object.entries(values)) {
    if (["authorization-envelope-b64", "policy-attestation-b64"].includes(key)) {
      if (value.length > 128 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error("Signed authorization input must be canonical bounded base64.");
      }
      const bytes = Buffer.from(value, "base64");
      if (bytes.toString("base64") !== value) throw new Error("Signed authorization input base64 is not canonical.");
      const text = bytes.toString("utf8");
      const parsed = JSON.parse(text);
      if (canonicalJson(parsed) !== text) throw new Error("Signed authorization input must contain canonical JSON.");
      request[key === "authorization-envelope-b64" ? "authorizationEnvelope" : "policyAttestation"] = parsed;
    } else request[map[key]] = ["expected-generation"].includes(key) ? Number(value) : value;
  }
  return validateProductionOperationRequest(request);
}

export function sendProductionOperation(request, { socketPath = PRODUCTION_OPERATION_SOCKET, timeoutMs = 15_000 } = {}) {
  validateProductionOperationRequest(request);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let output = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("Production operation authority timed out.")), timeoutMs);
    socket.once("connect", () => socket.write(canonicalJson(request) + "\n"));
    socket.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 1024 * 1024) return finish(new Error("Production operation response exceeds limit."));
      const newline = output.indexOf("\n");
      if (newline >= 0) {
        if (newline !== output.length - 1) return finish(new Error("Production operation authority returned extra data."));
        try {
          const response = JSON.parse(output.slice(0, newline));
          if (canonicalJson(response) !== output.slice(0, newline)) throw new Error("Authority response is not canonical JSON.");
          if (!response.ok) throw new Error(response.error ?? "Production operation rejected.");
          finish(null, response);
        } catch (error) { finish(error); }
      }
    });
    socket.once("error", (error) => finish(new Error("Production operation authority unavailable: " + error.message)));
    socket.once("close", () => {
      clearTimeout(timer);
      if (!settled) finish(new Error("Production operation authority closed without a response."));
    });
    socket.once("connect", () => socket.setTimeout(timeoutMs, () => finish(new Error("Production operation authority timed out."))));
  });
}

async function main() {
  try {
    const request = parseOperationArguments(process.argv.slice(2));
    const result = await sendProductionOperation(request);
    process.stdout.write(canonicalJson(result) + "\n");
  } catch (error) {
    process.stderr.write("Production operation blocked: " + error.message + "\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1].replaceAll("\\", "/")).href) await main();
