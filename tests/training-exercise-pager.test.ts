/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  indexOfExerciseId,
  neighborExerciseId,
  resolveFocusedExerciseId,
} from "@/app/training/exercise-pager";
import {
  classifyPointerSwipe,
  isEditableSwipeTarget,
  shouldHandleKeyboardExerciseNav,
} from "@/app/training/horizontal-swipe";

describe("exercise pager focus", () => {
  const exercises = [{ id: 10 }, { id: 20 }, { id: 30 }];

  it("keeps preferred id when still present", () => {
    expect(resolveFocusedExerciseId(exercises, 20)).toBe(20);
  });

  it("falls back to first when preferred is gone", () => {
    expect(resolveFocusedExerciseId(exercises, 99)).toBe(10);
  });

  it("returns null for empty list", () => {
    expect(resolveFocusedExerciseId([], 20)).toBeNull();
  });

  it("neighbors stay in bounds", () => {
    expect(neighborExerciseId(exercises, 10, -1)).toBeNull();
    expect(neighborExerciseId(exercises, 10, 1)).toBe(20);
    expect(neighborExerciseId(exercises, 30, 1)).toBeNull();
    expect(indexOfExerciseId(exercises, 30)).toBe(2);
  });
});

describe("horizontal swipe classification", () => {
  it("accepts clear left/right swipes", () => {
    expect(classifyPointerSwipe({
      startX: 120, startY: 200, endX: 40, endY: 205,
    })).toEqual({ type: "horizontal", direction: "left" });
    expect(classifyPointerSwipe({
      startX: 40, startY: 200, endX: 120, endY: 198,
    })).toEqual({ type: "horizontal", direction: "right" });
  });

  it("ignores taps, vertical scrolls, and left-edge starts", () => {
    expect(classifyPointerSwipe({
      startX: 120, startY: 200, endX: 130, endY: 202,
    }).type).toBe("ignore");
    expect(classifyPointerSwipe({
      startX: 120, startY: 200, endX: 130, endY: 280,
    }).type).toBe("ignore");
    expect(classifyPointerSwipe({
      startX: 10, startY: 200, endX: 100, endY: 200,
    }).type).toBe("ignore");
  });

  it("detects editable targets and keyboard focus guards", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isEditableSwipeTarget(input)).toBe(true);
    expect(shouldHandleKeyboardExerciseNav("ArrowLeft", input)).toBe(false);
    expect(shouldHandleKeyboardExerciseNav("ArrowRight", document.body)).toBe(true);
    expect(shouldHandleKeyboardExerciseNav("Enter", document.body)).toBe(false);
    input.remove();
  });
});
