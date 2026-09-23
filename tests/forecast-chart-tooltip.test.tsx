/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { ForecastTooltip } from "@/app/forecast/forecast-chart";
import { forecastChartLabels } from "@/modules/model-forecast/forecast-chart-data";

afterEach(cleanup);

describe("forecast chart tooltip", () => {
  it("shows measured weight and historical model estimate as distinct values", () => {
    const labels = forecastChartLabels("en", "physiologicalBodyWeightKg", false);
    render(<ForecastTooltip active label="2026-04-29" metric="physiologicalBodyWeightKg" locale="en" payload={[
      { name: labels.measuredWeight, value: 79.2 },
      { name: labels.modelEstimate, value: 78.6 },
    ]} />);
    expect(screen.getByText("Measured weight")).toBeTruthy();
    expect(screen.getByText("79.2 kg")).toBeTruthy();
    expect(screen.getByText("Model estimate")).toBeTruthy();
    expect(screen.getByText("78.6 kg")).toBeTruthy();
    expect(screen.queryByText(/forecast median/i)).toBeNull();
    expect(screen.getByText("Apr 29, 2026")).toBeTruthy();
  });

  it("shows future median and both interval bands without leaking invalid values", () => {
    const labels = forecastChartLabels("uk", "physiologicalBodyWeightKg", false);
    render(<ForecastTooltip active label="2026-04-30" metric="physiologicalBodyWeightKg" locale="uk" payload={[
      { name: labels.futureMedian, value: 80 },
      { name: labels.innerInterval!, value: [79, 81] },
      { name: labels.outerInterval!, value: [77, 83] },
      { name: "untrusted", value: Number.NaN },
      { name: "missing" },
    ]} />);
    expect(screen.getByText("Майбутній прогноз · медіана")).toBeTruthy();
    expect(screen.getByText("80 kg")).toBeTruthy();
    expect(screen.getByText("Інтервал прогнозу 25–75%")).toBeTruthy();
    expect(screen.getByText("79–81 kg")).toBeTruthy();
    expect(screen.getByText("Інтервал прогнозу 5–95%")).toBeTruthy();
    expect(screen.getByText("77–83 kg")).toBeTruthy();
    expect(screen.queryByText("untrusted")).toBeNull();
    expect(screen.queryByText("missing")).toBeNull();
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });
});
