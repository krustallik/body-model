import { describe, expect, it } from "vitest";
import type { PhysiologyDayResultV7 } from "@/model/physiology-v7/daily-runtime-v7";
import {
  dataQualityChip,
  forecastMetricSemanticsNotes,
  forecastWorkoutScenarioNotes,
  nutritionSourceChip,
  physiologyV7CacheChip,
  physiologyV7CompartmentChips,
  productionForecastCompartmentNotes,
  workoutEnergyProvenanceChip,
  workoutEnergyProvenanceKind,
  workoutFeedProvenanceChip,
} from "@/modules/provenance/provenance-presentation";

function compartment(
  availability: "available" | "unavailable",
  transitionStatus: "known-numeric" | "carried-forward" | "unavailable",
  provenance: "provided-prior-state" | "carried-forward-prior-state" | null = null,
) {
  if (availability === "unavailable") {
    return {
      availability: "unavailable" as const,
      valueKg: null,
      provenance: null,
      transitionStatus: "unavailable" as const,
      stateHandling: "state-remains-unavailable" as const,
      biologicalTransition: "not-modeled" as const,
      unavailableReason: "test",
    };
  }
  return {
    availability: "available" as const,
    valueKg: 1,
    provenance: provenance ?? "provided-prior-state",
    transitionStatus: transitionStatus === "unavailable" ? "known-numeric" as const : transitionStatus,
    stateHandling: "carry-forward-for-simulation" as const,
    biologicalTransition: "not-modeled" as const,
    unavailableReason: null,
  };
}

describe("Stage 11 provenance presentation", () => {
  it("treats missing and zero workout energy as unavailable, not measured zero", () => {
    expect(workoutEnergyProvenanceKind(null)).toBe("unavailable");
    expect(workoutEnergyProvenanceKind(undefined)).toBe("unavailable");
    expect(workoutEnergyProvenanceKind(0)).toBe("unavailable");
    expect(workoutEnergyProvenanceKind(240)).toBe("device-estimate");
    expect(workoutEnergyProvenanceChip(null).detail).toMatch(/not 0 kcal/i);
    expect(workoutEnergyProvenanceChip(180).label).toMatch(/device estimate/i);
  });

  it("distinguishes workout-feed observed, missing, and legacy unknown", () => {
    expect(workoutFeedProvenanceChip(true)?.tone).toBe("observed");
    expect(workoutFeedProvenanceChip(false)?.detail).toMatch(/≠ rest/i);
    expect(workoutFeedProvenanceChip(null)?.tone).toBe("info");
    expect(workoutFeedProvenanceChip(undefined)).toBeNull();
  });

  it("maps day data quality and nutrition without inventing precision", () => {
    expect(dataQualityChip("observed")?.tone).toBe("observed");
    expect(dataQualityChip("estimated")?.tone).toBe("estimated");
    expect(dataQualityChip("incomplete")?.detail).toMatch(/Missing ≠ 0/i);
    expect(dataQualityChip("blocked")?.tone).toBe("unavailable");
    expect(nutritionSourceChip("imputed-local")?.tone).toBe("estimated");
    expect(nutritionSourceChip("missing")?.detail).toMatch(/≠ zero intake/i);
  });

  it("explains carried vs unavailable v7 compartments without numeric fake precision", () => {
    const result = {
      resultingState: {
        compartments: {
          skeletalMuscleKg: compartment("unavailable", "unavailable"),
          glycogenKg: compartment("available", "carried-forward", "carried-forward-prior-state"),
          glycogenWaterKg: compartment("available", "known-numeric", "provided-prior-state"),
        },
      },
    } as unknown as PhysiologyDayResultV7;
    const chips = physiologyV7CompartmentChips(result);
    expect(chips.find((chip) => chip.key === "skeletal-muscle")?.tone).toBe("unavailable");
    expect(chips.find((chip) => chip.key === "skeletal-muscle")?.detail).toMatch(/≠ 0/);
    expect(chips.find((chip) => chip.key === "glycogen")?.tone).toBe("carried");
    expect(chips.find((chip) => chip.key === "glycogen")?.detail).toMatch(/not a new .*measured unchanged/i);
    expect(chips.find((chip) => chip.key === "glycogen-water")?.tone).toBe("observed");
  });

  it("reports v7 cache current/stale/missing honestly", () => {
    expect(physiologyV7CacheChip("current").label).toMatch(/current/i);
    expect(physiologyV7CacheChip("stale").tone).toBe("estimated");
    expect(physiologyV7CacheChip("missing").detail).toMatch(/Missing ≠ zero/i);
  });

  it("keeps forecast metric notes free of shadow fat/weight production truth", () => {
    const notes = forecastMetricSemanticsNotes("en").join(" ");
    expect(notes).toMatch(/Hall\/Forbes aggregate lean/i);
    expect(notes).toMatch(/unavailable glycogen is not 0 kg/i);
    expect(notes).toMatch(/shadow is not shown as production truth/i);
    expect(notes.toLowerCase()).not.toMatch(/recovery score/);
  });

  it("documents workout-scenario forecast inputs without inventing MET for stepper energy", () => {
    const recent = forecastWorkoutScenarioNotes("recent-behavior", {
      strengthDaysPerWeek: 0,
      strengthTrainingMinutes: 0,
      otherTrainingDaysPerWeek: 0,
      otherTrainingMinutes: 0,
    }, "en");
    expect(recent.some((note) => /not treated as rest/i.test(note))).toBe(true);

    const planned = forecastWorkoutScenarioNotes("fixed", {
      strengthDaysPerWeek: 3,
      strengthTrainingMinutes: 60,
      otherTrainingDaysPerWeek: 2,
      otherTrainingMinutes: 30,
    }, "en");
    expect(planned.some((note) => /strength MET fallback/i.test(note))).toBe(true);
    expect(planned.some((note) => /no invented MET/i.test(note))).toBe(true);
    expect(planned.some((note) => /does not change scenario nutrition/i.test(note))).toBe(true);
  });

  it("marks production forecast skeletal muscle as unavailable rather than zero", () => {
    const chips = productionForecastCompartmentNotes("en");
    expect(chips.find((chip) => chip.key === "skeletal-muscle-production")?.tone).toBe("unavailable");
    expect(chips.find((chip) => chip.key === "glycogen-production")?.detail).toMatch(/unavailable ≠ 0/i);
  });
});
