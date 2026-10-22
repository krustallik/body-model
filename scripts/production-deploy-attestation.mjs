import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_DEPLOY_OIDC_AUDIENCE = "bodycast-production-migration-free-serving";
export const PRODUCTION_DEPLOY_WORKFLOW_REF = "krustallik/body-model/.github/workflows/deploy-production.yml@refs/heads/main";
export const PRODUCTION_DEPLOY_ACTOR_ID = "126446430";

function decodeJsonSegment(segment, name) {
  if (typeof segment !== "string" || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error(`Production deploy attestation ${name} segment is malformed.`);
  }
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new Error(`Production deploy attestation ${name} segment is invalid JSON.`);
  }
}

export function verifyProductionDeployAttestation(input, now = Date.now()) {
  const token = String(input?.token ?? "");
  if (token.length < 100 || token.length > 16_384) throw new Error("Production deploy attestation is missing or malformed.");
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error("Production deploy attestation is not a compact signed JWT.");
  }
  const header = decodeJsonSegment(segments[0], "header");
  const claims = decodeJsonSegment(segments[1], "claims");
  if (!header || typeof header !== "object" || Array.isArray(header)
    || !claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new Error("Production deploy attestation has an invalid header or claims object.");
  }
  const algorithm = header.alg;
  if ((algorithm !== "RS256" && algorithm !== "ES256") || typeof header.kid !== "string" || !header.kid) {
    throw new Error("Production deploy attestation uses an unsupported signing key.");
  }

  const jwks = input?.jwks;
  const signingKey = Array.isArray(jwks?.keys)
    ? jwks.keys.find((key) => key?.kid === header.kid && (!key.alg || key.alg === algorithm)
      && (!key.use || key.use === "sig"))
    : null;
  if (!signingKey) throw new Error("Production deploy attestation signing key is absent from the GitHub OIDC key set.");
  let signature;
  try {
    signature = Buffer.from(segments[2], "base64url");
  } catch {
    throw new Error("Production deploy attestation signature is malformed.");
  }
  const publicKey = createPublicKey({ key: signingKey, format: "jwk" });
  const verified = verifySignature(algorithm === "RS256" ? "RSA-SHA256" : "sha256",
    Buffer.from(`${segments[0]}.${segments[1]}`),
    algorithm === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey,
    signature);
  if (!verified) throw new Error("Production deploy attestation signature is invalid.");

  const expected = input?.expected ?? {};
  const nowSeconds = Math.floor(now / 1000);
  const issuedAt = Number(claims.iat);
  const expiresAt = Number(claims.exp);
  const notBefore = claims.nbf === undefined ? null : Number(claims.nbf);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const requiredClaims = [
    [claims.iss === "https://token.actions.githubusercontent.com", "issuer"],
    [audiences.length === 1 && audiences[0] === PRODUCTION_DEPLOY_OIDC_AUDIENCE, "audience"],
    [claims.repository === "krustallik/body-model", "repository"],
    [String(claims.actor_id ?? "") === PRODUCTION_DEPLOY_ACTOR_ID, "pinned owner actor"],
    [claims.event_name === "workflow_dispatch", "manual owner dispatch"],
    [claims.ref === "refs/heads/main", "main ref"],
    [claims.workflow_ref === PRODUCTION_DEPLOY_WORKFLOW_REF, "canonical production workflow"],
    [claims.runner_environment === "github-hosted", "GitHub-hosted runner"],
    [claims.sha === expected.releaseSha, "exact release SHA"],
    [claims.workflow_sha === expected.releaseSha, "workflow SHA"],
    [String(claims.run_id ?? "") === String(expected.runId ?? ""), "workflow run ID"],
    [String(claims.run_attempt ?? "") === String(expected.runAttempt ?? ""), "workflow run attempt"],
    [typeof claims.jti === "string" && claims.jti.length >= 8 && claims.jti.length <= 256, "unique token ID"],
    [Number.isSafeInteger(issuedAt) && issuedAt <= nowSeconds + 60, "issued-at time"],
    [Number.isSafeInteger(expiresAt) && expiresAt > nowSeconds - 60 && expiresAt > issuedAt, "expiration time"],
    [expiresAt - issuedAt <= 15 * 60, "short token lifetime"],
    [notBefore === null || (Number.isSafeInteger(notBefore) && notBefore <= nowSeconds + 60), "not-before time"],
  ];
  const failedClaim = requiredClaims.find(([passed]) => !passed);
  if (failedClaim) throw new Error(`Production deploy attestation does not satisfy the ${failedClaim[1]} gate.`);

  return {
    schemaVersion: 1,
    releaseSha: expected.releaseSha,
    runId: String(expected.runId),
    runAttempt: String(expected.runAttempt),
    actorId: PRODUCTION_DEPLOY_ACTOR_ID,
    jtiDigest: createHash("sha256").update(claims.jti).digest("hex"),
    verifiedAt: new Date(now).toISOString(),
  };
}

export async function consumeProductionDeployAttestationJti(verified, directory) {
  if (!/^[a-f0-9]{64}$/.test(String(verified?.jtiDigest ?? "")) || typeof directory !== "string" || !directory) {
    throw new Error("Production deploy attestation replay guard is unavailable.");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const usedPath = path.join(directory, verified.jtiDigest);
  try {
    await mkdir(usedPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Production deploy attestation has already been consumed.");
    throw error;
  }
  try {
    await writeFile(path.join(usedPath, "claims.json"), JSON.stringify({
      releaseSha: verified.releaseSha,
      runId: verified.runId,
      runAttempt: verified.runAttempt,
      verifiedAt: verified.verifiedAt,
    }) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    throw new Error(`Production deploy attestation replay record could not be persisted: ${error?.message ?? "unknown error"}`);
  }
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--consume") values.set(name, "true");
    else if (name.startsWith("--")) values.set(name, argv[++index] ?? "");
  }
  return values;
}

async function main() {
  const args = argumentsFrom(process.argv);
  const [tokenText, jwksText] = await Promise.all([
    readFile(args.get("--token-file"), "utf8"),
    readFile(args.get("--jwks-file"), "utf8"),
  ]);
  let jwks;
  try {
    jwks = JSON.parse(jwksText);
  } catch {
    throw new Error("GitHub OIDC signing key set is not valid JSON.");
  }
  const verified = verifyProductionDeployAttestation({
    token: tokenText.trim(), jwks,
    expected: { releaseSha: args.get("--release-sha"), runId: args.get("--run-id"), runAttempt: args.get("--run-attempt") },
  });
  if (args.has("--consume")) await consumeProductionDeployAttestationJti(verified, args.get("--used-jti-directory"));
  process.stdout.write(`BODYCAST_PRODUCTION_DEPLOY_ATTESTATION=${JSON.stringify(verified)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Production deploy attestation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
