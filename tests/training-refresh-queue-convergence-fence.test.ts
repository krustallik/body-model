import { describe, expect, it, vi } from "vitest";
import {
  activeEnergyConvergenceFenceChanged,
  readActiveEnergyConvergenceVisibilityFence,
} from "@/modules/training/training-refresh-queue";

describe("Active Energy convergence visibility token", () => {
  it("detects a complete null → present → null fence cycle through monotonic lifecycle time", async () => {
    const lifecycleTimes = [
      new Date("2026-10-17T10:00:00.000Z"),
      new Date("2026-10-17T10:00:00.002Z"),
    ];
    const client = {
      unifiedPublicationBlock: { findUnique: vi.fn().mockResolvedValue(null) },
      physiologyV7Lifecycle: { findUnique: vi.fn().mockImplementation(async () => ({
        updatedAt: lifecycleTimes.shift() ?? new Date("2026-10-17T10:00:00.002Z"),
      })) },
    };
    const before = await readActiveEnergyConvergenceVisibilityFence(client as never, 1);
    // The convergence block was created and deleted between these two reads.
    const after = await readActiveEnergyConvergenceVisibilityFence(client as never, 1);
    expect(before?.active).toBe(false);
    expect(after?.active).toBe(false);
    expect(await activeEnergyConvergenceFenceChanged(client as never, 1, before)).toBe(true);
  });
});
