import { describe, it } from "vitest";
import {
  SCIENTIFIC_V7_CLAIMS,
  SCIENTIFIC_V7_FLOW_BLOCKERS,
} from "./scientific-claims.manifest";

describe("scientific v7 claims awaiting production contracts", () => {
  for (const claim of SCIENTIFIC_V7_CLAIMS) {
    if (claim.expectedInitialState !== "INFRASTRUCTURE_BLOCKED") continue;
    it.skip(claim.testName, () => {
      throw new Error(claim.infrastructureBlocker);
    });
  }
});

describe("scientific v7 full-flow specifications awaiting production contracts", () => {
  for (const blocker of SCIENTIFIC_V7_FLOW_BLOCKERS) {
    it.skip(`[${blocker.id}] ${blocker.testName}`, () => {
      throw new Error(blocker.reason);
    });
  }
});
