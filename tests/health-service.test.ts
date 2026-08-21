import { describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import { checkHealth } from "@/modules/health/service";

describe("health service", () => {
  it("reports a successful database query", async () => {
    queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);
    await expect(checkHealth()).resolves.toEqual({ status: "ok", database: "connected" });
  });

  it("converts database errors into a safe status", async () => {
    queryRaw.mockRejectedValueOnce(new Error("password=do-not-leak"));
    await expect(checkHealth()).resolves.toEqual({ status: "error", database: "unavailable" });
  });
});
