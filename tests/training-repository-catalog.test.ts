import { describe, expect, it, vi } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { TrainingRepository } from "@/modules/training/training.repository";

describe("TrainingRepository canonical catalog reads", () => {
  it("fills only missing canonical rows and preserves existing catalog identities", async () => {
    const identities = CANONICAL_EXERCISE_IDENTITIES;
    const existing = [
      {
        id: 100, name: identities[0]!.displayName, stableKey: identities[0]!.stableKey,
        isActive: true, archivedAt: null, muscleMapping: null, currentLoadAccountingConfig: null,
      },
      {
        id: 101, name: "Renamed exercise", stableKey: identities[1]!.stableKey,
        isActive: false, archivedAt: null, muscleMapping: null, currentLoadAccountingConfig: null,
      },
      {
        id: 102, name: identities[2]!.displayName, stableKey: null,
        isActive: true, archivedAt: null, muscleMapping: null, currentLoadAccountingConfig: null,
      },
    ];
    const additions = identities.slice(3).map((identity, index) => ({
      id: index + 200,
      name: identity.displayName,
      stableKey: identity.stableKey,
      isActive: true,
      archivedAt: null,
      muscleMapping: null,
      currentLoadAccountingConfig: null,
    }));
    const custom = {
      id: 999, name: "Custom exercise", stableKey: null,
      isActive: true, archivedAt: null, muscleMapping: null, currentLoadAccountingConfig: null,
    };
    const persisted = [...existing, ...additions];
    const findMany = vi.fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(persisted)
      .mockResolvedValueOnce([...persisted.filter((row) => row.isActive), custom])
      .mockResolvedValueOnce(persisted)
      .mockResolvedValueOnce([...persisted, custom]);
    const createMany = vi.fn().mockResolvedValue({ count: additions.length });
    const repository = new TrainingRepository({
      exerciseCatalog: { findMany, createMany },
    } as never);

    const activeRows = await repository.listCatalog({ profileId: 42 });
    const allRows = await repository.listCatalog({ profileId: 42, activeOnly: false });

    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith({
      data: identities.slice(3).map(({ displayName, stableKey }) => ({
        profileId: 42, name: displayName, stableKey, isActive: true,
      })),
      skipDuplicates: true,
    });
    expect(activeRows.some(({ name }) => name === "Renamed exercise")).toBe(false);
    expect(allRows).toHaveLength(identities.length + 1);
    expect(allRows.find(({ id }) => id === 101)).toMatchObject({
      name: "Renamed exercise", stableKey: identities[1]!.stableKey, isActive: false,
    });
    expect(allRows.find(({ id }) => id === 102)).toMatchObject({
      name: identities[2]!.displayName, stableKey: null,
    });
    expect(allRows.find(({ id }) => id === custom.id)).toMatchObject({ name: custom.name, stableKey: null });
    expect(createMany).toHaveBeenCalledOnce();
  });
});
