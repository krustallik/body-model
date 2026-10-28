import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";

const databaseUrl = process.env.DATABASE_URL;
requireIsolatedStage01Database(databaseUrl, process.env.BODYCAST_STAGE01_MODE, "test");
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const date = "2040-02-01";
const origin = "http://localhost:3000";
const email = `work-interval-${crypto.randomUUID()}@example.invalid`;
const clientIp = `198.51.100.${1 + (crypto.getRandomValues(new Uint8Array(1))[0]! % 254)}`;
const authEnvironmentKeys = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "AUTH_TRUSTED_ORIGINS",
  "AUTH_TRUSTED_PROXIES",
  "AUTH_PUBLIC_REGISTRATION_ENABLED",
  "AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED",
  "AUTH_EMAIL_DAILY_LIMIT",
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
] as const;
const originalAuthEnvironment: Partial<Record<typeof authEnvironmentKeys[number], string | undefined>> = {};
let otp = "";
let cookie = "";
let userId: string | null = null;
let profileId: number | null = null;
let createInterval: (request: Request) => Promise<Response>;
let listIntervals: (request: Request) => Promise<Response>;
let updateInterval: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let deleteInterval: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { origin, cookie, "content-type": "application/json", "x-forwarded-for": clientIp },
    body: JSON.stringify(body),
  });
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
  return cookies.map((value) => value.split(";")[0]).join("; ");
}

function authRequest(path: string, body: unknown): Request {
  return new Request(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": clientIp },
    body: JSON.stringify(body),
  });
}

