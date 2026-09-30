import { describe, expect, it } from "vitest";
import { goalScenarioModeLabel, goalStatusPresentation, goalWarningLabel } from "@/modules/model-goal-planning/goal-planning-ui";

describe("Goal user-facing presentation", () => {
  it("localizes known scenario modes instead of exposing API codes", () => {
    expect(goalScenarioModeLabel("target-centered", "uk")).toBe("Гнучкий сценарій");
    expect(goalScenarioModeLabel("fixed", "uk")).toBe("Точний сценарій");
    expect(goalScenarioModeLabel("target-centered", "en")).toBe("Flexible scenario");
  });

  it("maps every solver warning code to readable copy and hides unknown codes", () => {
    const warnings = [
      "caller-boundary", "numerically-limited", "not-bracketed", "constraint-limited",
      "forecast-unreliable", "non-monotonic", "degraded-initial-state", "recovered-initial-state",
      "limited-long-horizon", "initial-state-unavailable", "initial-state-unreliable",
    ];
    for (const warning of warnings) {
      expect(goalWarningLabel(warning, "uk")).not.toBe(warning);
      expect(goalWarningLabel(warning, "en")).not.toBe(warning);
    }
    expect(goalWarningLabel("future-internal-code", "uk")).toBe("Є додаткове обмеження сценарію.");
    expect(goalWarningLabel("future-internal-code", "en")).toBe("There is an additional scenario limitation.");
  });

  it("explains blocked reliability without raw internal reason text", () => {
    expect(goalStatusPresentation("initial-state-unreliable", "uk").detail)
      .toContain("BodyCast не показує прогнозні значення");
    expect(goalStatusPresentation("initial-state-unreliable", "en").detail)
      .toContain("BodyCast does not show forecast values");
    expect(goalStatusPresentation("initial-state-unavailable", "uk").detail)
      .toContain("придатного поточного стану");
  });
});
