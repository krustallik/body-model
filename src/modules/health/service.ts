import { prisma } from "@/lib/db/prisma";
import { logEvent } from "@/lib/logger";

export type HealthResult =
  | { status: "ok"; database: "connected" }
  | { status: "error"; database: "unavailable" };

export function checkHealth(): { status: "ok" } {
  return { status: "ok" };
}

export async function checkReadiness(): Promise<HealthResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "connected" };
  } catch {
    logEvent("error", "database_readiness_failed");
    return { status: "error", database: "unavailable" };
  }
}
