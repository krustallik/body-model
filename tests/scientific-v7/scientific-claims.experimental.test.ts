import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  ALL_SCIENTIFIC_V7_CLAIM_RECORDS,
  summarizeScientificManifestStatus,
} from "./scientific-claims.manifest";

/**
 * EXPERIMENTAL harness: contract/provenance checks only.
 * Passing these tests must never be interpreted as scientific validation.
 */
describe("scientific v7 experimental claims (not scientific validation)", () => {
  it("keeps EXPERIMENTAL empty until a real experimental implementation maps to a claim", () => {
    const experimental = ALL_SCIENTIFIC_V7_CLAIM_RECORDS.filter((claim) => claim.status === "EXPERIMENTAL");
    expect(experimental.map((claim) => claim.claimId).sort()).toEqual([
      "C-A01",
      "C-B01",
      "C-B02",
      "C-B03",
      "C-B04",
      "C-C01",
      "C-C02",
      "C-D01",
      "C-D02",
      "C-D03",
      "C-D05",
      "C-E01",
      "C-E02",
      "C-E03",
      "C-E04",
      "C-E05",
      "C-E06",
      "C-F01",
      "C-F02",
      "C-F03",
      "C-F04",
      "C-F05",
      "C-FW01",
      "C-G01",
      "C-G03",
      "C-G04",
      "C-H02",
      "C-I03",
      "C-J02",
      "C-J03",
      "C-J04",
      "C-J05",
      "C-J06",
      "C-K03",
      "C-K06",
      "C-K08",
      "C-L04",
      "C-MV05",
    ]);
    expect(summarizeScientificManifestStatus().EXPERIMENTAL).toBe(38);
  });

  it("requires implementation path, uncertainty, and non-GREEN test wiring when EXPERIMENTAL claims exist", () => {
    const experimental = ALL_SCIENTIFIC_V7_CLAIM_RECORDS.filter((claim) => claim.status === "EXPERIMENTAL");
    const greenSource = readFileSync("tests/scientific-v7/scientific-contract.test.ts", "utf8");
    for (const claim of experimental) {
      expect(claim.experimentalImplementation).toBeTruthy();
      expect(existsSync(claim.experimentalImplementation!)).toBe(true);
      expect(claim.experimentalUncertainty).toMatch(/uncertain|heuristic|approximation|not scientifically validated|personal-unavailable|estimate/i);
      expect(claim.testFile).not.toBe("tests/scientific-v7/scientific-contract.test.ts");
      expect(existsSync(claim.testFile)).toBe(true);
      expect(greenSource).not.toContain(`it(\"${claim.testName}\"`);
      expect(claim.status).not.toBe("GREEN");
    }
  });
});
