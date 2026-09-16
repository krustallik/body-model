import { checkHealth } from "@/modules/health/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(checkHealth(), { status: 200 });
}