const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("work interval CRUD with PostgreSQL", () => {
  beforeAll(async () => {
    for (const key of authEnvironmentKeys) originalAuthEnvironment[key] = process.env[key];
    process.env.BETTER_AUTH_SECRET = "isolated-work-interval-auth-secret-with-32-characters";
    process.env.BETTER_AUTH_URL = origin;
    process.env.AUTH_TRUSTED_ORIGINS = origin;
    process.env.AUTH_TRUSTED_PROXIES = "127.0.0.1/32";
    process.env.AUTH_PUBLIC_REGISTRATION_ENABLED = "true";
    process.env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED = "false";
    process.env.AUTH_EMAIL_DAILY_LIMIT = "1000";
    process.env.BREVO_API_KEY = "isolated-test-provider-key";
    process.env.BREVO_SENDER_EMAIL = "noreply@example.invalid";
    process.env.BREVO_SENDER_NAME = "BodyCast Test";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { textContent?: string };
      otp = payload.textContent?.match(/Код:\s*(\d{6})/)?.[1] ?? "";
      return new Response(JSON.stringify({ messageId: "isolated-provider-accepted" }), { status: 201 });
    }));

    await prisma.$connect();
    const [{ POST: startRegistration }, authHttp, { POST: login }, authModule] = await Promise.all([
      import("@/app/api/registration/start/route"),
      import("@/app/api/auth/[...all]/route"),
      import("@/app/api/account/login/route"),
      import("@/lib/auth"),
    ]);
    const { POST: create, GET: list } = await import("@/app/api/v1/work-intervals/route");
    const { PATCH: update, DELETE: remove } = await import("@/app/api/v1/work-intervals/[id]/route");
    createInterval = create;
    listIntervals = list;
    updateInterval = update;
    deleteInterval = remove;

    const started = await startRegistration(new Request(`${origin}/api/registration/start`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({ email, name: "Work interval integration" }),
    }));
    if (started.status !== 202 || !otp) throw new Error("Isolated registration did not issue its verification OTP");
    const verified = await authHttp.POST(authRequest("/email-otp/verify-email", { email, otp }));
    if (!verified.ok) throw new Error("Isolated registration OTP was not accepted");
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, profile: { select: { id: true } } } });
    userId = user.id;
    profileId = user.profile?.id ?? null;
    if (!profileId) throw new Error("Verified integration user has no Profile");

    await authModule.auth.api.requestPasswordResetEmailOTP({ headers: new Headers({ origin }), body: { email } });
    const password = `Work-interval-${crypto.randomUUID()}-pass`;
    await authModule.auth.api.resetPasswordEmailOTP({ headers: new Headers({ origin }), body: { email, otp, password } });
    const signedIn = await login(new Request(`${origin}/api/account/login`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({ email, password }),
    }));
    if (!signedIn.ok) throw new Error("Verified integration user could not sign in");
    cookie = cookieHeader(signedIn);
    if (!cookie) throw new Error("Verified integration user did not receive a session cookie");
    await prisma.workInterval.deleteMany({ where: { profileId, date } });
  });

  afterAll(async () => {
    try {
      const fixtureUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, profile: { select: { id: true } } },
      });
      const cleanupUserId = userId ?? fixtureUser?.id ?? null;
      const cleanupProfileId = profileId ?? fixtureUser?.profile?.id ?? null;
      if (cleanupProfileId !== null) {
        await prisma.workInterval.deleteMany({ where: { profileId: cleanupProfileId, date } });
        await prisma.profileApiKey.deleteMany({ where: { profileId: cleanupProfileId } });
        await prisma.exerciseCatalog.deleteMany({ where: { profileId: cleanupProfileId } });
        await prisma.profile.updateMany({ where: { id: cleanupProfileId }, data: { userId: null } });
        await prisma.profile.deleteMany({ where: { id: cleanupProfileId } });
      }
      if (cleanupUserId !== null) await prisma.user.deleteMany({ where: { id: cleanupUserId } });
      await prisma.verification.deleteMany({ where: { identifier: { contains: email } } });
    } finally {
      for (const key of authEnvironmentKeys) {
        const value = originalAuthEnvironment[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.unstubAllGlobals();
      await prisma.$disconnect();
    }
  });

  it("creates timezone-aware intervals and prevents overlap", async () => {
    const first = await createInterval(jsonRequest(`${origin}/api/v1/work-intervals`, {
      date, startTime: "08:00", endTime: "12:00", category: "standingLight",
      timezone: "Europe/Bratislava", breakMinutes: 30,
    }));
    expect(first.status).toBe(201);
    const created = (await first.json()).interval;
    expect(created).toMatchObject({
      startTime: "08:00", endTime: "12:00", startAt: "2040-02-01T07:00:00.000Z",
      breakMinutes: 30, breakSource: "user-entered",
    });

    const invalidBreak = await createInterval(jsonRequest(`${origin}/api/v1/work-intervals`, {
      date, startTime: "16:00", endTime: "20:00", category: "standingLight",
      breakMinutes: 240,
    }));
    expect(invalidBreak.status).toBe(400);
    await expect(prisma.workInterval.create({
      data: { profileId: 1,
        date,
        startAt: new Date("2040-02-01T15:00:00.000Z"),
        endAt: new Date("2040-02-01T19:00:00.000Z"),
        timezone: "Europe/Bratislava",
        category: "standingLight",
        breakMinutes: 240,
      },
    })).rejects.toThrow();

    const overlap = await createInterval(jsonRequest(`${origin}/api/v1/work-intervals`, {
      date, startTime: "11:00", endTime: "13:00", category: "manualLight",
      breakMinutes: 0,
    }));
    expect(overlap.status).toBe(409);

    const adjacent = await createInterval(jsonRequest(`${origin}/api/v1/work-intervals`, {
      date, startTime: "12:00", endTime: "16:00", category: "manualLight",
      breakMinutes: 0,
    }));
    expect(adjacent.status).toBe(201);
    const adjacentId = (await adjacent.json()).interval.id as number;

    const list = await listIntervals(new Request(`${origin}/api/v1/work-intervals?date=${date}`, { headers: { cookie } }));
    expect((await list.json()).intervals).toHaveLength(2);

    const patched = await updateInterval(
      jsonRequest(origin, { category: "manualModerate" }, "PATCH"),
      context(adjacentId),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).interval.category).toBe("manualModerate");
    expect((await deleteInterval(new Request(origin, { headers: { origin, cookie } }), context(adjacentId))).status).toBe(204);
  });
});
