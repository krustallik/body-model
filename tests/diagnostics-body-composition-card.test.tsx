/** @vitest-environment jsdom */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { DiagnosticsDto } from "@/modules/model-diagnostics/model-diagnostics.types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/diagnostics",
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

vi.mock("@/components/help-tip", () => ({
  HelpTip: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="help">{children}</span>
  ),
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "uk", intlLocale: "uk-UA", setLocale: () => undefined }),
}));

import { DiagnosticsClient } from "@/app/diagnostics/diagnostics-client";

function diagnosticsDto(): DiagnosticsDto {
  return {
    episode: {
      id: 1,
      modelVersion: "test",
      timezone: "Europe/Bratislava",
      startDate: "2026-01-01",
      latestModeledDate: "2026-09-18",
      updatedAt: "2026-09-18T12:00:00.000Z",
    },
    currentState: {
      level: "good",
      status: "available",
      source: "deterministic",
      predictedWeightKg: 89.4,
      filteredWeightKg: 89.2,
      fatMassKg: 24.4,
      leanTissueKg: 44.7,
      glycogenAndExtracellularFluidMassKg: 20.3,
      dynamicRmrKcalPerDay: 1800,
      modeledTdeeKcalPerDay: 3053,
    },
    experimentalEnergySummary: {
      restingRmrKcalPerDay: 1800,
      recentTypicalMaintenanceKcalPerDay: 2900,
      todayEstimatedExpenditureKcalPerDay: 3053,
      latestModeledExpenditureKcalPerDay: 3053,
      typicalMaintenanceEligibleDays: 22,
      typicalMaintenanceWindowDays: 28,
    },
    energyHistory: {
      latestModeledDay: { date: "2026-09-18", status: "complete", expenditureKcalPerDay: 3053 },
      previousCompletedDays: [
        { date: "2026-09-11", expenditureKcalPerDay: null },
        { date: "2026-09-12", expenditureKcalPerDay: null },
        { date: "2026-09-13", expenditureKcalPerDay: null },
        { date: "2026-09-14", expenditureKcalPerDay: null },
        { date: "2026-09-15", expenditureKcalPerDay: null },
        { date: "2026-09-16", expenditureKcalPerDay: null },
        { date: "2026-09-17", expenditureKcalPerDay: 3020 },
      ],
    },
    dataContinuity: {
      level: "good",
      recentWindowDays: 28,
      windowStartDate: "2026-08-21",
      windowEndDate: "2026-09-18",
      modeledDayCount: 28,
      completeDayCount: 28,
      incompleteDayCount: 0,
      nutrition: { observedDayCount: 28, imputedDayCount: 0, unresolvedDayCount: 0 },
      weightObservationCount: 20,
      unknownIntervalCount: 0,
      unresolvedDayCount: 0,
      noWorkIntervalSemantics: "zero-occupational-work-not-missing",
    },
    personalization: {
      level: "limited",
      status: "insufficient-history",
      accepted: false,
      activeParameters: [],
      personalOffsetKcalPerDay: 0,
      activityCalibration: 1,
      initialization: {
        estimatedCorrectionKcalPerDay: 0,
        confidence: "insufficient",
        appliedCorrectionKcalPerDay: 0,
        applied: false,
        explanation: "not applied",
      },
      evidence: {
        completeDayCount: 28,
        observationCount: 10,
        observationSpanDays: 20,
        activityStandardDeviationKcalPerDay: 40,
        activityCoefficientOfVariation: 0.1,
      },
      gates: [],
      nextGate: null,
      warnings: [],
    },
    recovery: {
      level: "good",
      status: "not-required",
      usableForForecast: true,
      observationCount: null,
      validParticleFraction: null,
      normalizedEffectiveSampleSize: null,
      maximumWeight: null,
      algorithmVersion: null,
      qualityReasons: [],
      supportWarnings: [],
      gaps: [],
    },
    forecastReadiness: {
      level: "good",
      allowed: true,
      initialStateSource: "deterministic",
      reasons: [],
    },
    limitations: [
      { id: "latent-state-not-scale-reading", scope: "current-state" },
      { id: "hold-ecf", scope: "model" },
    ],
  };
}

