import { z } from "zod";
import { auth } from "@/lib/auth";
import { enforceAuthRequestLimit, getAuthenticatedUser, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readAuthJson } from "@/modules/auth/http";

const bodySchema = z.object({ password: z.string().min(12).max(128) }).strict();

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) return originRejected();
  const ipLimit = await enforceAuthRequestLimit(request, "registration-password-setup", { ipMax: 10 });
  if (ipLimit) return ipLimit;

  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });

  const user = await getAuthenticatedUser(request.headers);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const emailLimit = await enforceAuthRequestLimit(request, "registration-password-setup", {
    email: user.email,
    emailMax: 5,
    ipMax: 100,
  });
  if (emailLimit) return emailLimit;
  if (user.passwordChangeRequired) {
    return Response.json({ error: "password_setup_unavailable" }, { status: 409 });
  }

  try {
    // Better Auth only sets a password for an authenticated user without an existing credential.
    await auth.api.setPassword({
      headers: request.headers,
      body: { newPassword: parsed.data.password },
    });
    return Response.json({ completed: true }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "password_setup_unavailable" }, {
      status: 409,
      headers: { "cache-control": "no-store" },
    });
  }
}
