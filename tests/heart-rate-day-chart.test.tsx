/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HeartRateDayChart } from "@/app/history/heart-rate-day-chart";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="hr-chart">{children}</div>,
  LineChart: ({ children, data }: { children: React.ReactNode; data: unknown }) => (
    <div data-chart={JSON.stringify(data)}>{children}</div>
  ),
  Line: (props: Record<string, unknown>) => <div data-line={String(props.dataKey)} />,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA", setLocale: () => undefined }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HeartRateDayChart", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads today's heart rate independently and refetches when the day changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("date=2026-09-10")) {
        return jsonResponse({
          date: "2026-09-10",
          heartRate: {
            sampleCount: 2,
            minBpm: 70,
            maxBpm: 90,
            avgBpm: 80,
            latestBpm: 90,
            latestTimestamp: "2026-09-10T18:00:00.000Z",
            samples: [
              { timestamp: "2026-09-10T08:00:00.000Z", bpm: 70 },
              { timestamp: "2026-09-10T18:00:00.000Z", bpm: 90 },
            ],
          },
        });
      }
      return jsonResponse({
        date: "2026-09-17",
        heartRate: {
          sampleCount: 1,
          minBpm: 62,
          maxBpm: 62,
          avgBpm: 62,
          latestBpm: 62,
          latestTimestamp: "2026-09-17T09:00:00.000Z",
          samples: [{ timestamp: "2026-09-17T09:00:00.000Z", bpm: 62 }],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HeartRateDayChart />);

    await waitFor(() => {
      expect(screen.getByText("Пульс за день")).toBeTruthy();
      expect(screen.getByTestId("hr-chart")).toBeTruthy();
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/heart-rate?date="))).toBe(true);

    fireEvent.change(screen.getByLabelText("День"), { target: { value: "2026-09-10" } });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("date=2026-09-10"))).toBe(true);
      expect(screen.getByText(/70 \/ 90 \/ 80/)).toBeTruthy();
    });
  });

  it("selects today in Bratislava even when the runtime timezone is different", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T22:30:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ date: "2026-09-25", heartRate: {
      sampleCount: 0, minBpm: null, maxBpm: null, avgBpm: null, latestBpm: null, latestTimestamp: null, samples: [],
    } })));

    render(<HeartRateDayChart />);

    expect((screen.getByLabelText("День") as HTMLInputElement).value).toBe("2026-09-25");
  });

  it("shows an empty state when the selected day has no samples", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      date: "2026-09-17",
      heartRate: {
        sampleCount: 0,
        minBpm: null,
        maxBpm: null,
        avgBpm: null,
        latestBpm: null,
        latestTimestamp: null,
        samples: [],
      },
    })));

    render(<HeartRateDayChart />);
    await waitFor(() => {
      expect(screen.getByText("За цей день даних пульсу немає")).toBeTruthy();
    });
  });
});
