import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { WorkIntervalOverlapError } from "@/modules/work-intervals/work-interval.errors";
import { WorkIntervalRepository } from "@/modules/work-intervals/work-interval.repository";

const record = {
  id: 1,
  date: "2026-08-23",
  startAt: new Date("2026-08-23T06:00:00Z"),
  endAt: new Date("2026-08-23T14:00:00Z"),
  timezone: "Europe/Bratislava",
  category: "standingLight",
  breakMinutes: 30,
  createdAt: new Date("2026-08-22T12:00:00Z"),
  updatedAt: new Date("2026-08-22T12:00:00Z"),
};
const input = {
  date: "2026-08-23",
  startTime: "08:00",
  endTime: "16:00",
  timezone: "Europe/Bratislava",
  category: "standingLight" as const,
  breakMinutes: 30,
};

function fixture(options: { overlap?: boolean; existing?: boolean } = {}) {
  const transaction = {
    workInterval: {
      findFirst: vi.fn().mockResolvedValue(options.overlap ? { id: 99 } : null),
      findUnique: vi.fn().mockResolvedValue(options.existing === false ? null : record),
      create: vi.fn().mockResolvedValue(record),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...record, ...data })),
    },
  };
  const client = {
    workInterval: {
      findMany: vi.fn().mockResolvedValue([record]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
  return { repository: new WorkIntervalRepository(client), client, transaction };
}

describe("work interval repository", () => {
  it("lists deterministically and maps UTC instants back to Košice local time", async () => {
    const { repository, client } = fixture();
    await expect(repository.list("2026-08-23")).resolves.toEqual([expect.objectContaining({
      id: 1,
      startTime: "08:00",
      endTime: "16:00",
      startAt: "2026-08-23T06:00:00.000Z",
      breakMinutes: 30,
      breakSource: "user-entered",
    })]);
    expect(client.workInterval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: "2026-08-23" },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    }));
    await repository.list();
    expect(client.workInterval.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: undefined }));
  });

  it("creates resolved UTC instants after checking overlap", async () => {
    const { repository, transaction } = fixture();
    await expect(repository.create(input)).resolves.toMatchObject({ id: 1 });
    expect(transaction.workInterval.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        startAt: { lt: new Date("2026-08-23T14:00:00Z") },
        endAt: { gt: new Date("2026-08-23T06:00:00Z") },
      }),
    }));
    expect(transaction.workInterval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ breakMinutes: 30 }),
    }));
  });

  it("rejects overlap before mutation", async () => {
    const { repository, transaction } = fixture({ overlap: true });
    await expect(repository.create(input)).rejects.toThrow(WorkIntervalOverlapError);
    expect(transaction.workInterval.create).not.toHaveBeenCalled();
  });

  it("updates a partial interval and excludes itself from overlap detection", async () => {
    const { repository, transaction } = fixture();
    await expect(repository.update(1, { category: "manualLight" })).resolves.toMatchObject({
      category: "manualLight",
    });
    expect(transaction.workInterval.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: 1 } }),
    }));
  });

  it("returns null for nonexistent update and reports delete result", async () => {
    const missing = fixture({ existing: false });
    await expect(missing.repository.update(9, { category: "manualLight" })).resolves.toBeNull();
    await expect(missing.repository.delete(9)).resolves.toBe(true);
  });

  it.each(["P2004", "P2010"])("maps database exclusion error %s to overlap", async (code) => {
    const client = {
      $transaction: vi.fn().mockRejectedValue({ code }),
    } as unknown as PrismaClient;
    await expect(new WorkIntervalRepository(client).create(input))
      .rejects.toThrow(WorkIntervalOverlapError);
  });

  it("maps an update exclusion violation to overlap", async () => {
    const transaction = {
      workInterval: {
        findUnique: vi.fn().mockResolvedValue(record),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockRejectedValue({ code: "P2004" }),
      },
    };
    const client = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaClient;
    await expect(new WorkIntervalRepository(client).update(1, { category: "manualLight" }))
      .rejects.toThrow(WorkIntervalOverlapError);
  });

  it("propagates an unrelated update failure", async () => {
    const transaction = {
      workInterval: {
        findUnique: vi.fn().mockResolvedValue(record),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockRejectedValue(new Error("update failed")),
      },
    };
    const client = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaClient;
    await expect(new WorkIntervalRepository(client).update(1, { category: "manualLight" }))
      .rejects.toThrow("update failed");
  });

  it("propagates unrelated failures", async () => {
    const client = {
      $transaction: vi.fn().mockRejectedValue(new Error("db unavailable")),
    } as unknown as PrismaClient;
    await expect(new WorkIntervalRepository(client).create(input)).rejects.toThrow("db unavailable");
  });
});
