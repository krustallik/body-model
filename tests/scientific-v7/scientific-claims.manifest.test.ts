import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCIENTIFIC_V7_CLAIMS,
  SCIENTIFIC_V7_FLOW_BLOCKERS,
  UNSAFE_CLAIM_IDS,
} from "./scientific-claims.manifest";

describe("scientific v7 traceability manifest", () => {
  it("accounts for exactly 77 eligible audited claims with stable unique IDs", () => {
    expect(SCIENTIFIC_V7_CLAIMS).toHaveLength(77);
    expect(new Set(SCIENTIFIC_V7_CLAIMS.map(({ claimId }) => claimId)).size).toBe(77);
  });

  it("classifies 15 claims already green and 62 as infrastructure blocked", () => {
    const counts = SCIENTIFIC_V7_CLAIMS.reduce<Record<string, number>>((result, claim) => {
      result[claim.expectedInitialState] = (result[claim.expectedInitialState] ?? 0) + 1;
      return result;
    }, {});
    expect(counts).toEqual({ ALREADY_GREEN: 15, INFRASTRUCTURE_BLOCKED: 62 });
  });

  it("excludes every unsafe claim from scientific RED-test eligibility", () => {
    const eligible = new Set(SCIENTIFIC_V7_CLAIMS.map(({ claimId }) => claimId));
    expect(UNSAFE_CLAIM_IDS).toEqual(["C-G02", "C-H04", "C-K02", "C-M04"]);
    for (const unsafe of UNSAFE_CLAIM_IDS) expect(eligible.has(unsafe)).toBe(false);
  });

  it("provides evidence, parameters, provenance, assertion type, and a test mapping", () => {
    for (const claim of SCIENTIFIC_V7_CLAIMS) {
      expect(claim.evidenceIds.length).toBeGreaterThan(0);
      expect(claim.testFile).toMatch(/^tests\/scientific-v7\//);
      expect(claim.testName.length).toBeGreaterThan(0);
      expect(claim.assertionTypes.length).toBeGreaterThan(0);
      expect(claim.provenance.length).toBeGreaterThan(0);
      expect(claim.scientificAssertion.length).toBeGreaterThan(0);
    }
  });

  it("maps every already-green claim to a real named executable test", () => {
    const source = readFileSync("tests/scientific-v7/scientific-contract.test.ts", "utf8");
    for (const claim of SCIENTIFIC_V7_CLAIMS) {
      if (claim.expectedInitialState !== "ALREADY_GREEN") continue;
      expect(source).toContain(`it(\"${claim.testName}\"`);
    }
  });

  it("contains no exact numeric scientific expectations", () => {
    expect(SCIENTIFIC_V7_CLAIMS.every(({ numericAssertions }) => (
      numericAssertions.length === 0
    ))).toBe(true);
  });

  it("gives every blocked claim and full-flow specification a precise blocker", () => {
    const blockedClaims = SCIENTIFIC_V7_CLAIMS.filter(({ expectedInitialState }) => (
      expectedInitialState === "INFRASTRUCTURE_BLOCKED"
    ));
    expect(blockedClaims.length).toBeGreaterThan(0);
    expect(blockedClaims.every(({ infrastructureBlocker }) => (
      typeof infrastructureBlocker === "string" && infrastructureBlocker.length > 20
    ))).toBe(true);
    expect(new Set(SCIENTIFIC_V7_FLOW_BLOCKERS.map(({ testType }) => testType))).toEqual(
      new Set(["longitudinal", "recalculation", "forecast", "e2e"]),
    );
  });
});
