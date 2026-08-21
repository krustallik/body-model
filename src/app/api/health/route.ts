import { checkHealth } from "@/modules/health/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const health = await checkHealth();
  return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
}
