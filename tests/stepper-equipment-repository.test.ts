import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { StepperEquipmentRepository } from "@/modules/profile/stepper-equipment.repository";

const createdAt = new Date("2026-09-17T12:00:00Z");
const firstEffectiveFrom = new Date("2026-09-01T00:00:00Z");

function assignment(id: number, effectiveFrom: Date, effectiveTo: Date | null = null) {
  return {
    id,
    machineFamily: "DOMYOS_MS100",
    configuration: "fixed",
    effectiveFrom,
    effectiveTo,
    createdAt,
  };
}

function fixture(current: ReturnType<typeof assignment> | null = null) {
  const transaction = {
    stepperEquipmentAssignment: {
      findFirst: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue(current),
      create: vi.fn().mockImplementation(async ({ data }) => assignment(2, data.effectiveFrom)),
    },
  };
  const client = {
    stepperEquipmentAssignment: {
      findMany: vi.fn().mockResolvedValue(current ? [current] : []),
    },
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
  return { repository: new StepperEquipmentRepository(client), client, transaction };
}

describe("StepperEquipmentRepository", () => {
  it("creates the first explicitly effective MS100 assignment without inventing prior history", async () => {
    const { repository, transaction } = fixture();
    await expect(repository.configureMs100("2026-09-01T00:00:00.000Z")).resolves.toMatchObject({
      id: 2,
      machineFamily: "DOMYOS_MS100",
      configuration: "fixed",
      effectiveFrom: "2026-09-01T00:00:00.000Z",
      effectiveTo: null,
    });
    expect(transaction.stepperEquipmentAssignment.update).not.toHaveBeenCalled();
    expect(transaction.stepperEquipmentAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ profileId: 1, effectiveFrom: firstEffectiveFrom }),
    }));
  });

  it("closes the open assignment and creates a new version at a later effective instant", async () => {
    const { repository, transaction } = fixture(assignment(1, firstEffectiveFrom));
    await repository.configureMs100("2026-09-10T00:00:00.000Z");

    expect(transaction.stepperEquipmentAssignment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { effectiveTo: new Date("2026-09-10T00:00:00.000Z") },
    });
    expect(transaction.stepperEquipmentAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ effectiveFrom: new Date("2026-09-10T00:00:00.000Z") }),
    }));
  });

  it("rejects a retroactive replacement before changing assignment history", async () => {
    const { repository, transaction } = fixture(assignment(1, firstEffectiveFrom));
    await expect(repository.configureMs100("2026-09-01T00:00:00.000Z"))
      .rejects.toThrow("effectiveFrom must be later");
    expect(transaction.stepperEquipmentAssignment.update).not.toHaveBeenCalled();
    expect(transaction.stepperEquipmentAssignment.create).not.toHaveBeenCalled();
  });
});
