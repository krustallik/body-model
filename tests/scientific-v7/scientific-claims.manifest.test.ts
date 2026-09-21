import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALL_SCIENTIFIC_V7_CLAIM_RECORDS,
  SCIENTIFIC_V7_CLAIMS,
  SCIENTIFIC_V7_FLOW_BLOCKERS,
  SCIENTIFIC_V7_REJECTED_CLAIMS,
  UNSAFE_CLAIM_IDS,
  summarizeScientificManifestStatus,
} from "./scientific-claims.manifest";

describe("scientific v7 traceability manifest", () => {
  it("accounts for exactly 79 eligible audited claims with stable unique IDs", () => {
    expect(SCIENTIFIC_V7_CLAIMS).toHaveLength(79);
    expect(new Set(SCIENTIFIC_V7_CLAIMS.map(({ claimId }) => claimId)).size).toBe(79);
  });

  it("reports separate GREEN / EXPERIMENTAL / BLOCKED / REJECTED counts", () => {
    const summary = summarizeScientificManifestStatus();
    expect(summary).toMatchObject({
      GREEN: 38,
      EXPERIMENTAL: 34,
      BLOCKED: 7,
      REJECTED: 4,
      eligible: 79,
      tracked: 83,
    });
    expect(summary.note).toMatch(/do not count as scientific validation/i);
    expect(summary.GREEN + summary.EXPERIMENTAL + summary.BLOCKED).toBe(79);
    expect(summary.GREEN + summary.EXPERIMENTAL + summary.BLOCKED + summary.REJECTED).toBe(83);
  });

  it("keeps REJECTED claim IDs out of eligible GREEN/BLOCKED/EXPERIMENTAL sets", () => {
    const eligible = new Set(SCIENTIFIC_V7_CLAIMS.map(({ claimId }) => claimId));
    expect(UNSAFE_CLAIM_IDS).toEqual(["C-G02", "C-H04", "C-K02", "C-M04"]);
    for (const unsafe of UNSAFE_CLAIM_IDS) expect(eligible.has(unsafe)).toBe(false);
    expect(SCIENTIFIC_V7_REJECTED_CLAIMS.map(({ claimId }) => claimId)).toEqual([...UNSAFE_CLAIM_IDS]);
    expect(SCIENTIFIC_V7_REJECTED_CLAIMS.every((claim) => claim.status === "REJECTED")).toBe(true);
    expect(ALL_SCIENTIFIC_V7_CLAIM_RECORDS).toHaveLength(83);
  });

  it("provides evidence, parameters, provenance, assertion type, and a test mapping", () => {
    for (const claim of ALL_SCIENTIFIC_V7_CLAIM_RECORDS) {
      expect(claim.evidenceIds.length).toBeGreaterThan(0);
      if (claim.status === "EXPERIMENTAL") {
        expect(claim.testFile).toMatch(/^tests\//);
        expect(claim.experimentalImplementation).toBeTruthy();
      } else {
        expect(claim.testFile).toMatch(/^tests\/scientific-v7\//);
      }
      expect(claim.testName.length).toBeGreaterThan(0);
      expect(claim.assertionTypes.length).toBeGreaterThan(0);
      expect(claim.provenance.length).toBeGreaterThan(0);
      expect(claim.scientificAssertion.length).toBeGreaterThan(0);
      expect(claim.status).toBe(claim.expectedInitialState);
    }
  });

  it("maps every GREEN claim to a real named executable scientific-contract test", () => {
    const source = readFileSync("tests/scientific-v7/scientific-contract.test.ts", "utf8");
    for (const claim of SCIENTIFIC_V7_CLAIMS) {
      if (claim.status !== "GREEN") continue;
      expect(source).toContain(`it(\"${claim.testName}\"`);
    }
  });

  it("does not treat EXPERIMENTAL claims as scientific-contract validation", () => {
    const source = readFileSync("tests/scientific-v7/scientific-contract.test.ts", "utf8");
    const experimental = ALL_SCIENTIFIC_V7_CLAIM_RECORDS.filter((claim) => claim.status === "EXPERIMENTAL");
    for (const claim of experimental) {
      expect(claim.experimentalImplementation?.length ?? 0).toBeGreaterThan(0);
      expect(claim.experimentalUncertainty?.length ?? 0).toBeGreaterThan(0);
      expect(claim.testFile).not.toBe("tests/scientific-v7/scientific-contract.test.ts");
      expect(source).not.toContain(`it(\"${claim.testName}\"`);
    }
  });

  it("contains no exact numeric scientific expectations", () => {
    expect(ALL_SCIENTIFIC_V7_CLAIM_RECORDS.every(({ numericAssertions }) => (
      numericAssertions.length === 0
    ))).toBe(true);
  });

  it("gives every blocked claim and full-flow specification a precise blocker", () => {
    const blockedClaims = SCIENTIFIC_V7_CLAIMS.filter(({ status }) => status === "BLOCKED");
    expect(blockedClaims.length).toBe(7);
    expect(blockedClaims.every(({ infrastructureBlocker }) => (
      typeof infrastructureBlocker === "string" && infrastructureBlocker.length > 20
    ))).toBe(true);
    expect(SCIENTIFIC_V7_REJECTED_CLAIMS.every(({ rejectionReason }) => (
      typeof rejectionReason === "string" && rejectionReason.length > 20
    ))).toBe(true);
    expect(new Set(SCIENTIFIC_V7_FLOW_BLOCKERS.map(({ testType }) => testType))).toEqual(
      new Set(["longitudinal", "recalculation", "forecast", "e2e"]),
    );
  });

  it("does not blanket-convert BLOCKED claims into EXPERIMENTAL without implementations", () => {
    const experimental = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "EXPERIMENTAL");
    expect(experimental).toHaveLength(34);
    expect(experimental.every((claim) => claim.experimentalImplementation)).toBe(true);
    expect(SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "BLOCKED")).toHaveLength(7);
  });
});
