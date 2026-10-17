import { describe, expect, it, vi } from "vitest";

const { create, deleteMany } = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: 1 }),
  deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: { healthSyncAudit: { create, deleteMany } } }));

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
        outcome: "validation-error",
        httpStatus: 400,
        rawBody: "{broken",
        contentType: "application/json",
        errorType: "ZodError",
        receivedAt,
      },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("removes audits older than 30 days during periodic maintenance", async () => {
    const referenceDate = new Date("2026-09-19T12:00:00.000Z");
    await expect(pruneExpiredHealthSyncAudits(referenceDate)).resolves.toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: new Date("2026-08-20T12:00:00.000Z") } },
    });
  });
});
