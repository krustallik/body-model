#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical.mjs";

const SIGNER_AUDIENCE = "bodycast-production-recovery-policy";
const ISSUER_AUDIENCE = "bodycast-production-recovery-authorization";
const MAX_RESPONSE_BYTES = 256 * 1024;

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!new Set(["--phase", "--recovery-case-id", "--output"]).has(key)
      || values[key] !== undefined || index + 1 >= argv.length) throw new Error("Only --phase, --recovery-case-id, and --output are accepted.");
    values[key] = argv[++index];
  }
  if (!values["--phase"] || !["A", "B"].includes(values["--phase"])) throw new Error("Recovery phase must be A or B.");
  const caseId = values["--recovery-case-id"];
  if (!caseId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(caseId)) throw new Error("Recovery case ID is not a valid opaque selector.");
  return { phase: values["--phase"], recoveryCaseId: caseId, output: values["--output"] };
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
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
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
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: canonicalJson(payload),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Recovery signer response exceeds the protocol limit.");
  if (!response.ok) throw new Error("Recovery signer rejected the request with status " + response.status + ".");
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("Recovery signer returned malformed JSON."); }
  if (canonicalJson(result) !== text) throw new Error("Recovery signer response is not canonical JSON.");
  return result;
}

export async function requestPhaseAuthorization({ phase, recoveryCaseId, env = process.env, fetchImpl = fetch, createNonce = randomUUID }) {
  if (phase !== "A" && phase !== "B") throw new Error("Recovery phase must be A or B.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(recoveryCaseId)) throw new Error("Recovery case ID is invalid.");
  const policyUrl = endpoint(env.BODYCAST_RECOVERY_POLICY_SIGNER_URL, "Policy signer");
  const issuerUrl = endpoint(env.BODYCAST_RECOVERY_AUTHORIZATION_ISSUER_URL, "Authorization issuer");
  const policyOidc = await getOidcToken(env, SIGNER_AUDIENCE, fetchImpl);
  const requestId = "policy-request-" + createNonce();
  const policyResponse = await postJson(policyUrl, {
    schemaVersion: 1,
    purpose: "request-recovery-environment-policy",
    oidcToken: policyOidc,
    recoveryCaseId,
    phase,
    singleUseRequestId: requestId,
    singleUseNonce: createNonce().replaceAll("-", ""),
  }, fetchImpl);
  if (!policyResponse.policyAttestation) throw new Error("Policy signer response omitted the attestation.");

  const authorizationOidc = await getOidcToken(env, ISSUER_AUDIENCE, fetchImpl);
  const authorizationResponse = await postJson(issuerUrl, {
    schemaVersion: 1,
    purpose: "issue-recovery-phase-authorization",
    oidcToken: authorizationOidc,
    recoveryCaseId,
    phase,
    policyAttestation: policyResponse.policyAttestation,
  }, fetchImpl);
  if (authorizationResponse.phase !== phase || authorizationResponse.recoveryCaseId !== recoveryCaseId
    || !authorizationResponse.envelope || !authorizationResponse.policyAttestation
    || authorizationResponse.authorizationId !== authorizationResponse.envelope.claims?.authorizationId
    || canonicalJson(authorizationResponse.policyAttestation) !== canonicalJson(policyResponse.policyAttestation)) {
    throw new Error("Authorization issuer response is incomplete or cross-bound to another phase/case.");
  }
  for (const key of ["evidenceId", "rolloutReceiptId"]) {
    if (typeof authorizationResponse[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(authorizationResponse[key])) {
      throw new Error("Authorization issuer omitted a valid host evidence identifier: " + key + ".");
    }
  }
  return authorizationResponse;
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    const bundle = await requestPhaseAuthorization(args);
    const text = canonicalJson(bundle) + "\n";
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
