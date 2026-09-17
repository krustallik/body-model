import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const sessions = await trainingService.listMatchAttention();
    return Response.json({ sessions });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
