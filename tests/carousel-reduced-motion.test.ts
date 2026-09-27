import { describe, expect, it } from "vitest";
import {
  CAROUSEL_AUTOMATIC_MS,
  CAROUSEL_MANUAL_MS,
  carouselDurationMs,
} from "@/app/training/training-exercise-workspace";

describe("carousel reduced-motion contract", () => {
  it("uses 220ms manual and 440ms automatic by default", () => {
    expect(carouselDurationMs("manual", { matches: false })).toBe(CAROUSEL_MANUAL_MS);
    expect(carouselDurationMs("automatic", { matches: false })).toBe(CAROUSEL_AUTOMATIC_MS);
    expect(CAROUSEL_MANUAL_MS).toBe(220);
    expect(CAROUSEL_AUTOMATIC_MS).toBe(440);
  });

  it("disables movement when prefers-reduced-motion is reduce", () => {
    expect(carouselDurationMs("manual", { matches: true })).toBe(0);
    expect(carouselDurationMs("automatic", { matches: true })).toBe(0);
  });
});
