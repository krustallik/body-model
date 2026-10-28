import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { enforceAuthRequestLimit, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { runAuthEmailFlow } from "@/modules/auth/email-flow";
import { readAuthJson } from "@/modules/auth/http";

const bodySchema = z.object({ email: z.string().trim().email().max(320) }).strict();

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const ipLimit = await enforceAuthRequestLimit(request, "password-reset-request", { ipMax: 10 });
  if (ipLimit) return ipLimit;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const emailLimit = await enforceAuthRequestLimit(request, "password-reset-request", { email, ipMax: 100 });
  if (emailLimit) return emailLimit;
  await runAuthEmailFlow("password-reset-request", async () => {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { emailVerified: true, profile: { select: { id: true } } },
    });
    if (user?.emailVerified && user.profile) {
      await auth.api.requestPasswordResetEmailOTP({ headers: request.headers, body: { email } });
    }
  });
  return Response.json({ requestReceived: true }, { status: 202 });
}
