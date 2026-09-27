import { describe, expect, it } from "vitest";
import { formatSelectedActiveEnergyText } from "@/app/training/training-labels";

describe("formatSelectedActiveEnergyText", () => {
  it("uses provenance labels instead of raw source keys", () => {
    expect(formatSelectedActiveEnergyText({
      kcal: 250,
      source: "manual-kcal",
      fullCoverage: true,
      uk: false,
    })).toBe("250 active kcal · Manual kcal");

    expect(formatSelectedActiveEnergyText({
      kcal: 410,
      source: "garmin-fallback",
      fullCoverage: true,
      uk: true,
    })).toBe("410 активних ккал · Оцінка пристрою");
  });

  it("marks partial coverage and unavailable energy without inventing zero", () => {
    expect(formatSelectedActiveEnergyText({
      kcal: 180,
      source: "bodycast-stepper-mechanical",
      fullCoverage: false,
      uk: false,
    })).toBe("180 active kcal · BodyCast mechanical estimate · partial coverage");

    expect(formatSelectedActiveEnergyText({
      kcal: null,
      source: null,
      fullCoverage: null,
      uk: false,
      deviceKcalUnused: 90,
    })).toBe("Energy not selected · device 90 kcal not used");

    expect(formatSelectedActiveEnergyText({
      kcal: null,
      source: "unavailable",
      fullCoverage: false,
      uk: true,
    })).toBe("Енергія недоступна");
  });
});
