import { getSessionPrincipal } from "@/modules/auth/access";
import { trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const session = await trainingService.getActiveSession(principal.profileId);
    return Response.json({ session });
  } catch {
    return trainingInternalError();
  }
}
