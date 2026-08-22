import { readJson, validationResponse } from "@/modules/days/day.http";
import { profileRepository } from "@/modules/profile/profile.repository";
import { ProfileInputSchema } from "@/modules/profile/profile.schema";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ profile: await profileRepository.get() });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = ProfileInputSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    return Response.json({ profile: await profileRepository.upsert(parsed.data) });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
