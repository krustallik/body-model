import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadWorkActivityDay,
  removeWorkInterval,
  saveWorkInterval,
} from "@/modules/work-intervals/work-activity.client";

const response = (body: unknown, status = 200) => new Response(
  status === 204 ? null : JSON.stringify(body),
  { status, headers: { "content-type": "application/json" } },
);

describe("work activity UI API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads intervals and reconstruction together", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ intervals: [{ id: 1 }] }))
      .mockResolvedValueOnce(response({ date: "2026-08-23", diagnostics: null }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadWorkActivityDay("2026-08-23")).resolves.toMatchObject({
      intervals: [{ id: 1 }], activity: { date: "2026-08-23" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("creates and edits intervals with the correct methods", async () => {
    const fetch = vi.fn().mockResolvedValue(response({}, 201));
    vi.stubGlobal("fetch", fetch);
    const values = { startTime: "08:00", endTime: "16:00", category: "standingLight" as const };
    await saveWorkInterval("2026-08-23", values);
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/v1/work-intervals", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ date: "2026-08-23", ...values }),
    }));
    await saveWorkInterval("2026-08-23", values, 7);
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/v1/work-intervals/7", expect.objectContaining({
      method: "PATCH", body: JSON.stringify(values),
    }));
  });

  it("deletes an interval", async () => {
    const fetch = vi.fn().mockResolvedValue(response(null, 204));
    vi.stubGlobal("fetch", fetch);
    await removeWorkInterval(9);
    expect(fetch).toHaveBeenCalledWith("/api/v1/work-intervals/9", { method: "DELETE" });
  });

  it.each([
    [{ error: "interval_overlap" }, "overlaps an existing interval"],
    [{ details: [{ message: "02:30 does not exist in Europe/Bratislava" }] }, "daylight saving"],
    [{ details: [{ message: "02:30 occurs twice in Europe/Bratislava" }] }, "ambiguous"],
  ])("shows a human API error", async (body, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, 400)));
    await expect(saveWorkInterval("2026-08-23", {
      startTime: "08:00", endTime: "16:00", category: "standingLight",
    })).rejects.toThrow(expected);
  });

  it("uses status fallback for non-JSON errors and handles each load failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 500 })));
    await expect(removeWorkInterval(1)).rejects.toThrow("Request failed (500)");

    const intervalFailure = vi.fn()
      .mockResolvedValueOnce(response({ error: "intervals_failed" }, 500))
      .mockResolvedValueOnce(response({}));
    vi.stubGlobal("fetch", intervalFailure);
    await expect(loadWorkActivityDay("2026-08-23")).rejects.toThrow("intervals_failed");

    const activityFailure = vi.fn()
      .mockResolvedValueOnce(response({ intervals: [] }))
      .mockResolvedValueOnce(response({ error: "activity_failed" }, 500));
    vi.stubGlobal("fetch", activityFailure);
    await expect(loadWorkActivityDay("2026-08-23")).rejects.toThrow("activity_failed");
  });
});
