import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { canonicalDigest, signCanonical } from "../scripts/production-recovery/canonical.mjs";
import {
  executeReconciledHostOperation,
  OPERATION_ADAPTER_CONTRACT_DIGEST,
  OPERATION_CONTRACTS,
  OPERATION_CONTRACT_VERSION,
  verifyOperationAdapterConformance,
} from "../scripts/production-recovery/operation-contracts.mjs";

const OPERATION_TYPE = "ordinary-release";
const OPERATION_ID = "a".repeat(64);
const INPUT_DIGEST = "b".repeat(64);
const BINDINGS = { releaseSha: "c".repeat(40), canonicalMainSha: "c".repeat(40), releaseMode: "serving" };
const PRECONDITION = { releaseSha: BINDINGS.releaseSha, canonicalMainSha: BINDINGS.canonicalMainSha,
  currentImageDigest: "d".repeat(64) };
const POSTCONDITION = { releaseSha: BINDINGS.releaseSha, imageDigest: "e".repeat(64),
  containerId: "container-current", healthStatus: "healthy" };

function observation(state, overrides = {}) {
  const stateName = state === "pre" ? OPERATION_CONTRACTS[OPERATION_TYPE].preState
    : state === "post" ? OPERATION_CONTRACTS[OPERATION_TYPE].postState : "other";
  const precondition = state === "pre" ? PRECONDITION : null;
  const postcondition = state === "post" ? POSTCONDITION : null;
  return { schemaVersion: 1, purpose: "bodycast-host-operation-state",
    operationType: OPERATION_TYPE, operationId: OPERATION_ID, idempotencyKey: OPERATION_ID,
    operationInputDigest: INPUT_DIGEST, state, observedAt: new Date().toISOString(),
    stateDigest: canonicalDigest({ state: stateName, precondition, postcondition }), precondition, postcondition,
    ...overrides };
}

function adapterSuccess({ result = "executed", operationId = OPERATION_ID, postcondition = POSTCONDITION,
  operationInputDigest = INPUT_DIGEST } = {}) {
  return { schemaVersion: 1, purpose: "bodycast-host-operation-success",
    operationType: OPERATION_TYPE, operationId, idempotencyKey: operationId, operationInputDigest, result, postcondition };
}

function callOperation({ inspect, execute, beforeEffect = async () => {} } = {}) {
  return executeReconciledHostOperation({ operationType: OPERATION_TYPE, operationId: OPERATION_ID,
    operationInputDigest: INPUT_DIGEST, bindings: BINDINGS,
    inspectFixedOperationState: inspect ?? (async () => observation("pre")),
    authorizeImmediatelyBeforeEffect: beforeEffect,
    executeFixedOperation: execute ?? (async (_type, operation) => {
      await operation.authorizeImmediatelyBeforeEffect();
      return adapterSuccess();
    }),
  });
}

