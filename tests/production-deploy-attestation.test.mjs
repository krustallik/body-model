import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  consumeProductionDeployAttestationJti,
  PRODUCTION_DEPLOY_OIDC_AUDIENCE,
  PRODUCTION_DEPLOY_WORKFLOW_REF,
  verifyProductionDeployAttestation,
} from "../scripts/production-deploy-attestation.mjs";

const releaseSha = "a".repeat(40);
const expected = { releaseSha, runId: "12345", runAttempt: "2" };
const now = Date.now();
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-bodycast-key", alg: "RS256", use: "sig" };
const jwks = { keys: [jwk] };
const tmpDirectories = [];

function tokenFor(overrides = {}, key = privateKey) {
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: PRODUCTION_DEPLOY_OIDC_AUDIENCE,
    repository: "krustallik/body-model",
    actor_id: 126446430,
    event_name: "workflow_dispatch",
    ref: "refs/heads/main",
    workflow_ref: PRODUCTION_DEPLOY_WORKFLOW_REF,
    workflow_sha: releaseSha,
    runner_environment: "github-hosted",
    sha: releaseSha,
    run_id: 12345,
    run_attempt: 2,
    jti: "bodycast-test-jti-0001",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 300,
    ...overrides,
  };
  const header = { alg: "RS256", kid: "test-bodycast-key", typ: "JWT" };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), key).toString("base64url");
  return `${signingInput}.${signature}`;
}

describe("production deploy OIDC attestation", () => {
  afterAll(async () => {
    await Promise.all(tmpDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("accepts only the signed owner workflow, exact SHA, and exact run attempt", () => {
    expect(verifyProductionDeployAttestation({ token: tokenFor(), jwks, expected }, now)).toMatchObject({
      schemaVersion: 1,
      releaseSha,
      runId: "12345",
      runAttempt: "2",
      actorId: "126446430",
    });
  });

  it.each([
    [{ actor_id: 7 }, /pinned owner actor/],
    [{ sha: "b".repeat(40) }, /exact release SHA/],
    [{ workflow_sha: "b".repeat(40) }, /workflow SHA/],
    [{ event_name: "push" }, /manual owner dispatch/],
    [{ workflow_ref: "krustallik/body-model/.github/workflows/other.yml@refs/heads/main" }, /canonical production workflow/],
    [{ run_attempt: 3 }, /workflow run attempt/],
  ])("rejects a token with a mismatched trusted claim", (override, message) => {
    expect(() => verifyProductionDeployAttestation({ token: tokenFor(override), jwks, expected }, now)).toThrow(message);
  });

  it("rejects an invalid signature even when the claims look correct", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => verifyProductionDeployAttestation({ token: tokenFor({}, other.privateKey), jwks, expected }, now))
      .toThrow(/signature is invalid/);
  });

  it("consumes each signed token ID once and persists only the exact release context", async () => {
    const verified = verifyProductionDeployAttestation({ token: tokenFor(), jwks, expected }, now);
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-oidc-"));
    tmpDirectories.push(directory);
    await consumeProductionDeployAttestationJti(verified, directory);
    const record = JSON.parse(await readFile(path.join(directory, verified.jtiDigest, "claims.json"), "utf8"));
    expect(record).toMatchObject({ releaseSha, runId: "12345", runAttempt: "2" });
    await expect(consumeProductionDeployAttestationJti(verified, directory)).rejects.toThrow(/already been consumed/);
  });

  it("rejects expired tokens and tokens with an overlong lifetime", () => {
    expect(() => verifyProductionDeployAttestation({ token: tokenFor({ exp: Math.floor(now / 1000) - 120 }), jwks, expected }, now))
      .toThrow(/expiration time/);
    expect(() => verifyProductionDeployAttestation({ token: tokenFor({ exp: Math.floor(now / 1000) + 3600 }), jwks, expected }, now))
      .toThrow(/short token lifetime/);
  });
});
