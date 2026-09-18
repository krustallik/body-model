import { describe, expect, it } from "vitest";
import { SCIENTIFIC_V7_CLAIMS } from "./scientific-claims.manifest";
import {
  classifyBlockedScientificClaims,
  summarizeBlockedClaimClassification,
} from "./scientific-claims-blocker-classification";

describe("Stage 12 blocked scientific-claim triage", () => {
  it("classifies all 9 remaining blocked claims after FFM-retention EXPERIMENTAL claims", () => {
    const blocked = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "BLOCKED");
    const green = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "GREEN");
    const experimental = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "EXPERIMENTAL");
    expect(blocked).toHaveLength(9);
    expect(green).toHaveLength(38);
    expect(experimental).toHaveLength(32);

    const rows = classifyBlockedScientificClaims();
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((row) => row.claimId)).size).toBe(9);

    const summary = summarizeBlockedClaimClassification(rows);
    expect(summary.totalBlocked).toBe(9);
    expect(
      summary.counts["implementation-only"]
      + summary.counts["validation-data"]
      + summary.counts["research-blocked"],
    ).toBe(9);
    expect(summary.closestToGreen[0]?.claimId).toBe("C-I03");
    expect(rows.find((row) => row.claimId === "C-A01")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-C01")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-C02")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-D02")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-E03")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-E02")).toBeDefined();
    expect(rows.find((row) => row.claimId === "C-B05")).toBeDefined();
    expect(rows.find((row) => row.claimId === "C-B01")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-G01")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-G04")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-F05")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-H02")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-FW01")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-G03")).toBeDefined();
    expect(summary.note).toMatch(/Do not unblock without a real oracle/i);
  });

  it("keeps research-blocked claims out of the closest-to-GREEN shortlist when science is unsettled", () => {
    const rows = classifyBlockedScientificClaims();
    const researchClosest = rows.filter(
      (row) => row.category === "research-blocked" && row.closestToGreenRank !== null,
    );
    expect(researchClosest).toHaveLength(0);
    expect(rows.find((row) => row.claimId === "C-K06")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-H02")).toBeUndefined();
  });
});