import { getIP } from "better-auth/api";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { auth, trustedOrigins } from "@/lib/auth";
import { consumeApplicationAuthLimit } from "./rate-limit";
import { resolveProfileApiKey } from "./api-keys";
import { isValidApiKey } from "@/modules/health/auth";

export type ProfilePrincipal = Readonly<{
  profileId: number;
  userId: string | null;
  method: "session" | "api-key" | "legacy-shortcut";
  apiKeyId?: string;
}>;

export type AuthenticatedUser = Readonly<{
  userId: string;
  email: string;
  profileId: number;
  passwordChangeRequired: boolean;
}>;

export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return trustedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function originRejected(): Response {
  return Response.json({ error: "origin_not_allowed" }, { status: 403 });
}

function requestIp(request: Request): string {
  return getIP(request, auth.options) ?? "unresolved-client";
}

export async function enforceAuthRequestLimit(
  request: Request,
  action: string,
  input: { email?: string; emailPerIp?: boolean; ipWindowSeconds?: number; ipMax?: number; emailWindowSeconds?: number; emailMax?: number } = {},
): Promise<Response | null> {
  const ip = requestIp(request);
  const ipResult = await consumeApplicationAuthLimit(
    `bodycast:${action}:ip:${ip}`,
    input.ipWindowSeconds ?? 60,
    input.ipMax ?? 10,
  );
  if (!ipResult.allowed) {
    return Response.json({ error: "rate_limited" }, {
      status: 429,
      headers: { "retry-after": String(ipResult.retryAfter ?? 60) },
    });
  }
  if (input.email) {
    const email = input.email.trim().toLowerCase();
    const result = await consumeApplicationAuthLimit(
      `bodycast:${action}:email:${email}${input.emailPerIp ? `:ip:${ip}` : ""}`,
      input.emailWindowSeconds ?? 900,
      input.emailMax ?? 5,
    );
    if (!result.allowed) {
      return Response.json({ error: "rate_limited" }, {
        status: 429,
        headers: { "retry-after": String(result.retryAfter ?? 900) },
      });
    }
  }
  return null;
}

export async function getAuthenticatedUser(headers: globalThis.Headers): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user.emailVerified) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      passwordChangeRequired: true,
      profile: { select: { id: true } },
    },
  });
  if (!user?.emailVerified || !user.profile) return null;
  return {
    userId: user.id,
    email: user.email,
    profileId: user.profile.id,
    passwordChangeRequired: user.passwordChangeRequired,
  };
}

export async function getProfilePrincipal(request: Request): Promise<ProfilePrincipal | null> {
  const providedKey = request.headers.get("x-api-key");
  if (providedKey !== null) {
    const personal = await resolveProfileApiKey(providedKey);
    if (personal) return personal;
    const env = getEnv();
    if (env.LEGACY_IOS_SHORTCUT_ENABLED === "true"
      && env.IOS_SHORTCUT_API_KEY
      && isValidApiKey(providedKey, env.IOS_SHORTCUT_API_KEY)) {
      return { profileId: 1, userId: null, method: "legacy-shortcut" };
    }
    return null;
  }
  if (isStateChangingMethod(request.method) && !isTrustedOrigin(request)) return null;
  const user = await getAuthenticatedUser(request.headers);
  if (!user || user.passwordChangeRequired) return null;
  return { profileId: user.profileId, userId: user.userId, method: "session" };
}

export async function getSessionPrincipal(request: Request): Promise<ProfilePrincipal | null> {
  if (isStateChangingMethod(request.method) && !isTrustedOrigin(request)) return null;
  const user = await getAuthenticatedUser(request.headers);
  if (!user || user.passwordChangeRequired) return null;
  return { profileId: user.profileId, userId: user.userId, method: "session" };
}

function isStateChangingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export async function getPageUser(headers: globalThis.Headers): Promise<AuthenticatedUser | null> {
  return getAuthenticatedUser(headers);
}

export function configuredAuthEmailLimit(): number {
  return getEnv().AUTH_EMAIL_DAILY_LIMIT;
}
