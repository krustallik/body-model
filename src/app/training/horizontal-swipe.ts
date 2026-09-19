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

const DEFAULT_COMMIT_RATIO = 0.28;
const DEFAULT_FLICK_PX_PER_MS = 0.45;

export type CarouselRelease =
  | { type: "ignore" }
  | { type: "snap-back" }
  | { type: "commit"; direction: HorizontalSwipeDirection };

/**
 * Decide whether a follow-finger drag should change exercise or spring back.
 * Commits when the offset is ~28% of the pane, a flick, or the legacy min distance
 * (so jsdom tests with zero layout width still page).
 */
export function classifyCarouselRelease(input: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
  paneWidth: number;
  canPrev: boolean;
  canNext: boolean;
  viewportWidth?: number;
  minDistancePx?: number;
  minRatio?: number;
  edgeIgnorePx?: number;
  commitRatio?: number;
  flickPxPerMs?: number;
}): CarouselRelease {
  const edgeIgnore = input.edgeIgnorePx ?? DEFAULT_EDGE_IGNORE_PX;
  if (input.startX <= edgeIgnore) return { type: "ignore" };
  if (
    input.viewportWidth != null
    && input.startX >= input.viewportWidth - edgeIgnore
  ) {
    return { type: "ignore" };
  }

  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const minRatio = input.minRatio ?? DEFAULT_MIN_RATIO;
  if (absY > 0 && absX / absY < minRatio) return { type: "snap-back" };

  const direction: HorizontalSwipeDirection = dx < 0 ? "left" : "right";
  if (direction === "left" && !input.canNext) return { type: "snap-back" };
  if (direction === "right" && !input.canPrev) return { type: "snap-back" };

  const minDistance = input.minDistancePx ?? DEFAULT_MIN_DISTANCE_PX;
  const commitRatio = input.commitRatio ?? DEFAULT_COMMIT_RATIO;
  const flickSpeed = input.flickPxPerMs ?? DEFAULT_FLICK_PX_PER_MS;
  const paneWidth = input.paneWidth > 0 ? input.paneWidth : 0;
  const ratioCommit = paneWidth > 0 && absX >= paneWidth * commitRatio;
  const distanceCommit = absX >= minDistance;
  const durationMs = Math.max(1, input.durationMs);
  const flickCommit = absX >= minDistance * 0.45 && absX / durationMs >= flickSpeed;

  if (!ratioCommit && !distanceCommit && !flickCommit) return { type: "snap-back" };
  return { type: "commit", direction };
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
