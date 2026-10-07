import https from "node:https";
import { canonicalJson } from "./canonical.mjs";

const ROUTES = Object.freeze({
  "/v1/policy-attestations": "policy",
  "/v1/phase-authorizations": "authorization",
});
const MAX_REQUEST_BYTES = 128 * 1024;

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
  });
  response.end(canonicalJson(body));
}

export function createRecoverySignerHttpHandler({ policySigner, authorizationIssuer, maxRequestBytes = MAX_REQUEST_BYTES }) {
  if (!policySigner || typeof policySigner.issue !== "function"
    || !authorizationIssuer || typeof authorizationIssuer.issue !== "function") {
    throw new Error("Independent policy signer and phase authorization issuer are required.");
  }
  return async function handleRecoverySignerRequest(request, response) {
    const route = ROUTES[request.url];
    if (request.method !== "POST" || !route) return send(response, 404, { ok: false, error: "not-found" });
    if (request.headers["content-type"] !== "application/json") return send(response, 415, { ok: false, error: "content-type" });
    if (request.headers["transfer-encoding"] && request.headers["content-length"]) return send(response, 400, { ok: false, error: "ambiguous-length" });
    const declaredLength = Number(request.headers["content-length"] ?? 0);
    if (request.headers["content-length"] && (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > maxRequestBytes)) {
      return send(response, 413, { ok: false, error: "request-too-large" });
    }
    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > maxRequestBytes) return send(response, 413, { ok: false, error: "request-too-large" });
        chunks.push(chunk);
      }
      if (declaredLength > 0 && bytes !== declaredLength) return send(response, 400, { ok: false, error: "content-length-mismatch" });
      const text = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(text);
      if (canonicalJson(body) !== text) return send(response, 400, { ok: false, error: "non-canonical-json" });
      const result = route === "policy"
        ? { policyAttestation: await policySigner.issue(body) }
        : await authorizationIssuer.issue(body);
      return send(response, 200, result);
    } catch {
      return send(response, 403, { ok: false, error: "recovery-authorization-rejected" });
    }
  };
}

/** Separate HTTPS service boundary. TLS key/certificate are host-installed secrets, never repository inputs. */
export function createRecoverySignerHttpsServer({ tls, policySigner, authorizationIssuer, maxRequestBytes = MAX_REQUEST_BYTES }) {
  if (!tls || typeof tls.key !== "string" && !Buffer.isBuffer(tls.key)
    || typeof tls.cert !== "string" && !Buffer.isBuffer(tls.cert)) {
    throw new Error("Recovery signer HTTPS requires separately installed TLS key and certificate material.");
  }
  return https.createServer(tls, createRecoverySignerHttpHandler({ policySigner, authorizationIssuer, maxRequestBytes }));
}

export { MAX_REQUEST_BYTES, ROUTES };
