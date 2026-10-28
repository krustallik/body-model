import { z } from "zod";
import { auth } from "@/lib/auth";
import { enforceAuthRequestLimit, getAuthenticatedUser, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { prisma } from "@/lib/db/prisma";
import { readAuthJson } from "@/modules/auth/http";

const bodySchema = z.object({ otp: z.string().length(6), password: z.string().min(12).max(128) }).strict();

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const user = await getAuthenticatedUser(request.headers);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const limited = await enforceAuthRequestLimit(request, "password-change-confirm", { email: user.email, ipMax: 6 });
  if (limited) return limited;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const account = await prisma.user.findUnique({ where: { id: user.userId }, select: { emailVerified: true, profile: { select: { id: true } } } });
  if (!account?.emailVerified || !account.profile) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await auth.api.resetPasswordEmailOTP({
      headers: request.headers,
      body: { email: user.email, otp: parsed.data.otp, password: parsed.data.password },
    });
    const signOut = await auth.api.signOut({ headers: request.headers, body: {}, asResponse: true });
    return signOut;
  } catch {
    return Response.json({ error: "invalid_code_or_account" }, { status: 400 });
  }
}
