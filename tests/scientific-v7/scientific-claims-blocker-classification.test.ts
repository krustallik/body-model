import { describe, expect, it } from "vitest";
import { SCIENTIFIC_V7_CLAIMS } from "./scientific-claims.manifest";
import {
  classifyBlockedScientificClaims,
  summarizeBlockedClaimClassification,
} from "./scientific-claims-blocker-classification";

describe("Stage 12 blocked scientific-claim triage", () => {
  it("classifies all 30 remaining blocked claims after transient exercise water EXPERIMENTAL batch", () => {
    const blocked = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "BLOCKED");
    const green = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "GREEN");
    const experimental = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "EXPERIMENTAL");
    expect(blocked).toHaveLength(30);
    expect(green).toHaveLength(38);
    expect(experimental).toHaveLength(9);

    const rows = classifyBlockedScientificClaims();
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((row) => row.claimId)).size).toBe(30);

    const summary = summarizeBlockedClaimClassification(rows);
    expect(summary.totalBlocked).toBe(30);
    expect(
      summary.counts["implementation-only"]
      + summary.counts["validation-data"]
      + summary.counts["research-blocked"],
    ).toBe(30);
    expect(summary.closestToGreen[0]?.claimId).toBe("C-A01");
    expect(rows.find((row) => row.claimId === "C-F01")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-F02")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-F03")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-F04")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-J02")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-J03")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-J04")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-J05")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-J06")).toBeUndefined();
    expect(summary.note).toMatch(/Do not unblock without a real oracle/i);
  });

  it("keeps research-blocked claims out of the closest-to-GREEN shortlist when science is unsettled", () => {
    const rows = classifyBlockedScientificClaims();
    const researchClosest = rows.filter(
      (row) => row.category === "research-blocked" && row.closestToGreenRank !== null,
    );
    expect(researchClosest).toHaveLength(0);
    expect(rows.find((row) => row.claimId === "C-K06")?.category).toBe("research-blocked");
    expect(rows.find((row) => row.claimId === "C-H02")?.category).toBe("research-blocked");
  });
});
