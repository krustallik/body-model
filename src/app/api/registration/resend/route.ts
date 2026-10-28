import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { enforceAuthRequestLimit, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { prisma } from "@/lib/db/prisma";
import { runAuthEmailFlow } from "@/modules/auth/email-flow";
import { readAuthJson } from "@/modules/auth/http";

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(120).optional(),
}).strict();

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const ipLimit = await enforceAuthRequestLimit(request, "registration-resend", { ipMax: 10 });
  if (ipLimit) return ipLimit;
  const env = getEnv();
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const ownerEmail = env.AUTH_PROFILE_ONE_OWNER_EMAIL?.trim().toLowerCase();
  const isProfileOneOwner = ownerEmail !== undefined && email === ownerEmail;
  const isProfileOneBootstrap = env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED === "true" && isProfileOneOwner;
  if (env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED === "true" && !isProfileOneBootstrap) {
    return Response.json({ requestReceived: true }, { status: 202 });
  }
  if (env.AUTH_PUBLIC_REGISTRATION_ENABLED !== "true" && !isProfileOneBootstrap) {
    return Response.json({ error: "registration_not_enabled" }, { status: 503 });
  }
  if (isProfileOneOwner && !isProfileOneBootstrap) {
    return Response.json({ requestReceived: true }, { status: 202 });
  }
  const emailLimit = await enforceAuthRequestLimit(request, "registration-resend", { email, ipMax: 100 });
  if (emailLimit) return emailLimit;
  await runAuthEmailFlow("registration-resend", async () => {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { emailVerified: true, profile: { select: { id: true } } },
    });
    if (!user && parsed.data.name) {
      await auth.api.signUpEmail({
        headers: request.headers,
        body: {
          email,
          name: parsed.data.name,
          password: randomBytes(32).toString("base64url"),
        },
      });
    } else if (user && (!user.emailVerified || !user.profile)) {
      await auth.api.sendVerificationOTP({
        headers: request.headers,
        body: { email, type: "email-verification" },
      });
    }
  });
  return Response.json({ requestReceived: true }, { status: 202 });
}
