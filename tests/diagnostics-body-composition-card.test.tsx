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
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => diagnosticsDto(),
    })));
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
});
