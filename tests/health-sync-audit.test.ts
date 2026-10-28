import { describe, expect, it, vi } from "vitest";

const { create, queryRaw, transaction } = vi.hoisted(() => {
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    void strings;
    void values;
    return [];
  });
  return {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    queryRaw,
    transaction: vi.fn(async (
      work: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
      options: unknown,
    ) => {
      void options;
      return work({ $queryRaw: queryRaw });
    }),
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: transaction, healthSyncAudit: { create } } }));

import { pruneExpiredHealthSyncAudits, recordHealthSyncAudit } from "@/modules/health/health-sync-audit";

describe("health sync audit retention", () => {
  it("stores every supplied raw body without running retention cleanup on the request path", async () => {
    const receivedAt = new Date("2026-09-19T12:00:00.000Z");
    await recordHealthSyncAudit({
      outcome: "validation-error",
      httpStatus: 400,
      rawBody: "{broken",
      contentType: "application/json",
      errorType: "ZodError",
      receivedAt,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        profileId: null,
        outcome: "validation-error",
        httpStatus: 400,
        rawBody: "{broken",
        contentType: "application/json",
        errorType: "ZodError",
        receivedAt,
      },
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("runs the 30-day retention cutoff in a bounded periodic-cleanup transaction", async () => {
    const referenceDate = new Date("2026-09-19T12:00:00.000Z");
    await expect(pruneExpiredHealthSyncAudits(referenceDate)).resolves.toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]?.[0].join(" ")).toContain('DELETE FROM public."HealthSyncAudit"');
    expect(queryRaw.mock.calls[0]?.[1]).toEqual(new Date("2026-08-20T12:00:00.000Z"));
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      maxWait: 10_000,
      timeout: 120_000,
    }));
  });
});
