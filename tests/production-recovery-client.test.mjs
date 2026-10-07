import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { canonicalJson } from "../scripts/production-recovery/canonical.mjs";
import { requestPhaseAuthorization } from "../scripts/production-recovery/request-phase-authorization.mjs";
import { createRecoverySignerHttpHandler } from "../scripts/production-recovery/signer-http-service.mjs";

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => canonicalJson(value), json: async () => value };
}

describe("production recovery workflow authorization client", () => {
  it("requests independent OIDC audiences and refuses signer outputs bound to another phase or case", async () => {
    const policy = { schemaVersion: 1, purpose: "recovery-environment-policy-review", phase: "A" };
    const envelope = { schemaVersion: 1, phase: "A", claims: { authorizationId: "auth-1" } };
    const calls = [];
    const fetchImpl = async (input, init = {}) => {
      const url = new URL(input);
      calls.push({ url, init });
      if (url.origin === "https://actions.local") {
        return jsonResponse({ value: "oidc-" + url.searchParams.get("audience") });
      }
      if (url.origin === "https://policy.example") return jsonResponse({ policyAttestation: policy });
      if (url.origin === "https://issuer.example") return jsonResponse({
        phase: "A", recoveryCaseId: "case-1", envelope, policyAttestation: policy,
        authorizationId: "auth-1", evidenceId: "evidence-1", rolloutReceiptId: "rollout-1",
      });
      throw new Error("Unexpected endpoint");
    };
    const result = await requestPhaseAuthorization({
      phase: "A", recoveryCaseId: "case-1", createNonce: () => "nonce-0001",
      env: {
        BODYCAST_RECOVERY_POLICY_SIGNER_URL: "https://policy.example/issue",
        BODYCAST_RECOVERY_AUTHORIZATION_ISSUER_URL: "https://issuer.example/issue",
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.local/token",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
      },
      fetchImpl,
    });
    expect(result).toMatchObject({ phase: "A", recoveryCaseId: "case-1", evidenceId: "evidence-1" });
    expect(calls.filter(({ url }) => url.origin === "https://actions.local").map(({ url }) => url.searchParams.get("audience")))
      .toEqual(["bodycast-production-recovery-policy", "bodycast-production-recovery-authorization"]);
    expect(calls.filter(({ url }) => url.origin !== "https://actions.local").every(({ init }) => init.redirect === "error")).toBe(true);

    const wrongCaseFetch = async (input) => {
      const url = new URL(input);
      if (url.origin === "https://actions.local") return jsonResponse({ value: "token" });
      if (url.origin === "https://policy.example") return jsonResponse({ policyAttestation: policy });
      return jsonResponse({ phase: "A", recoveryCaseId: "another-case", envelope, policyAttestation: policy,
        authorizationId: "auth-1", evidenceId: "evidence-1", rolloutReceiptId: "rollout-1" });
    };
    await expect(requestPhaseAuthorization({
      phase: "A", recoveryCaseId: "case-1", env: {
        BODYCAST_RECOVERY_POLICY_SIGNER_URL: "https://policy.example/issue",
        BODYCAST_RECOVERY_AUTHORIZATION_ISSUER_URL: "https://issuer.example/issue",
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.local/token", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
      }, fetchImpl: wrongCaseFetch,
    })).rejects.toThrow(/cross-bound/);
  });

  it("does not send tokens to non-HTTPS or redirecting signer endpoints", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new Error("network should not be called"); };
    await expect(requestPhaseAuthorization({ phase: "B", recoveryCaseId: "case-1", env: {
      BODYCAST_RECOVERY_POLICY_SIGNER_URL: "http://policy.example/issue",
      BODYCAST_RECOVERY_AUTHORIZATION_ISSUER_URL: "https://issuer.example/issue",
    }, fetchImpl })).rejects.toThrow(/HTTPS/);
    expect(calls).toBe(0);
  });
});

describe("dedicated recovery signer HTTPS protocol handler", () => {
  it("exposes only fixed policy and phase-authorization POST routes and never reflects rejected token details", async () => {
    const calls = [];
    const handler = createRecoverySignerHttpHandler({
      policySigner: { issue: async (body) => { calls.push(["policy", body]); return { signature: "signed-policy" }; } },
      authorizationIssuer: { issue: async (body) => { calls.push(["authorization", body]); return { authorizationId: "auth-1" }; } },
    });
    const invoke = async ({ method = "POST", url, body, rawBody }) => {
      const bytes = Buffer.from(rawBody ?? canonicalJson(body));
      const request = Readable.from([bytes]);
      request.method = method;
      request.url = url;
      request.headers = { "content-type": "application/json", "content-length": String(bytes.length) };
      let status;
      let headers;
      let output;
      const response = {
        writeHead(code, responseHeaders) { status = code; headers = responseHeaders; },
        end(value) { output = value; },
      };
      await handler(request, response);
      return { status, headers, body: JSON.parse(output) };
    };
    expect(await invoke({ url: "/v1/policy-attestations", body: { purpose: "request" } }))
      .toMatchObject({ status: 200, headers: { "cache-control": "no-store" }, body: { policyAttestation: { signature: "signed-policy" } } });
    expect(calls[0]).toEqual(["policy", { purpose: "request" }]);
    expect((await invoke({ url: "/v1/arbitrary", body: {} })).status).toBe(404);
    expect((await invoke({ method: "GET", url: "/v1/phase-authorizations", body: {} })).status).toBe(404);
    expect(await invoke({ url: "/v1/phase-authorizations", rawBody: '{"z":1,"a":2}' }))
      .toMatchObject({ status: 400, body: { ok: false, error: "non-canonical-json" } });

    const rejected = createRecoverySignerHttpHandler({
      policySigner: { issue: async () => { throw new Error("sensitive owner approval token detail"); } },
      authorizationIssuer: { issue: async () => ({}) },
    });
    const tokenFailure = await (async () => {
      const request = Readable.from([Buffer.from(canonicalJson({ oidcToken: "secret-token" }))]);
      request.method = "POST"; request.url = "/v1/policy-attestations";
      request.headers = { "content-type": "application/json" };
      let output;
      const response = { writeHead() {}, end(value) { output = value; } };
      await rejected(request, response);
      return output;
    })();
    expect(tokenFailure).not.toContain("sensitive owner approval token detail");
    expect(tokenFailure).not.toContain("secret-token");
  });
});
