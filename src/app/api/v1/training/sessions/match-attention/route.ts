import { trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const sessions = await trainingService.listMatchAttention();
    return Response.json({ sessions });
  } catch {
    return trainingInternalError();
  }
}
