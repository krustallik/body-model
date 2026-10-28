import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { enforceAuthRequestLimit, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readAuthJson } from "@/modules/auth/http";

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
}).strict();

export const dynamic = "force-dynamic";

function invalidCredentialsResponse(source?: Response): Response {
  const headers = new Headers();
  if (source) {
    for (const [name, value] of source.headers) {
      const normalizedName = name.toLowerCase();
      if (normalizedName === "retry-after" || normalizedName.startsWith("x-ratelimit-")) {
        headers.set(name, value);
      }
    }
  }
  return Response.json({ error: "invalid_credentials" }, { status: 400, headers });
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const ipLimit = await enforceAuthRequestLimit(request, "password-login", { ipMax: 20 });
  if (ipLimit) return ipLimit;
  const json = await readAuthJson(request);
  if (json instanceof Response) return json;
  const body = bodySchema.safeParse(json);
  if (!body.success) return invalidCredentialsResponse();
  const email = body.data.email.toLowerCase();
  const emailLimit = await enforceAuthRequestLimit(request, "password-login", {
    email, emailPerIp: true, ipMax: 100, emailWindowSeconds: 900, emailMax: 10,
  });
  if (emailLimit) return emailLimit;
  const account = await prisma.user.findUnique({
    where: { email },
    select: { emailVerified: true, profile: { select: { id: true } } },
  });
  if (!account?.emailVerified || !account.profile) {
    // Match Better Auth's unknown-user password-hash work without allowing a
    // verified-but-unprovisioned account to receive an unusable session.
    await hashPassword(body.data.password);
    return invalidCredentialsResponse();
  }
  try {
    const response = await auth.api.signInEmail({
      headers: request.headers,
      body: { email, password: body.data.password },
      asResponse: true,
    });
    if (response.status === 401 || response.status === 403) {
      return invalidCredentialsResponse(response);
    }
    return response;
  } catch {
    return invalidCredentialsResponse();
  }
}
