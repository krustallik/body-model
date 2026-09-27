import { describe, expect, it } from "vitest";
import { planActivationVisibilityV1, rollbackVisibilityV1 } from "@/modules/model-episodes/activation-rollback-v1";

describe("activation rollback journal", () => {
  it("restores a previously hidden workout instead of clearing every flag", () => {
    const current = {
      recordId: 9,
      hiddenFromHistory: true,
      syncProtected: false,
      supersededByWorkoutId: null,
      supersessionReason: null,
      revision: "r1",
    };
    const planned = planActivationVisibilityV1({ current, supersedingWorkoutId: 4 });
    const rolled = rollbackVisibilityV1({
      current: { ...planned.next, revision: "r1" },
      journal: planned.journal,
    });
    expect(rolled).toMatchObject({
      hiddenFromHistory: true,
      syncProtected: false,
      supersededByWorkoutId: null,
      supersessionReason: null,
    });
    expect(planned.next.supersessionReason).toBe("stepper-reconciliation-activated");
    expect(planned.journal.some((row) => row.field === "supersessionReason")).toBe(true);
  });
});
