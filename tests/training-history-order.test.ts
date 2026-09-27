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
      {
        resistanceType: "EXTERNAL_WEIGHT",
        sessionId: 10,
        session: {
          webStartedAt: new Date("2026-09-20T10:00:00.000Z"),
          createdAt: new Date("2026-09-20T10:00:00.000Z"),
          program: { name: "Older" },
          matchedWorkout: { startAt: new Date("2026-09-22T08:00:00.000Z") },
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

    // Occurrence order is applied in memory so nullable matchedWorkout.startAt
    // cannot steal the SQL top-N window via NULLS FIRST.
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sessionId: "desc" }, { id: "desc" }],
    }));
    expect(entries.map((entry) => entry.sessionId)).toEqual([10, 20]);
    expect(entries[0]?.occurredAt).toBe("2026-09-22T08:00:00.000Z");
  });
});
