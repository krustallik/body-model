import { describe, expect, it } from "vitest";
import { paginationWindow } from "@/app/training/pagination-window";
import { formatSelectedActiveEnergyText, formatTrainingKcal } from "@/app/training/training-labels";

describe("Training pagination and presentation formatting", () => {
  it("shows the first, last, and current neighborhood with compact gaps", () => {
    expect(paginationWindow(7, 14)).toEqual([1, "ellipsis", 6, 7, 8, "ellipsis", 14]);
    expect(paginationWindow(2, 6)).toEqual([1, 2, 3, "ellipsis", 6]);
    expect(paginationWindow(4, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("formats active kcal as whole numbers while preserving unavailable values", () => {
    expect(formatTrainingKcal(169.70884875000002, "en")).toBe("170");
    expect(formatTrainingKcal(169.2, "uk")).toBe("169");
    expect(formatTrainingKcal(null, "en")).toBeNull();
    expect(formatTrainingKcal(Number.NaN, "en")).toBeNull();
    expect(formatSelectedActiveEnergyText({
      kcal: 169.70884875000002,
      source: "bodycast-strength-estimate",
      fullCoverage: true,
      uk: true,
    })).toContain("170 активних ккал");
    expect(formatSelectedActiveEnergyText({
      kcal: null,
      source: "unavailable",
      fullCoverage: false,
      uk: true,
    })).toBe("Енергія недоступна");
  });
});
