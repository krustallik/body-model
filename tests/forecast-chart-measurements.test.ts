import { afterEach, describe, expect, it, vi } from "vitest";
import { attachObservedBodyFatPercent } from "@/app/forecast/forecast-chart-measurements";

describe("attachObservedBodyFatPercent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("joins valid body-fat readings by the same recorded date using the existing days endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/api/v1/days?");
      expect(init?.cache).toBe("no-store");
      return new Response(JSON.stringify({ days: [
        { date: "2026-08-23", weightKg: 80.8, bodyFatPercent: 22.1 },
        { date: "2026-08-24", weightKg: 80.3, bodyFatPercent: null },
        { date: "2026-08-25", weightKg: null, bodyFatPercent: 18 },
        { date: "2026-08-26", weightKg: 70, bodyFatPercent: 101 },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const observedWeights = [
      { date: "2026-08-23", weightKg: 80.8 },
      { date: "2026-08-24", weightKg: 80.3 },
    ];
    const result = await attachObservedBodyFatPercent(observedWeights, new AbortController().signal);

    expect(new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost").pathname).toBe("/api/v1/days");
    const query = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost").searchParams;
    expect(Object.fromEntries(query.entries())).toEqual({
      from: "2026-08-23",
      to: "2026-08-24",
      limit: "100",
      offset: "0",
      includeTrainingDays: "false",
    });
    expect(result).toEqual([
      { date: "2026-08-23", weightKg: 80.8, bodyFatPercent: 22.1 },
      { date: "2026-08-24", weightKg: 80.3, bodyFatPercent: null },
    ]);
  });

  it("keeps the weight history usable if optional daily measurements are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const observedWeights = [{ date: "2026-08-23", weightKg: 80.8 }];

    await expect(attachObservedBodyFatPercent(observedWeights, new AbortController().signal)).resolves.toEqual([
      { ...observedWeights[0], bodyFatPercent: null },
    ]);
  });

  it("preserves caller cancellation instead of treating it as optional-data failure", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); }));

    await expect(attachObservedBodyFatPercent([{ date: "2026-08-23", weightKg: 80.8 }], controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