describe("fixed host operation replay and success contract", () => {
  it("reconciles successful typed result to actual post-state before returning a receipt-ready success", async () => {
    let state = "pre";
    const result = await callOperation({
      inspect: async () => observation(state),
      execute: async (_type, operation) => {
        await operation.authorizeImmediatelyBeforeEffect();
        state = "post";
        return adapterSuccess();
      },
    });
    expect(result).toMatchObject({ operationId: OPERATION_ID, idempotencyKey: OPERATION_ID,
      operationInputDigest: INPUT_DIGEST, result: "executed", postcondition: POSTCONDITION,
      postconditionDigest: canonicalDigest(POSTCONDITION) });
  });

  it.each([
    ["false result", { ok: false }],
    ["undefined result", undefined],
    ["wrong operation ID", adapterSuccess({ operationId: "f".repeat(64) })],
    ["wrong input digest", adapterSuccess({ operationInputDigest: "f".repeat(64) })],
    ["missing postcondition", { schemaVersion: 1, purpose: "bodycast-host-operation-success",
      operationType: OPERATION_TYPE, operationId: OPERATION_ID, idempotencyKey: OPERATION_ID,
      operationInputDigest: INPUT_DIGEST, result: "executed" }],
  ])("rejects a %s without accepting an operation success", async (_label, result) => {
    await expect(callOperation({ execute: async (_type, operation) => {
      await operation.authorizeImmediatelyBeforeEffect();
      return result;
    } })).rejects.toThrow();
  });

  it("records the external effect only once when the caller crashes before writing its receipt", async () => {
    let state = "pre";
    let effectCount = 0;
    const interrupted = () => callOperation({
      inspect: async () => observation(state),
      execute: async (_type, operation) => {
        await operation.authorizeImmediatelyBeforeEffect();
        state = "post";
        effectCount += 1;
        throw new Error("caller crashed before persisting completion receipt");
      },
    });
    await expect(interrupted()).rejects.toThrow(/crashed/);
    const replayed = await callOperation({
      inspect: async () => observation(state),
      execute: async () => { throw new Error("exact post-state must not repeat effect"); },
    });
    expect(replayed.result).toBe("already-satisfied");
    expect(effectCount).toBe(1);
  });

  it("blocks wrong actual post-state and stale operation identifiers", async () => {
    await expect(callOperation({ inspect: async () => observation("other") }))
      .rejects.toThrow(/neither the exact precondition nor postcondition/);
    await expect(callOperation({ inspect: async () => observation("pre", {
      operationId: "f".repeat(64), idempotencyKey: "f".repeat(64),
    }) })).rejects.toThrow(/exact operation intent/);
    await expect(callOperation({
      inspect: async () => observation("pre"),
      execute: async (_type, operation) => {
        await operation.authorizeImmediatelyBeforeEffect();
        return adapterSuccess({ postcondition: { ...POSTCONDITION, healthStatus: "starting" } });
      },
    })).rejects.toThrow(/healthy exact application state|postcondition/);
  });

  it("coalesces duplicate concurrent execution for one immutable idempotency key", async () => {
    let state = "pre";
    let effectCount = 0;
    let markStarted;
    let releaseEffect;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const blockedEffect = new Promise((resolve) => { releaseEffect = resolve; });
    const execute = async (_type, operation) => {
      await operation.authorizeImmediatelyBeforeEffect();
      markStarted();
      await blockedEffect;
      effectCount += 1;
      state = "post";
      return adapterSuccess();
    };
    const input = { inspect: async () => observation(state), execute };
    const first = callOperation(input);
    await started;
    const duplicate = callOperation(input);
    releaseEffect();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(firstResult).toEqual(duplicateResult);
    expect(effectCount).toBe(1);
  });

  it("requires signed, current conformance evidence for every operation contract", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const issuedAt = new Date().toISOString();
    const unsigned = { schemaVersion: 1, purpose: "bodycast-production-host-adapter-conformance",
      contractVersion: OPERATION_CONTRACT_VERSION, contractDigest: OPERATION_ADAPTER_CONTRACT_DIGEST,
      adapterDigest: "d".repeat(64), testSuiteDigest: "e".repeat(64), testRunId: "adapter-run-1",
      testedOperationTypes: Object.keys(OPERATION_CONTRACTS).sort(), result: "passed", issuedAt,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), signerKeyId: "adapter-test-key" };
    const receipt = { ...unsigned, signature: signCanonical(unsigned, privateKey) };
    const trustedKey = publicKey.export({ type: "spki", format: "pem" });
    expect(verifyOperationAdapterConformance(receipt, { adapterDigest: unsigned.adapterDigest,
      trustedPublicKeys: { "adapter-test-key": trustedKey } }).current).toBe(true);
    const incomplete = { ...receipt, testedOperationTypes: ["ordinary-release"] };
    expect(() => verifyOperationAdapterConformance(incomplete, { adapterDigest: unsigned.adapterDigest,
      trustedPublicKeys: { "adapter-test-key": trustedKey } })).toThrow(/does not cover/);
  });
});
