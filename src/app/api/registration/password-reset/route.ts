import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { enforceAuthRequestLimit, getAuthenticatedUser, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readAuthJson } from "@/modules/auth/http";

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  otp: z.string().length(6),
  password: z.string().min(12).max(128),
}).strict();

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const ipLimit = await enforceAuthRequestLimit(request, "password-reset-confirm", { ipMax: 10 });
  if (ipLimit) return ipLimit;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const emailLimit = await enforceAuthRequestLimit(request, "password-reset-confirm", { email, ipMax: 100 });
  if (emailLimit) return emailLimit;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true, profile: { select: { id: true } } },
  });
  if (!user?.emailVerified || !user.profile) {
    return Response.json({ error: "invalid_code_or_account" }, { status: 400 });
  }
  const currentUser = await getAuthenticatedUser(request.headers);
  try {
    await auth.api.resetPasswordEmailOTP({
      headers: request.headers,
      body: { email, otp: parsed.data.otp, password: parsed.data.password },
    });
    const headers = new Headers({ "cache-control": "no-store" });
    if (currentUser?.userId === user.id) {
      const signOut = await auth.api.signOut({ headers: request.headers, body: {}, asResponse: true });
      const cookie = signOut.headers.get("set-cookie");
      if (cookie) headers.set("set-cookie", cookie);
    }
    return Response.json({ changed: true }, { headers });
  } catch {
    return Response.json({ error: "invalid_code_or_account" }, { status: 400 });
  }
}
