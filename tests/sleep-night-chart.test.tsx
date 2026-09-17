/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SleepNightChart } from "@/app/history/sleep-night-chart";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA", setLocale: () => undefined }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SleepNightChart", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nightly summary and stage rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      date: "2026-09-17",
      sleep: {
        sleepDate: "2026-09-17",
        sleepStartAt: "2026-09-16T20:21:00.000Z",
        sleepEndAt: "2026-09-17T04:30:00.000Z",
        totalSleepMinutes: 468,
        timeInBedMinutes: 489,
        awakeMinutes: 21,
        coreMinutes: 300,
        deepMinutes: 109,
        remMinutes: 59,
        unspecifiedSleepMinutes: 0,
        efficiencyPercent: (468 / 489) * 100,
        segmentCount: 5,
        timeInBedProvenance: "inBed-union",
        sleepDateAttribution: "segment-offset",
        wakeOffsetMinutes: 120,
        qualityFlags: [],
        segments: [
          { startAt: "2026-09-16T20:21:00.000Z", endAt: "2026-09-17T04:30:00.000Z", state: "inBed", rawState: "У ліжку" },
          { startAt: "2026-09-16T20:21:00.000Z", endAt: "2026-09-16T21:20:00.000Z", state: "rem", rawState: "Швидкий" },
          { startAt: "2026-09-16T21:20:00.000Z", endAt: "2026-09-17T02:20:00.000Z", state: "core", rawState: "Повільний" },
          { startAt: "2026-09-17T02:20:00.000Z", endAt: "2026-09-17T02:41:00.000Z", state: "awake", rawState: "Без сну" },
          { startAt: "2026-09-17T02:41:00.000Z", endAt: "2026-09-17T04:30:00.000Z", state: "deep", rawState: "Глибокий" },
        ],
      },
    })));

    render(<SleepNightChart />);
    await waitFor(() => {
      expect(screen.getByText("Фази сну")).toBeTruthy();
      expect(screen.getByText("7 год 48 хв")).toBeTruthy();
      expect(screen.getByText("8 год 9 хв")).toBeTruthy();
    });
  });

  it("shows empty state when sleep is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ date: "2026-09-17", sleep: null })));
    render(<SleepNightChart />);
    await waitFor(() => {
      expect(screen.getByText("За цю ніч даних сну немає")).toBeTruthy();
    });
  });
});
