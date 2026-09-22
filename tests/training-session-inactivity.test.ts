import { describe, expect, it } from "vitest";
import { evaluateSessionInactivity, TRAINING_INACTIVITY_TIMEOUT_MS } from "@/modules/training/session-inactivity";
import { shouldAutoAdvanceAfterSet } from "@/modules/training/auto-advance";

const lastSetAt = new Date("2026-09-22T10:00:00.000Z");

describe("training session inactivity", () => {
  it("keeps a session active before 30 minutes", () => {
    expect(evaluateSessionInactivity({ status: "ACTIVE", lastSetAt, now: new Date(lastSetAt.getTime() + TRAINING_INACTIVITY_TIMEOUT_MS - 1) }).action).toBe("keep-active");
  });

  it("finishes at 30 minutes using the last set timestamp", () => {
    const result = evaluateSessionInactivity({ status: "ACTIVE", lastSetAt, now: new Date(lastSetAt.getTime() + TRAINING_INACTIVITY_TIMEOUT_MS) });
    expect(result).toEqual({ action: "finish", endAt: lastSetAt, lastSetAt });
  });

  it("does not finish sessions without a recorded set or completed sessions", () => {
    expect(evaluateSessionInactivity({ status: "ACTIVE", lastSetAt: null, now: new Date("2026-09-22T12:00:00Z") }).action).toBe("keep-active");
    expect(evaluateSessionInactivity({ status: "COMPLETED", lastSetAt, now: new Date("2026-09-22T12:00:00Z") }).action).toBe("keep-active");
  });

  it("resets the inactivity window when a newer set becomes the last set", () => {
    const newerSetAt = new Date(lastSetAt.getTime() + 25 * 60_000);
    expect(evaluateSessionInactivity({
      status: "ACTIVE",
      lastSetAt: newerSetAt,
      now: new Date(lastSetAt.getTime() + 30 * 60_000),
    }).action).toBe("keep-active");
  });

  it("is idempotent when the same finished state is evaluated again", () => {
    const now = new Date(lastSetAt.getTime() + TRAINING_INACTIVITY_TIMEOUT_MS);
    const first = evaluateSessionInactivity({ status: "ACTIVE", lastSetAt, now });
    const repeated = evaluateSessionInactivity({ status: "COMPLETED", lastSetAt, now });
    expect(first.action).toBe("finish");
    expect(repeated.action).toBe("keep-active");
  });
});

describe("training auto-advance", () => {
  const base = { adding: true, exerciseOrigin: "PLANNED" as const, plannedSets: 3, previousSetCount: 2, isLastExercise: false };
  it("advances only when enabled after the final planned set", () => {
    expect(shouldAutoAdvanceAfterSet({ ...base, enabled: true })).toBe(true);
    expect(shouldAutoAdvanceAfterSet({ ...base, enabled: false })).toBe(false);
  });
  it("does not advance the last or an ad-hoc exercise", () => {
    expect(shouldAutoAdvanceAfterSet({ ...base, enabled: true, isLastExercise: true })).toBe(false);
    expect(shouldAutoAdvanceAfterSet({ ...base, enabled: true, exerciseOrigin: "EXTRA" })).toBe(false);
  });
});
