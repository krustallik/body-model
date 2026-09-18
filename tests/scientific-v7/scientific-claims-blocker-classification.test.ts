import { describe, expect, it } from "vitest";
import { SCIENTIFIC_V7_CLAIMS } from "./scientific-claims.manifest";
import {
  classifyBlockedScientificClaims,
  summarizeBlockedClaimClassification,
} from "./scientific-claims-blocker-classification";

describe("Stage 12 blocked scientific-claim triage", () => {
  it("classifies all 39 remaining blocked claims after sleep/MPS/swelling guardrail GREEN batch", () => {
    const blocked = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "BLOCKED");
    const green = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.status === "GREEN");
    expect(blocked).toHaveLength(39);
    expect(green).toHaveLength(38);

    const rows = classifyBlockedScientificClaims();
    expect(rows).toHaveLength(39);
    expect(new Set(rows.map((row) => row.claimId)).size).toBe(39);

    const summary = summarizeBlockedClaimClassification(rows);
    expect(summary.totalBlocked).toBe(39);
    expect(
      summary.counts["implementation-only"]
      + summary.counts["validation-data"]
      + summary.counts["research-blocked"],
    ).toBe(39);
    expect(summary.closestToGreen[0]?.claimId).toBe("C-A01");
    expect(rows.find((row) => row.claimId === "C-M02")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-M03")).toBeUndefined();
    expect(rows.find((row) => row.claimId === "C-J01")).toBeUndefined();
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
