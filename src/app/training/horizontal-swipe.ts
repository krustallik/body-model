export type HorizontalSwipeDirection = "left" | "right";

export type SwipeClassification =
  | { type: "ignore" }
  | { type: "horizontal"; direction: HorizontalSwipeDirection };

const DEFAULT_MIN_DISTANCE_PX = 56;
const DEFAULT_MIN_RATIO = 1.6;
const DEFAULT_EDGE_IGNORE_PX = 28;

/**
 * Classify a pointer path as a deliberate horizontal swipe.
 * Vertical-dominant gestures and short taps are ignored.
 * Left-edge starts are ignored to protect iOS Safari back-swipe.
 */
export function classifyPointerSwipe(input: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  viewportWidth?: number;
  minDistancePx?: number;
  minRatio?: number;
  edgeIgnorePx?: number;
}): SwipeClassification {
  const minDistance = input.minDistancePx ?? DEFAULT_MIN_DISTANCE_PX;
  const minRatio = input.minRatio ?? DEFAULT_MIN_RATIO;
  const edgeIgnore = input.edgeIgnorePx ?? DEFAULT_EDGE_IGNORE_PX;
  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (input.startX <= edgeIgnore) return { type: "ignore" };
  if (
    input.viewportWidth != null
    && input.startX >= input.viewportWidth - edgeIgnore
  ) {
    // Keep right-edge free for OS gestures / accidental edge grabs.
    return { type: "ignore" };
  }
  if (absX < minDistance) return { type: "ignore" };
  if (absY > 0 && absX / absY < minRatio) return { type: "ignore" };

  return {
    type: "horizontal",
    direction: dx < 0 ? "left" : "right",
  };
}

export function isEditableSwipeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    "input, textarea, select, option, button, a, [contenteditable='true'], [role='textbox']",
  );
  return editable != null;
}

export function shouldHandleKeyboardExerciseNav(
  key: string,
  activeElement: Element | null,
): boolean {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
  if (!(activeElement instanceof HTMLElement)) return true;
  const tag = activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  if (activeElement.isContentEditable) return false;
  return true;
}
