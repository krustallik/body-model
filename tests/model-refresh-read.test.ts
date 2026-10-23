import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentModelRead, ModelRefreshPendingError } from "@/lib/model-refresh-read";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded read-only model pending recovery", () => {
  it("retries a pending GET, then returns the readable current response", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "model_refresh_pending" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ diagnostic: { current: true } }));
    vi.stubGlobal("fetch", fetch);
    const pending = vi.fn();
    const result = fetchCurrentModelRead("/diagnostic", { onPending: pending, retryDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await (await result).json()).toEqual({ diagnostic: { current: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pending).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.every(([, init]) => init.method === undefined && init.cache === "no-store")).toBe(true);
  });

  it("also waits for a 200 context whose source generation is pending", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: { productionCurrent: false, productionDirtyFromDate: "2026-10-23" } }))
      .mockResolvedValueOnce(Response.json({ status: { productionCurrent: true } }));
    vi.stubGlobal("fetch", fetch);
    const result = fetchCurrentModelRead("/context", { retryDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await (await result).json()).toEqual({ status: { productionCurrent: true } });
  });

  it("ends pending recovery after its budget so the view can offer manual retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => Response.json({ error: "training_refresh_pending" }, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(fetchCurrentModelRead("/context", { maxAttempts: 3, retryDelayMs: 10 }))
      .rejects.toBeInstanceOf(ModelRefreshPendingError);
    await vi.advanceTimersByTimeAsync(30);
    await result;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("cancels a queued retry on unmount without another request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn(async () => Response.json({ refreshPending: true }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(fetchCurrentModelRead("/diagnostics", { signal: controller.signal, retryDelayMs: 10 }))
      .rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a terminal error or overlap an in-flight request", async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const result = fetchCurrentModelRead("/missing", { retryDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(1);
    release(Response.json({ error: "not_found" }, { status: 404 }));
    expect((await result).status).toBe(404);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
