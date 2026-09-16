import { checkReadiness } from "@/modules/health/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const readiness = await checkReadiness();
  return Response.json(readiness, { status: readiness.status === "ok" ? 200 : 503 });
}
