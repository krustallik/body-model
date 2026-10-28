import { auth } from "@/lib/auth";
import { sendAuthEmail } from "@/modules/auth/email";
import { enforceAuthRequestLimit, getAuthenticatedUser, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const user = await getAuthenticatedUser(request.headers);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const limited = await enforceAuthRequestLimit(request, "password-change-request", { email: user.email, ipMax: 6 });
  if (limited) return limited;
  const account = await prisma.user.findUnique({ where: { id: user.userId }, select: { emailVerified: true, profile: { select: { id: true } } } });
  if (!account?.emailVerified || !account.profile) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const otp = await auth.api.createVerificationOTP({
      headers: request.headers,
      body: { email: user.email, type: "forget-password" },
    });
    await sendAuthEmail({ email: user.email, code: otp, purpose: "change" });
    return Response.json({ accepted: true }, { status: 202 });
  } catch {
    return Response.json({ error: "password_change_temporarily_unavailable" }, { status: 503 });
  }
}