describe("DiagnosticsClient body-composition card", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(diagnosticsDto())));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders Hall compartments that reconcile to estimated weight without FFM mislabel", async () => {
    render(<DiagnosticsClient />);
    await waitFor(() => {
      expect(screen.getByText("Що модель оцінює зараз")).toBeTruthy();
    });
    expect(screen.getByText("Нежирова тканина (без глікогену й ECF)")).toBeTruthy();
    expect(screen.getByText("Глікоген, вода й ECF")).toBeTruthy();
    expect(screen.queryByText("М’язи й інше без жиру")).toBeNull();
    expect(screen.getByText("89.4 kg")).toBeTruthy();
    expect(screen.getByText("24.4 kg")).toBeTruthy();
    expect(screen.getByText("44.7 kg")).toBeTruthy();
    expect(screen.getByText("20.3 kg")).toBeTruthy();
    expect(screen.getByText("3053 kcal")).toBeTruthy();
  });

  it("recovers pending diagnostics automatically without posting a recalculation", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ refreshPending: true }))
      .mockResolvedValueOnce(Response.json(diagnosticsDto()));
    vi.stubGlobal("fetch", fetch);
    render(<DiagnosticsClient />);
    expect(await screen.findByText("Модель оновлюється. Перевіряємо готовність…")).toBeTruthy();
    expect(await screen.findByText("89.4 kg", {}, { timeout: 5000 })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  }, 6000);

  it("explains modeled expenditure periods, completion status, and omits the misleading today estimate", async () => {
    render(<DiagnosticsClient />);
    expect(await screen.findByText("Енерговитрати останнього змодельованого дня")).toBeTruthy();
    expect(screen.getByText("Типова підтримка · середнє за 28 днів")).toBeTruthy();
    expect(screen.getByText("22/28 придатних модельних днів")).toBeTruthy();
    expect(screen.getByText("Сім календарних днів перед останнім змодельованим днем")).toBeTruthy();
    expect(screen.getByText(/Стан на останній змодельований день · розрахунок повний/)).toBeTruthy();
    expect(screen.getByText("Енерговитрати останнього змодельованого дня").parentElement?.parentElement?.textContent).toContain("18 вер. 2026 р.");
    expect(screen.getByText("17 вер. 2026 р.")).toBeTruthy();
    expect(screen.getAllByText("немає актуальної оцінки")).toHaveLength(6);
    expect(screen.getAllByText("оцінка моделі")).toHaveLength(7);
    expect(screen.getByText(/Значення останнього дня може відрізнятися/i)).toBeTruthy();
    expect(screen.queryByText("Сьогодні")).toBeNull();
  });

  it("shows every prior calendar date as unavailable when none has a current estimate", async () => {
    const dto = diagnosticsDto();
    dto.energyHistory.previousCompletedDays = dto.energyHistory.previousCompletedDays.map((day) => ({
      ...day,
      expenditureKcalPerDay: null,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(dto)));

    const { container } = render(<DiagnosticsClient />);
    expect(await screen.findByText("Сім календарних днів перед останнім змодельованим днем")).toBeTruthy();
    expect(container.querySelectorAll("time[datetime]")).toHaveLength(7);
    expect(screen.getByText("Енерговитрати останнього змодельованого дня")).toBeTruthy();
    expect(screen.getAllByText("немає актуальної оцінки")).toHaveLength(7);
    expect(screen.queryByText("Актуальної енерговитрати за попередні дні немає.")).toBeNull();
  });

  it("keeps the seven-day calendar visible when the optional experimental summary is absent", async () => {
    const dto = diagnosticsDto();
    delete dto.experimentalEnergySummary;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(dto)));

    const { container } = render(<DiagnosticsClient />);
    expect(await screen.findByText("Сім календарних днів перед останнім змодельованим днем")).toBeTruthy();
    expect(container.querySelectorAll("time[datetime]")).toHaveLength(7);
    expect(screen.getByText("Енерговитрати останнього змодельованого дня")).toBeTruthy();
    expect(screen.queryByText("Типова підтримка · середнє за 28 днів")).toBeNull();
  });

  it("does not show a prior available expenditure as the latest day's missing estimate", async () => {
    const dto = diagnosticsDto();
    dto.experimentalEnergySummary = { ...dto.experimentalEnergySummary!, latestModeledExpenditureKcalPerDay: 3333 };
    dto.energyHistory.latestModeledDay = { date: "2026-09-18", status: "incomplete", expenditureKcalPerDay: null };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(dto));
    render(<DiagnosticsClient />);
    expect(await screen.findAllByText("немає оцінки")).toHaveLength(1);
    expect(screen.getAllByText("немає актуальної оцінки")).toHaveLength(6);
    expect(screen.queryByText("3333 kcal")).toBeNull();
  });

  it("says modeled days need refreshing when the current estimate is unavailable", async () => {
    const stale = diagnosticsDto();
    stale.episode.latestModeledDate = "2026-06-10";
    stale.dataContinuity.modeledDayCount = 4;
    stale.dataContinuity.completeDayCount = 4;
    stale.currentState.status = "unavailable";
    stale.currentState.predictedWeightKg = null;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(stale)));

    render(<DiagnosticsClient />);
    expect(await screen.findByText("Є пораховані дні, але поточна оцінка потребує оновлення")).toBeTruthy();
    expect(screen.queryByText("Порахованих днів ще немає")).toBeNull();
  });

  it("keeps the no-modeled-days message when coverage is zero", async () => {
    const empty = diagnosticsDto();
    empty.episode.latestModeledDate = null;
    empty.dataContinuity.modeledDayCount = 0;
    empty.dataContinuity.completeDayCount = 0;
    empty.currentState.status = "unavailable";
    empty.currentState.predictedWeightKg = null;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(empty)));

    render(<DiagnosticsClient />);
    expect(await screen.findByText("Порахованих днів ще немає")).toBeTruthy();
  });
});
