import { describe, expect, it } from "vitest";
import { SCIENTIFIC_V7_CLAIMS } from "./scientific-claims.manifest";
import {
  classifyBlockedScientificClaims,
  summarizeBlockedClaimClassification,
} from "./scientific-claims-blocker-classification";

describe("Stage 12 blocked scientific-claim triage", () => {
  it("classifies all 29 remaining blocked claims after strength active energy EXPERIMENTAL claim", () => {
    const blocked = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "BLOCKED");
    const green = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "GREEN");
    const experimental = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "EXPERIMENTAL");
    expect(blocked).toHaveLength(29);
    expect(green).toHaveLength(38);
    expect(experimental).toHaveLength(11);

    const rows = classifyBlockedScientificClaims();
    expect(rows).toHaveLength(29);
    expect(new Set(rows.map((row) => row.claimId)).size).toBe(29);

    const summary = summarizeBlockedClaimClassification(rows);
    expect(summary.totalBlocked).toBe(29);
    expect(
      summary.counts["implementation-only"]
      + summary.counts["validation-data"]
      + summary.counts["research-blocked"],
    ).toBe(29);
    expect(summary.closestToGreen[0]?.claimId).toBe("C-A01");
    expect(rows.find((row) => row.claimId === "C-K06")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-K08")).toBeUndefined();
    expect(summary.note).toMatch(/Do not unblock without a real oracle/i);
  });

  it("keeps research-blocked claims out of the closest-to-GREEN shortlist when science is unsettled", () => {
    const rows = classifyBlockedScientificClaims();
    const researchClosest = rows.filter(
      (row) => row.category === "research-blocked" && row.closestToGreenRank !== null,
    );
    expect(researchClosest).toHaveLength(0);
    expect(rows.find((row) => row.claimId === "C-K06")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-H02")?.category).toBe("research-blocked");
  });
});