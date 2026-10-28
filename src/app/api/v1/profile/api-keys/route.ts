import { z } from "zod";
import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { createProfileApiKey, listProfileApiKeys, revokeProfileApiKey, rotateProfileApiKey } from "@/modules/auth/api-keys";

const createSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const keyIdSchema = z.string().min(1).max(36);

export const dynamic = "force-dynamic";

async function currentProfile(request: Request): Promise<number | null> {
  const principal = await getSessionPrincipal(request);
  return principal?.profileId ?? null;
}

export async function GET(request: Request): Promise<Response> {
  const profileId = await currentProfile(request);
  if (!profileId) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ keys: await listProfileApiKeys(profileId) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const profileId = await currentProfile(request);
  if (!profileId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  return Response.json({ key: await createProfileApiKey(profileId, body.data.name) }, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const profileId = await currentProfile(request);
  if (!profileId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = z.object({ id: keyIdSchema }).strict().safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const key = await rotateProfileApiKey(profileId, body.data.id);
  return key
    ? Response.json({ key }, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: "not_found" }, { status: 404 });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const profileId = await currentProfile(request);
  if (!profileId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = z.object({ id: keyIdSchema }).strict().safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const revoked = await revokeProfileApiKey(profileId, body.data.id);
  return revoked ? Response.json({ revoked: true }) : Response.json({ error: "not_found" }, { status: 404 });
}
