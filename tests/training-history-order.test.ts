import { describe, expect, it, vi } from "vitest";
import { TrainingRepository } from "@/modules/training/training.repository";

describe("training exercise history ordering", () => {
  it("requests completed exercise history newest first", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        resistanceType: "EXTERNAL_WEIGHT",
        sessionId: 20,
        session: {
          webStartedAt: new Date("2026-09-21T10:00:00.000Z"),
          createdAt: new Date("2026-09-21T10:00:00.000Z"),
          program: { name: "Newer" },
          matchedWorkout: null,
        },
        sets: [],
      },
    ]);
    const repository = new TrainingRepository({ strengthSessionExercise: { findMany } } as never);

    const entries = await repository.listExerciseHistory({
      excludeSessionId: 99,
      catalogId: 7,
      snapshotExerciseName: "Press",
    });

    expect(entries[0]?.occurredAt).toBe("2026-09-21T10:00:00.000Z");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { session: { matchedWorkout: { startAt: "desc" } } },
        { session: { webStartedAt: "desc" } },
        { session: { createdAt: "desc" } },
      ],
    }));
  });
});
