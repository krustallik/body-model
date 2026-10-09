#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical.mjs";

const SIGNER_AUDIENCE = "bodycast-production-recovery-policy";
const ISSUER_AUDIENCE = "bodycast-production-recovery-authorization";
const MAX_RESPONSE_BYTES = 256 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!new Set(["--phase", "--recovery-case-id", "--mode", "--challenge-id", "--challenge-digest", "--output"]).has(key)
      || values[key] !== undefined || index + 1 >= argv.length) throw new Error("Only fixed phase challenge/authorization arguments are accepted.");
    values[key] = argv[++index];
  }
  if (!values["--phase"] || !["A", "B"].includes(values["--phase"])) throw new Error("Recovery phase must be A or B.");
  if (!values["--mode"] || !["challenge", "authorize"].includes(values["--mode"])) throw new Error("Mode must be challenge or authorize.");
  if (!ID_PATTERN.test(values["--recovery-case-id"] ?? "")) throw new Error("Recovery case ID is invalid.");
  if (values["--mode"] === "authorize" && (!ID_PATTERN.test(values["--challenge-id"] ?? "")
    || !/^[a-f0-9]{64}$/.test(values["--challenge-digest"] ?? ""))) throw new Error("Authorization requires the exact published challenge ID and digest.");
  return {
    phase: values["--phase"], recoveryCaseId: values["--recovery-case-id"], mode: values["--mode"],
    challengeId: values["--challenge-id"], challengeDigest: values["--challenge-digest"], output: values["--output"],
  };
}

function endpoint(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(label + " endpoint must be a configured HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search
    || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error(label + " endpoint must be a fixed HTTPS service URL without credentials, query, or fragment.");
  }
  return url;
}

async function getOidcToken(env, audience, fetchImpl) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error("GitHub Actions OIDC permission is unavailable.");
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set("audience", audience);
  const response = await fetchImpl(url, {
    headers: { authorization: "Bearer " + env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("GitHub Actions OIDC token request failed with status " + response.status + ".");
  const result = await response.json();
  if (typeof result?.value !== "string" || result.value.length === 0 || result.value.length > 32_768) {
    throw new Error("GitHub Actions returned an invalid OIDC token response.");
  }
  return result.value;
}

async function postJson(url, payload, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: canonicalJson(payload), redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Recovery signer response exceeds the protocol limit.");
  if (!response.ok) throw new Error("Recovery signer rejected the request with status " + response.status + ".");
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("Recovery signer returned malformed JSON."); }
  if (canonicalJson(result) !== text) throw new Error("Recovery signer response is not canonical JSON.");
  return result;
}

export async function requestPhaseChallenge({ phase, recoveryCaseId, env = process.env, fetchImpl = fetch }) {
  if (phase !== "A" && phase !== "B" || !ID_PATTERN.test(recoveryCaseId ?? "")) throw new Error("Recovery phase or case ID is invalid.");
  const policyUrl = endpoint(env.BODYCAST_RECOVERY_POLICY_SIGNER_URL, "Policy signer");
  policyUrl.pathname = "/v1/phase-challenges";
  policyUrl.search = "";
  const oidcToken = await getOidcToken(env, SIGNER_AUDIENCE, fetchImpl);
  const response = await postJson(policyUrl, {
    schemaVersion: 1, purpose: "create-recovery-phase-challenge", oidcToken, recoveryCaseId, phase,
  }, fetchImpl);
  if (!response.challenge || !ID_PATTERN.test(response.challenge.challengeId ?? "")
    || !/^[a-f0-9]{64}$/.test(response.challengeDigest ?? "")
    || response.challenge.phase !== phase || response.challenge.recoveryCaseId !== recoveryCaseId) {
    throw new Error("Policy signer returned an incomplete or cross-bound challenge.");
  }
  return response;
}

export async function requestPhaseAuthorization({
  phase, recoveryCaseId, challengeId, challengeDigest, env = process.env, fetchImpl = fetch,
}) {
  if (phase !== "A" && phase !== "B" || !ID_PATTERN.test(recoveryCaseId ?? "") || !ID_PATTERN.test(challengeId ?? "")
    || !/^[a-f0-9]{64}$/.test(challengeDigest ?? "")) throw new Error("Recovery authorization requires a valid case and published challenge.");
  const policyUrl = endpoint(env.BODYCAST_RECOVERY_POLICY_SIGNER_URL, "Policy signer");
  policyUrl.pathname = "/v1/policy-attestations";
  policyUrl.search = "";
  const issuerUrl = endpoint(env.BODYCAST_RECOVERY_AUTHORIZATION_ISSUER_URL, "Authorization issuer");
  issuerUrl.pathname = "/v1/phase-authorizations";
  issuerUrl.search = "";
  const policyOidc = await getOidcToken(env, SIGNER_AUDIENCE, fetchImpl);
  const policyResponse = await postJson(policyUrl, {
    schemaVersion: 1,
    purpose: "request-recovery-owner-policy",
    oidcToken: policyOidc,
    recoveryCaseId,
    phase,
    challengeId,
    challengeDigest,
  }, fetchImpl);
  const policyAttestation = policyResponse.policyAttestation;
  if (!policyAttestation || policyAttestation.challengeId !== challengeId || policyAttestation.challengeDigest !== challengeDigest) {
    throw new Error("Policy signer did not attest the exact previously published challenge.");
  }
  const authorizationOidc = await getOidcToken(env, ISSUER_AUDIENCE, fetchImpl);
  const authorizationResponse = await postJson(issuerUrl, {
    schemaVersion: 1,
    purpose: "issue-recovery-phase-authorization",
    oidcToken: authorizationOidc,
    recoveryCaseId,
    phase,
    challengeId,
    challengeDigest,
    policyAttestation,
  }, fetchImpl);
  if (authorizationResponse.phase !== phase || authorizationResponse.recoveryCaseId !== recoveryCaseId
    || !authorizationResponse.envelope || !authorizationResponse.policyAttestation
    || authorizationResponse.authorizationId !== authorizationResponse.envelope.claims?.authorizationId
    || authorizationResponse.policyAttestation.challengeId !== challengeId
    || authorizationResponse.policyAttestation.challengeDigest !== challengeDigest
    || canonicalJson(authorizationResponse.policyAttestation) !== canonicalJson(policyAttestation)) {
    throw new Error("Authorization issuer response is incomplete or cross-bound to another phase/case/challenge.");
  }
  for (const key of ["evidenceId", "rolloutReceiptId"]) {
    if (typeof authorizationResponse[key] !== "string" || !ID_PATTERN.test(authorizationResponse[key])) {
      throw new Error("Authorization issuer omitted a valid host evidence identifier: " + key + ".");
    }
  }
  return authorizationResponse;
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = args.mode === "challenge"
      ? await requestPhaseChallenge(args)
      : await requestPhaseAuthorization(args);
    const text = canonicalJson(result) + "\n";
    if (args.output) {
      if (!pathIsRunnerTemp(args.output, process.env.RUNNER_TEMP)) throw new Error("Output must be inside RUNNER_TEMP.");
      await fs.writeFile(args.output, text, { flag: "wx", mode: 0o600 });
    } else process.stdout.write(text);
  } catch (error) {
    process.stderr.write("Recovery authorization request blocked: " + error.message + "\n");
    process.exitCode = 1;
  }
}

function pathIsRunnerTemp(filePath, runnerTemp) {
  if (!runnerTemp || !path.isAbsolute(filePath)) return false;
  const relative = path.relative(path.resolve(runnerTemp), path.resolve(filePath));
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1].replaceAll("\\", "/")).href) await main();
