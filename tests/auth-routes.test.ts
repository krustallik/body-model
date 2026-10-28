import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  authApi: {
    signInEmail: vi.fn(),
    signUpEmail: vi.fn(),
    sendVerificationOTP: vi.fn(),
    requestPasswordResetEmailOTP: vi.fn(),
    createVerificationOTP: vi.fn(),
    resetPasswordEmailOTP: vi.fn(),
    signOut: vi.fn(),
  },
  forwardAuthRequest: vi.fn(),
  hashPassword: vi.fn(),
  getEnv: vi.fn(),
  emailFlow: vi.fn(),
  sendEmail: vi.fn(),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  access: {
    isTrustedOrigin: vi.fn(),
    originRejected: vi.fn(),
    enforceAuthRequestLimit: vi.fn(),
    getAuthenticatedUser: vi.fn(),
    getSessionPrincipal: vi.fn(),
  },
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: { api: routeMocks.authApi } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: routeMocks.prisma }));
vi.mock("@/lib/env", () => ({ getEnv: routeMocks.getEnv }));
vi.mock("@/modules/auth/access", () => routeMocks.access);
vi.mock("@/modules/auth/email-flow", () => ({ runAuthEmailFlow: routeMocks.emailFlow }));
vi.mock("@/modules/auth/email", () => ({ sendAuthEmail: routeMocks.sendEmail }));
vi.mock("@/modules/auth/api-keys", () => ({
  createProfileApiKey: routeMocks.createApiKey,
  listProfileApiKeys: routeMocks.listApiKeys,
  rotateProfileApiKey: routeMocks.rotateApiKey,
  revokeProfileApiKey: routeMocks.revokeApiKey,
}));
vi.mock("better-auth/crypto", () => ({ hashPassword: routeMocks.hashPassword }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: vi.fn(), POST: routeMocks.forwardAuthRequest }),
}));

import { POST as login } from "@/app/api/account/login/route";
import { POST as requestPasswordChange } from "@/app/api/account/password-change/request/route";
import { POST as authPost } from "@/app/api/auth/[...all]/route";
import { POST as requestPasswordReset } from "@/app/api/registration/password-reset/request/route";
import { POST as startRegistration } from "@/app/api/registration/start/route";
import { GET as listApiKeys, POST as createApiKey } from "@/app/api/v1/profile/api-keys/route";

