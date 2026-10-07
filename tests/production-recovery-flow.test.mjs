import { describe, it } from "vitest";
import { runProductionRecoveryFlowFixture } from "./production-recovery-flow-fixture.mjs";

describe("complete production recovery authority state machine", () => {
  it("commits two independent authorizations, keeps the marker through recovery, and removes it only after the signed receipt", async () => {
    await runProductionRecoveryFlowFixture();
  });
});
