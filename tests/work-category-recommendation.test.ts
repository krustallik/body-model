import { describe, expect, it } from "vitest";
import { recommendWorkCategory, type WorkCategoryAnswers } from "@/modules/work-intervals/work-category-recommendation";

const stationary: WorkCategoryAnswers = {
  movement: "stationary",
  posture: "stable",
  effort: "low",
  handling: "none-or-occasional-light",
};

describe("work category recommendation", () => {
  it.each([
    [stationary, "standingLight"],
    [{ ...stationary, effort: "repeated-light", handling: "frequent-light" }, "manualLight"],
    [{ ...stationary, movement: "continuous", posture: "active-varied", effort: "repeated-light" }, "standingLightModerate"],
    [{ movement: "some-walking", posture: "reaching-bending", effort: "repeated-demanding", handling: "repeated-moderate" }, "manualModerate"],
  ] as const)("returns only an existing supported category for a clear pattern", (answers, expected) => {
    expect(recommendWorkCategory(answers)).toBe(expected);
  });

  it.each([
    { ...stationary, movement: "some-walking" },
    { ...stationary, effort: "repeated-demanding" },
    { ...stationary, handling: "unsure" },
    { ...stationary, handling: "repeated-moderate" },
    { ...stationary, effort: "repeated-light", handling: "repeated-moderate" },
    { ...stationary, movement: "continuous", posture: "active-varied", handling: "frequent-light" },
    { ...stationary, movement: "stationary", posture: "active-varied", effort: "repeated-demanding", handling: "repeated-moderate" },
  ] as const)("does not invent a level when answers are mixed or uncertain", (answers) => {
    expect(recommendWorkCategory(answers)).toBeNull();
  });
});
