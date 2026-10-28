import { readJson, validationResponse } from "@/modules/days/day.http";
import { profileRepository } from "@/modules/profile/profile.repository";
import { ProfileInputSchema } from "@/modules/profile/profile.schema";
import { isLocalDemoMode, localDemoReadOnlyResponse } from "@/modules/demo/local-demo-mode";
import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (isLocalDemoMode()) return Response.json({ profile: null });
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json({ profile: await profileRepository.get(principal.profileId) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (isLocalDemoMode()) return localDemoReadOnlyResponse();
  if (!isTrustedOrigin(request)) return originRejected();
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = ProfileInputSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    return Response.json({ profile: await profileRepository.update(principal.profileId, parsed.data) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
