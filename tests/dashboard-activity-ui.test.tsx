/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const localeState = vi.hoisted(() => ({ locale: "en" as "en" | "uk" }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/app-nav", () => ({ AppNav: () => <nav /> }));
vi.mock("@/components/demo-data-badge", () => ({ DemoDataBadge: () => null }));
vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: localeState.locale, intlLocale: localeState.locale === "uk" ? "uk-UA" : "en-US", setLocale: () => undefined }),
}));

import { DashboardClient } from "@/app/dashboard/dashboard-client";
import { emptyTrainingDayFact } from "@/modules/days/training-day-fact-empty";
import { todayInCalendarTimeZone } from "@/modules/days/calendar-range";

describe("Dashboard activity and priority cards", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localeState.locale = "en";
  });

  it("shows active work, workout details, and puts empty priority cards after the daily overview", async () => {
    const today = todayInCalendarTimeZone();
    const todayFact = {
      ...emptyTrainingDayFact(today),
      eventCount: 1,
      durationMinutes: 45,
      events: [{
        eventId: "diary:31",
        source: "diary",
        type: "Strength Training",
        occurrenceAt: `${today}T16:30:00.000Z`,
        endAt: `${today}T17:15:00.000Z`,
        durationMinutes: 45,
        activeEnergyKcal: 210,
        energySource: "shadow-diary-estimate",
        executionStatus: "completed",
        workoutId: null,
        diarySessionId: 31,
        diaryProgramName: "Push A",
        diaryOnly: true,
        exerciseDetailAvailability: "logged-sets",
        loggedSetCount: 8,
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/dashboard")) {
        return Response.json({
          today: null,
          todayTrainingDay: todayFact,
          recentDays: [],
          recentTrainingDays: [todayFact],
          hasToday: false,
          lastSync: { at: null, status: null },
          restingHeartRate: { latestBpm: null, timestamp: null },
          sleep: null,
        });
      }
      if (url.includes("/sessions/active")) {
        return Response.json({ session: { id: 44, programName: "Pull B", webStartedAt: "2026-10-14T15:00:00.000Z", exercises: [{ id: 1 }] } });
      }
      if (url.includes("/sessions/match-attention")) return Response.json({ sessions: [], totalCount: 0 });
      if (url.includes("/api/v1/work-intervals")) {
        return Response.json({ intervals: [{ id: 9, startTime: "09:00", endTime: "17:00", category: "manualLight" }] });
      }
      return new Response(null, { status: 404 });
    }));

    render(<DashboardClient />);

    expect((await screen.findByRole("link", { name: "Resume workout" })).getAttribute("href")).toBe("/training/sessions/44");
    expect(screen.getByText("Light handling / packing")).toBeTruthy();
    expect(screen.getByText("Work activity")).toBeTruthy();
    const workout = screen.getByText("Strength Training").closest("details");
    expect(workout).toBeTruthy();
    fireEvent.click(workout!.querySelector("summary")!);
    expect(await screen.findByText("Training diary")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open details" }).getAttribute("href")).toBe("/training/sessions/31");

    await waitFor(() => expect(screen.getByLabelText("Match attention").getAttribute("data-priority")).toBe("empty"));
    expect(screen.getByLabelText("Active session").getAttribute("data-priority")).toBe("present");
    expect(screen.getByLabelText("Active session").querySelector("a")?.getAttribute("href")).toBe("/training/sessions/44");
    const dailyOverview = document.querySelector("#daily-overview")!;
    expect(Boolean(screen.getByLabelText("Active session").compareDocumentPosition(dailyOverview) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(dailyOverview.compareDocumentPosition(screen.getByLabelText("Match attention")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("does not request live training sessions in local demo mode", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/api/v1/dashboard")) {
        return Response.json({
          today: null,
          todayTrainingDay: emptyTrainingDayFact(todayInCalendarTimeZone()),
          recentDays: [],
          recentTrainingDays: [],
          hasToday: false,
          lastSync: { at: null, status: null },
          restingHeartRate: { latestBpm: null, timestamp: null },
          sleep: null,
        });
      }
      if (url.includes("/api/v1/work-intervals")) return Response.json({ intervals: [] });
      return new Response(null, { status: 404 });
    }));

    render(<DashboardClient demoMode />);
    await screen.findByText("No work intervals recorded today.");
    expect(requests.some((url) => url.includes("/sessions/active"))).toBe(false);
    expect(requests.some((url) => url.includes("/sessions/match-attention"))).toBe(false);
    expect(screen.queryByLabelText("Match attention")).toBeNull();
    expect(screen.queryByLabelText("Active session")).toBeNull();
  });

  it("clears activity errors when a later locale-triggered refresh succeeds", async () => {
    const requestCounts = new Map<string, number>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = url.includes("/sessions/active") ? "active"
        : url.includes("/sessions/match-attention") ? "matches"
          : url.includes("/api/v1/work-intervals") ? "work" : "dashboard";
      const count = (requestCounts.get(key) ?? 0) + 1;
      requestCounts.set(key, count);
      if (key === "dashboard") {
        return Response.json({
          today: null,
          todayTrainingDay: emptyTrainingDayFact(todayInCalendarTimeZone()),
          recentDays: [],
          recentTrainingDays: [],
          hasToday: false,
          lastSync: { at: null, status: null },
          restingHeartRate: { latestBpm: null, timestamp: null },
          sleep: null,
        });
      }
      if (count === 1) return new Response(null, { status: 500 });
      if (key === "active") return Response.json({ session: null });
      if (key === "matches") return Response.json({ sessions: [], totalCount: 0 });
      return Response.json({ intervals: [] });
    }));

    const view = render(<DashboardClient />);
    expect(await screen.findByText("Could not check workout matches.")).toBeTruthy();
    expect(await screen.findByText("Could not check the active workout.")).toBeTruthy();
    expect(await screen.findByText("Could not load work activity.")).toBeTruthy();

    localeState.locale = "uk";
    view.rerender(<DashboardClient />);
    expect(await screen.findByText("Немає сесій, що потребують зіставлення.")).toBeTruthy();
    expect(await screen.findByText("Зараз немає активного тренування.")).toBeTruthy();
    expect(await screen.findByText("Робочі інтервали за сьогодні не записані.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect([...requestCounts.values()]).toEqual([2, 2, 2, 2]);
  });
});
