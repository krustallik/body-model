import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { enforceAuthRequestLimit, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { runAuthEmailFlow } from "@/modules/auth/email-flow";
import { reservePublicOtpEmailQuota } from "@/modules/auth/email-quota";
import { readAuthJson } from "@/modules/auth/http";
import { createPendingRegistrationUser, removePendingRegistrationCredential } from "@/modules/auth/registration-users";

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(120),
}).strict();

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const ipLimit = await enforceAuthRequestLimit(request, "registration-start", { ipMax: 10 });
  if (ipLimit) return ipLimit;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const env = getEnv();
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
    // Never create an ordinary Profile for the reserved legacy owner address.
    return Response.json({ requestReceived: true }, { status: 202 });
  }
  const emailLimit = await enforceAuthRequestLimit(request, "registration-start", { email, ipMax: 100 });
  if (emailLimit) return emailLimit;
  await runAuthEmailFlow("registration-start", async () => {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true, profile: { select: { id: true } } },
    });
    if (!existing) {
      if (env.AUTH_PUBLIC_REGISTRATION_ENABLED === "true" && !isProfileOneBootstrap) {
        await reservePublicOtpEmailQuota();
      }
      if (isProfileOneBootstrap) {
        // Profile 1 remains on its separately authorized temporary-password flow.
        await auth.api.signUpEmail({
          headers: request.headers,
          body: {
            email,
            name: parsed.data.name,
            password: randomBytes(32).toString("base64url"),
          },
        });
      } else {
        await createPendingRegistrationUser(email, parsed.data.name);
        await auth.api.sendVerificationOTP({
          headers: request.headers,
          body: { email, type: "email-verification" },
        });
      }
    } else if (!existing.emailVerified || !existing.profile) {
      if (env.AUTH_PUBLIC_REGISTRATION_ENABLED === "true" && !isProfileOneBootstrap) {
        await reservePublicOtpEmailQuota();
      }
      if (!isProfileOneBootstrap && !existing.profile) {
        // The previous pending flow created an unknown random credential.
        // It is safe to remove only while no Profile has been provisioned.
        await removePendingRegistrationCredential(existing.id);
      }
      // If verification succeeded but Profile provisioning failed, require a
      // fresh proof of mailbox control before retrying the idempotent upsert.
      // The verification callback is the only public retry path.
      await auth.api.sendVerificationOTP({
        headers: request.headers,
        body: { email, type: "email-verification" },
      });
    }
  });
  return Response.json({ requestReceived: true }, { status: 202 });
}
