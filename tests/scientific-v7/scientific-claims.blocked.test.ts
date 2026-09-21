import { describe, it } from "vitest";
import {
  SCIENTIFIC_V7_CLAIMS,
  SCIENTIFIC_V7_FLOW_BLOCKERS,
} from "./scientific-claims.manifest";

describe("scientific v7 claims awaiting production contracts", () => {
  let blockedCount = 0;
  for (const claim of SCIENTIFIC_V7_CLAIMS) {
    if (claim.status !== "BLOCKED") continue;
    blockedCount += 1;
    it.skip(claim.testName, () => {
      throw new Error(claim.infrastructureBlocker);
    });
  }
  // Vitest treats a deliberately empty manifest category as a failed suite.
  // Keep the status taxonomy valid when all claims have a non-BLOCKED state.
  if (blockedCount === 0) it.skip("no blocked claims remain", () => {});
});

describe("scientific v7 full-flow specifications awaiting production contracts", () => {
  for (const blocker of SCIENTIFIC_V7_FLOW_BLOCKERS) {
    it.skip(`[${blocker.id}] ${blocker.testName}`, () => {
      throw new Error(blocker.reason);
    });
  }
});
