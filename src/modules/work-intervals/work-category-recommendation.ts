import type { OccupationalCategory } from "@/model/occupational-activity";

export type WorkCategoryAnswers = {
  movement: "stationary" | "some-walking" | "continuous" | "unsure";
  posture: "stable" | "reaching-bending" | "active-varied" | "unsure";
  effort: "low" | "repeated-light" | "repeated-demanding" | "unsure";
  handling: "none-or-occasional-light" | "frequent-light" | "repeated-moderate" | "unsure";
};

/**
 * Maps an explicit typical-shift pattern to an existing work category.
 * Unclear or mixed patterns deliberately return null for manual selection.
 */
export function recommendWorkCategory(answers: WorkCategoryAnswers): OccupationalCategory | null {
  if (Object.values(answers).includes("unsure")) return null;

  if (answers.movement === "continuous"
      && answers.posture === "active-varied"
      && answers.effort === "repeated-light"
      && answers.handling === "none-or-occasional-light") {
    return "standingLightModerate";
  }

  if ((answers.movement === "stationary" || answers.movement === "some-walking")
      && (answers.posture === "stable" || answers.posture === "reaching-bending")
      && (answers.effort === "low" || answers.effort === "repeated-light")
      && answers.handling === "frequent-light") {
    return "manualLight";
  }

  if (answers.movement === "stationary"
      && answers.posture === "stable"
      && answers.effort === "low"
      && answers.handling === "none-or-occasional-light") {
    return "standingLight";
  }

  if ((answers.movement === "some-walking" || answers.movement === "continuous")
      && (answers.posture === "reaching-bending" || answers.posture === "active-varied")
      && answers.effort === "repeated-demanding"
      && answers.handling === "repeated-moderate") {
    return "manualModerate";
  }

  return null;
}
