import { getSessionPrincipal } from "@/modules/auth/access";

import { validationResponse } from "@/modules/days/day.http";
import { CatalogListQuerySchema } from "@/modules/training/training.schema";
import { trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const query = CatalogListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationResponse(query.error);

  try {
    const exercises = await trainingService.listCatalog({
      profileId: principal.profileId,
      includeInactive: query.data.includeInactive,
    });
    return Response.json({ exercises });
  } catch {
    return trainingInternalError();
  }
}
