import { describe, it } from "vitest";
import { SCIENTIFIC_V7_REJECTED_CLAIMS } from "./scientific-claims.manifest";

describe("scientific v7 claims intentionally not modeled after research", () => {
  for (const claim of SCIENTIFIC_V7_REJECTED_CLAIMS) {
    it.skip(claim.testName, () => {
      throw new Error(claim.rejectionReason);
    });
  }
});
