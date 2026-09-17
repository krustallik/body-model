import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_FORECAST_LOADING_MS,
  withMinimumVisibleLoading,
} from "@/modules/model-forecast/forecast-ui";

describe("withMinimumVisibleLoading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a positive default minimum visibility duration", () => {
    expect(MIN_FORECAST_LOADING_MS).toBeGreaterThan(0);
    expect(Number.isFinite(MIN_FORECAST_LOADING_MS)).toBe(true);
  });

  it("keeps a fast success visible until the configured minimum", async () => {
    let resolved = false;
    const work = new Promise<string>((resolve) => {
      setTimeout(() => resolve("ok"), 50);
    });
    const pending = withMinimumVisibleLoading(work, MIN_FORECAST_LOADING_MS).then((value) => {
      resolved = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS - 50);
    await expect(pending).resolves.toBe("ok");
    expect(resolved).toBe(true);
  });

  it("applies the exported default minimum when minMs is omitted", async () => {
    let resolved = false;
    const work = new Promise<string>((resolve) => {
      setTimeout(() => resolve("defaulted"), 10);
    });
    const pending = withMinimumVisibleLoading(work).then((value) => {
      resolved = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS - 1);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("defaulted");
    expect(resolved).toBe(true);
  });

  it("does not add extra delay when the response is already slower than the minimum", async () => {
    let resolved = false;
    const work = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), MIN_FORECAST_LOADING_MS + 400);
    });
    const pending = withMinimumVisibleLoading(work, MIN_FORECAST_LOADING_MS).then((value) => {
      resolved = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(MIN_FORECAST_LOADING_MS + 400);
    await expect(pending).resolves.toBe("slow");
    expect(resolved).toBe(true);
  });

  it("surfaces errors immediately without waiting for the minimum", async () => {
    const work = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("boom")), 40);
    });
    const pending = withMinimumVisibleLoading(work, MIN_FORECAST_LOADING_MS);

    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(40);
    await expect(pending).rejects.toThrow("boom");
  });
});
