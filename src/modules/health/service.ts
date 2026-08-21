import { prisma } from "@/lib/db/prisma";

export type HealthResult =
  | { status: "ok"; database: "connected" }
  | { status: "error"; database: "unavailable" };

export async function checkHealth(): Promise<HealthResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "connected" };
  } catch {
    return { status: "error", database: "unavailable" };
  }
}