const publicAuthEnv = {
  AUTH_PROFILE_ONE_OWNER_EMAIL: "owner@example.invalid",
  AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED: "false",
  AUTH_PUBLIC_REGISTRATION_ENABLED: "true",
};

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("authentication route security boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.access.isTrustedOrigin.mockReturnValue(true);
    routeMocks.access.originRejected.mockReturnValue(Response.json({ error: "origin_rejected" }, { status: 403 }));
    routeMocks.access.enforceAuthRequestLimit.mockResolvedValue(null);
    routeMocks.access.getAuthenticatedUser.mockResolvedValue(null);
    routeMocks.access.getSessionPrincipal.mockResolvedValue(null);
    routeMocks.authApi.signInEmail.mockResolvedValue(Response.json({ token: "session" }));
    routeMocks.authApi.signUpEmail.mockResolvedValue(undefined);
    routeMocks.authApi.sendVerificationOTP.mockResolvedValue(undefined);
    routeMocks.authApi.requestPasswordResetEmailOTP.mockResolvedValue(undefined);
    routeMocks.authApi.createVerificationOTP.mockResolvedValue("654321");
    routeMocks.authApi.resetPasswordEmailOTP.mockResolvedValue(undefined);
    routeMocks.authApi.signOut.mockResolvedValue(new Response(null, { status: 200 }));
    routeMocks.forwardAuthRequest.mockResolvedValue(Response.json({ ok: true }));
    routeMocks.hashPassword.mockResolvedValue("dummy-hash");
    routeMocks.getEnv.mockReturnValue(publicAuthEnv);
    routeMocks.emailFlow.mockImplementation(async (_purpose: string, run: () => Promise<unknown>) => run());
    routeMocks.sendEmail.mockResolvedValue(undefined);
    routeMocks.createApiKey.mockResolvedValue({ id: "key-1", token: "secret-once" });
    routeMocks.listApiKeys.mockResolvedValue([]);
    routeMocks.rotateApiKey.mockResolvedValue(null);
    routeMocks.revokeApiKey.mockResolvedValue(false);
    routeMocks.prisma.user.findUnique.mockResolvedValue(null);
  });

  it("rejects unverified login without calling Better Auth and normalizes verified login", async () => {
    routeMocks.prisma.user.findUnique.mockResolvedValueOnce({ emailVerified: false, profile: null });
    const unverified = await login(post("/api/account/login", {
      email: "  person@example.invalid ", password: "temporary-password",
    }));

    expect(unverified.status).toBe(400);
    expect(await unverified.json()).toEqual({ error: "invalid_credentials" });
    expect(routeMocks.hashPassword).toHaveBeenCalledWith("temporary-password");
    expect(routeMocks.authApi.signInEmail).not.toHaveBeenCalled();

    routeMocks.prisma.user.findUnique.mockResolvedValueOnce({ emailVerified: true, profile: { id: 23 } });
    const verified = await login(post("/api/account/login", {
      email: " Person@Example.Invalid ", password: "correct-password",
    }));

    expect(verified.status).toBe(200);
    expect(routeMocks.authApi.signInEmail).toHaveBeenCalledWith(expect.objectContaining({
      body: { email: "person@example.invalid", password: "correct-password" },
      asResponse: true,
    }));
  });

  it("starts registration with a server-generated password and re-proves pending registrations", async () => {
    const created = await startRegistration(post("/api/registration/start", {
      email: " New.User@Example.Invalid ", name: "New User",
    }));

    expect(created.status).toBe(202);
    expect(await created.json()).toEqual({ requestReceived: true });
    expect(routeMocks.authApi.signUpEmail).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ email: "new.user@example.invalid", name: "New User" }),
    }));
    expect(routeMocks.authApi.signUpEmail.mock.calls[0]?.[0].body.password).not.toBe("New User");

    routeMocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: "pending-1", emailVerified: false, profile: null,
    });
    const retried = await startRegistration(post("/api/registration/start", {
      email: "new.user@example.invalid", name: "Ignored replacement name",
    }));

    expect(retried.status).toBe(202);
    expect(routeMocks.authApi.sendVerificationOTP).toHaveBeenCalledWith(expect.objectContaining({
      body: { email: "new.user@example.invalid", type: "email-verification" },
    }));
    expect(routeMocks.authApi.signUpEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps password-reset requests enumeration-safe", async () => {
    const unknown = await requestPasswordReset(post("/api/registration/password-reset/request", {
      email: "missing@example.invalid",
    }));
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toEqual({ requestReceived: true });
    expect(routeMocks.authApi.requestPasswordResetEmailOTP).not.toHaveBeenCalled();

    routeMocks.prisma.user.findUnique.mockResolvedValueOnce({
      emailVerified: true, profile: { id: 23 },
    });
    const known = await requestPasswordReset(post("/api/registration/password-reset/request", {
      email: " PERSON@EXAMPLE.INVALID ",
    }));
    expect(known.status).toBe(202);
    expect(await known.json()).toEqual({ requestReceived: true });
    expect(routeMocks.authApi.requestPasswordResetEmailOTP).toHaveBeenCalledWith({
      headers: expect.any(Headers), body: { email: "person@example.invalid" },
    });
  });

  it("requires an authenticated, provisioned profile for OTP password change", async () => {
    const anonymous = await requestPasswordChange(post("/api/account/password-change/request", {}));
    expect(anonymous.status).toBe(401);
    expect(routeMocks.authApi.createVerificationOTP).not.toHaveBeenCalled();

    routeMocks.access.getAuthenticatedUser.mockResolvedValueOnce({
      userId: "user-23", profileId: 23, email: "person@example.invalid", passwordChangeRequired: false,
    });
    routeMocks.prisma.user.findUnique.mockResolvedValueOnce({ emailVerified: true, profile: { id: 23 } });
    const accepted = await requestPasswordChange(post("/api/account/password-change/request", {}));

    expect(accepted.status).toBe(202);
    expect(routeMocks.authApi.createVerificationOTP).toHaveBeenCalledWith(expect.objectContaining({
      body: { email: "person@example.invalid", type: "forget-password" },
    }));
    expect(routeMocks.sendEmail).toHaveBeenCalledWith({
      email: "person@example.invalid", code: "654321", purpose: "change",
    });
  });

  it("keeps Better Auth forwarding request-size bounded", async () => {
    const accepted = await authPost(post("/api/auth/sign-in/email", { email: "person@example.invalid" }));
    expect(accepted.status).toBe(200);
    expect(routeMocks.forwardAuthRequest).toHaveBeenCalledTimes(1);
    const forwardedRequest = routeMocks.forwardAuthRequest.mock.calls[0]?.[0] as Request;
    expect(forwardedRequest.headers.has("content-length")).toBe(false);
    expect(await forwardedRequest.json()).toEqual({ email: "person@example.invalid" });

    const oversized = await authPost(new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(17 * 1024),
    }));
    expect(oversized.status).toBe(413);
    expect(routeMocks.forwardAuthRequest).toHaveBeenCalledTimes(1);
  });

  it("derives API-key scope from the authenticated profile and rejects caller-supplied scope", async () => {
    routeMocks.access.getSessionPrincipal.mockResolvedValue({ profileId: 23, userId: "user-23", method: "session" });
    routeMocks.listApiKeys.mockResolvedValue([{ id: "key-1", name: "Laptop" }]);
    const listed = await listApiKeys(new Request("http://localhost/api/v1/profile/api-keys"));
    expect(listed.status).toBe(200);
    expect(routeMocks.listApiKeys).toHaveBeenCalledWith(23);
    expect(listed.headers.get("cache-control")).toBe("no-store");

    const spoofed = await createApiKey(post("/api/v1/profile/api-keys", { name: "Other profile", profileId: 1 }));
    expect(spoofed.status).toBe(400);
    expect(routeMocks.createApiKey).not.toHaveBeenCalled();

    const created = await createApiKey(post("/api/v1/profile/api-keys", { name: "Personal laptop" }));
    expect(created.status).toBe(201);
    expect(routeMocks.createApiKey).toHaveBeenCalledWith(23, "Personal laptop");
  });
});
