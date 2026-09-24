import { describe, expect, it } from "vitest";
import {
  HISTORICAL_LOAD_ENTRY_CONTRACT_V1,
  LOAD_ACCOUNTING_CONTRACT_VERSION,
  RIR_INTERPRETATION_CONTRACT_VERSION,
  rirBucketV1,
} from "@/modules/training/training-analytics-contracts";

describe("Stage 00 training contracts", () => {
  it("freezes historical load bases without combining unlike measures", () => {
    expect(LOAD_ACCOUNTING_CONTRACT_VERSION).toBe("bodycast-load-accounting-contract-v1");
    expect(HISTORICAL_LOAD_ENTRY_CONTRACT_V1.externalWeight.bilateralVolumeMultiplier).toBe(2);
    expect(HISTORICAL_LOAD_ENTRY_CONTRACT_V1.hyperextension.volumeMultiplier).toBe(1);
    expect(HISTORICAL_LOAD_ENTRY_CONTRACT_V1.resistanceBand.unit).toBe("nominal-kg-repetitions");
    expect(HISTORICAL_LOAD_ENTRY_CONTRACT_V1.bodyweight.separateFromExternalWeight).toBe(true);
  });

  it("keeps RIR as a bounded self-report bucket and preserves unknown", () => {
    expect(RIR_INTERPRETATION_CONTRACT_VERSION).toBe("bodycast-rir-interpretation-v1");
    expect([0, 1, 2, 3, 4, 10, null].map(rirBucketV1)).toEqual([
      "0-1", "0-1", "2-3", "2-3", "4+", "4+", "unknown",
    ]);
    expect(rirBucketV1(-1)).toBe("unknown");
  });
});
