import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ProfileRepository } from "@/modules/profile/profile.repository";

const createdAt = new Date("2026-08-22T10:00:00Z");

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sex: "male",
    dateOfBirth: new Date("1990-05-12T00:00:00Z"),
    heightCm: new Prisma.Decimal("180"),
    targetWeightKg: new Prisma.Decimal("81.4"),
    targetDate: new Date("2027-06-01T00:00:00Z"),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function fixture(initial: ReturnType<typeof record> | null = record()) {
  let stored = initial;
  const profile = {
    findUnique: vi.fn(async () => stored),
    upsert: vi.fn(async ({ create, update }: {
      where: { id: number };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const base = stored ?? record({ ...create, createdAt, updatedAt: createdAt });
      stored = record({
        ...base,
        ...update,
        heightCm: new Prisma.Decimal(String(update.heightCm)),
        targetWeightKg: update.targetWeightKg === null
          ? null
          : new Prisma.Decimal(String(update.targetWeightKg)),
        updatedAt: new Date("2026-08-22T11:00:00Z"),
      });
      return stored;
    }),
  };
  const client = { profile } as unknown as PrismaClient;
  return { repository: new ProfileRepository(client), profile };
}

describe("ProfileRepository", () => {
  it("returns null when the singleton does not exist", async () => {
    const { repository } = fixture(null);
    await expect(repository.get()).resolves.toBeNull();
  });

  it("creates and serializes a profile", async () => {
    const { repository, profile } = fixture(null);
    const result = await repository.upsert({
      sex: "female",
      dateOfBirth: "1992-01-10",
      heightCm: 168.5,
      targetWeightKg: null,
      targetDate: null,
    });

    expect(profile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      create: expect.objectContaining({ id: 1, sex: "female", targetWeightKg: null, targetDate: null }),
    }));
    expect(result).toMatchObject({ id: 1, sex: "female", heightCm: 168.5, targetWeightKg: null });
  });

  it("updates and persists the same singleton without creating duplicates", async () => {
    const { repository, profile } = fixture();
    await repository.upsert({
      sex: "female",
      dateOfBirth: "1991-02-03",
      heightCm: 172,
      targetWeightKg: 70.5,
      targetDate: "2027-01-01",
    });
    const persisted = await repository.get();

    expect(profile.upsert).toHaveBeenCalledTimes(1);
    expect(profile.upsert.mock.calls[0]?.[0].where).toEqual({ id: 1 });
    expect(persisted).toMatchObject({ id: 1, sex: "female", heightCm: 172, targetWeightKg: 70.5 });
  });
});
