import { trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const session = await trainingService.getActiveSession();
    return Response.json({ session });
  } catch {
    return trainingInternalError();
  }
}
