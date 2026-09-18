import { describe, expect, it } from "vitest";
import { SCIENTIFIC_V7_CLAIMS } from "./scientific-claims.manifest";
import {
  classifyBlockedScientificClaims,
  summarizeBlockedClaimClassification,
} from "./scientific-claims-blocker-classification";

describe("Stage 12 blocked scientific-claim triage", () => {
  it("classifies all 55 blocked claims without changing GREEN/BLOCKED counts", () => {
    const blocked = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.expectedInitialState === "INFRASTRUCTURE_BLOCKED");
    const green = SCIENTIFIC_V7_CLAIMS.filter((claim) => claim.expectedInitialState === "ALREADY_GREEN");
    expect(blocked).toHaveLength(55);
    expect(green).toHaveLength(22);

    const rows = classifyBlockedScientificClaims();
    expect(rows).toHaveLength(55);
    expect(new Set(rows.map((row) => row.claimId)).size).toBe(55);

    const summary = summarizeBlockedClaimClassification(rows);
    expect(summary.totalBlocked).toBe(55);
    expect(
      summary.counts["implementation-only"]
      + summary.counts["validation-data"]
      + summary.counts["research-blocked"],
    ).toBe(55);
    expect(summary.closestToGreen[0]?.claimId).toBe("C-N04");
    expect(summary.note).toMatch(/Do not unblock without a real oracle/i);
  });

  it("keeps research-blocked claims out of the closest-to-GREEN shortlist when science is unsettled", () => {
    const rows = classifyBlockedScientificClaims();
    const researchClosest = rows.filter(
      (row) => row.category === "research-blocked" && row.closestToGreenRank !== null,
    );
    expect(researchClosest).toHaveLength(0);
    expect(rows.find((row) => row.claimId === "C-K06")?.category).toBe("research-blocked");
    expect(rows.find((row) => row.claimId === "C-MV02")?.category).toBe("research-blocked");
  });
});
