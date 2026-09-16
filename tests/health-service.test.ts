import { describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import { checkHealth, checkReadiness } from "@/modules/health/service";

describe("health service", () => {
  it("reports process liveness without a database query", () => {
    expect(checkHealth()).toEqual({ status: "ok" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reports a successful database query", async () => {
    queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);
    await expect(checkReadiness()).resolves.toEqual({ status: "ok", database: "connected" });
  });

  it("converts database errors into a safe status", async () => {
    queryRaw.mockRejectedValueOnce(new Error("password=do-not-leak"));
    await expect(checkReadiness()).resolves.toEqual({ status: "error", database: "unavailable" });
  });
});
