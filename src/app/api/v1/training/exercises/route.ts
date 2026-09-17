import { validationResponse } from "@/modules/days/day.http";
import { CatalogListQuerySchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const query = CatalogListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationResponse(query.error);

  try {
    const exercises = await trainingService.listCatalog({
      includeInactive: query.data.includeInactive,
    });
    return Response.json({ exercises });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
