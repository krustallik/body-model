import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ProfileRepository } from "@/modules/profile/profile.repository";

const createdAt = new Date("2026-08-22T10:00:00Z");

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    locale: "uk",
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
    findUnique: vi.fn(async ({ where }: { where: { id: number } }) => stored?.id === where.id ? stored : null),
    update: vi.fn(async ({ where, data }: {
      where: { id: number };
      data: Record<string, unknown>;
    }) => {
      if (!stored || stored.id !== where.id) throw new Error("profile not found");
      const base = stored;
      stored = record({
        ...base,
        ...data,
        heightCm: new Prisma.Decimal(String(data.heightCm)),
        targetWeightKg: data.targetWeightKg === undefined
          ? base.targetWeightKg
          : data.targetWeightKg === null
            ? null
            : new Prisma.Decimal(String(data.targetWeightKg)),
        targetDate: data.targetDate === undefined ? base.targetDate : data.targetDate,
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
    await expect(repository.get(1)).resolves.toBeNull();
  });

  it("updates the authenticated profile and serializes it", async () => {
    const { repository, profile } = fixture();
    const result = await repository.update(1, {
      locale: "uk",
      sex: "female",
      dateOfBirth: "1992-01-10",
      heightCm: 168.5,
    });

    expect(profile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ locale: "uk", sex: "female", heightCm: 168.5 }),
    }));
    expect(result).toMatchObject({ id: 1, locale: "uk", sex: "female", heightCm: 168.5, targetWeightKg: 81.4 });
  });

  it("updates only the requested profile", async () => {
    const { repository, profile } = fixture(record({ id: 7 }));
    await repository.update(7, {
      locale: "en",
      sex: "female",
      dateOfBirth: "1991-02-03",
      heightCm: 172,
      targetWeightKg: 70.5,
      targetDate: "2027-01-01",
    });
    const persisted = await repository.get(7);

    expect(profile.update).toHaveBeenCalledTimes(1);
    expect(profile.update.mock.calls[0]?.[0].where).toEqual({ id: 7 });
    expect(persisted).toMatchObject({ id: 7, locale: "en", sex: "female", heightCm: 172, targetWeightKg: 70.5 });
  });

  it("preserves legacy goal columns when a profile-only write omits them", async () => {
    const { repository, profile } = fixture();
    await repository.update(1, {
      locale: "en",
      sex: "female",
      dateOfBirth: "1991-02-03",
      heightCm: 172,
    });

    expect(profile.update).toHaveBeenCalledTimes(1);
    const update = profile.update.mock.calls[0]?.[0].data;
    expect(update).not.toHaveProperty("targetWeightKg");
    expect(update).not.toHaveProperty("targetDate");
    await expect(repository.get(1)).resolves.toMatchObject({
      targetWeightKg: 81.4,
      targetDate: "2027-06-01",
      heightCm: 172,
    });
  });
});
