import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  POSTCOMMIT_TEST_DATABASE_NAME,
  POSTCOMMIT_FRESH_TEST_DATABASE_NAME,
  POSTCOMMIT_TEST_DATABASE_ROLE,
  requireIsolatedStage01Database,
} from "@/modules/training/testing/require-isolated-database";

const databaseUrl = process.env.DATABASE_URL;
const isolatedDatabase = requireIsolatedStage01Database(databaseUrl, process.env.BODYCAST_STAGE01_MODE, "test");
if ((isolatedDatabase.databaseName !== POSTCOMMIT_TEST_DATABASE_NAME
    && isolatedDatabase.databaseName !== POSTCOMMIT_FRESH_TEST_DATABASE_NAME)
  || isolatedDatabase.role !== POSTCOMMIT_TEST_DATABASE_ROLE) {
  throw new Error("Auth integration requires the dedicated isolated postcommit test database");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const origin = "http://localhost:3000";
const mailbox = new Map<string, string[]>();
const userIds = new Set<string>();
const profileIds = new Set<number>();
const emails = new Set<string>();
const healthAuditIds = new Set<number>();
const dailyHealthDataIds = new Set<number>();
const workoutIds = new Set<number>();
const strengthSessionIds = new Set<number>();
const canonicalEnergyEventIds = new Set<number>();
const modelEpisodeIds = new Set<number>();
let providerAccepts = true;
let initialProfileOneTrainingState: Awaited<ReturnType<typeof saveProfileOneTrainingState>> | null = null;
let auth: typeof import("@/lib/auth")["auth"];
let registrationStart: typeof import("@/app/api/registration/start/route").POST;
let registrationResend: typeof import("@/app/api/registration/resend/route").POST;
let login: typeof import("@/app/api/account/login/route").POST;
let passwordChangeRequest: typeof import("@/app/api/account/password-change/request/route").POST;
let passwordChange: typeof import("@/app/api/account/password-change/route").POST;
let healthSyncPost: typeof import("@/app/api/v1/health/sync/route").POST;
let daysGet: typeof import("@/app/api/v1/days/route").GET;
let strengthSessionGet: typeof import("@/app/api/v1/training/sessions/[id]/route").GET;
let stepperWorkoutsGet: typeof import("@/app/api/v1/training/stepper-workouts/route").GET;

function request(body: unknown): Request {
  return new Request(`${origin}/api`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": testClientIp() },
    body: JSON.stringify(body),
  });
}

function passwordLoginRequest(email: string, password: string, ip: string): Request {
  return new Request(`${origin}/api/account/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
}

function requestWithCookie(path: string, body: unknown, cookie: string): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json", "x-forwarded-for": testClientIp() },
    body: JSON.stringify(body),
  });
}

function authHttpRequest(path: string, body: unknown): Request {
  return new Request(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": testClientIp() },
    body: JSON.stringify(body),
  });
}

function testClientIp(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `198.51.100.${1 + ((bytes[0]! + bytes[1]! + bytes[2]!) % 254)}`;
}

async function saveProfileOneTrainingState() {
  return {
    queue: await prisma.trainingRefreshJob.findUnique({ where: { profileId: 1 } }),
    sourceChanges: await prisma.trainingSourceChange.findMany({ where: { profileId: 1 } }),
  };
}

async function restoreProfileOneTrainingState(state: Awaited<ReturnType<typeof saveProfileOneTrainingState>>): Promise<void> {
  await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1 } });
  await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });
  if (state.sourceChanges.length > 0) {
    await prisma.trainingSourceChange.createMany({ data: state.sourceChanges.map((row) => ({
      ...row,
      oldSourceIdentity: row.oldSourceIdentity === null ? Prisma.DbNull : row.oldSourceIdentity as Prisma.InputJsonValue,
      newSourceIdentity: row.newSourceIdentity === null ? Prisma.DbNull : row.newSourceIdentity as Prisma.InputJsonValue,
      oldEventInstants: row.oldEventInstants === null ? Prisma.DbNull : row.oldEventInstants as Prisma.InputJsonValue,
      newEventInstants: row.newEventInstants === null ? Prisma.DbNull : row.newEventInstants as Prisma.InputJsonValue,
    })) });
  }
  if (state.queue) await prisma.trainingRefreshJob.create({ data: state.queue });
}

function nextOtp(email: string): string {
  const code = mailbox.get(email)?.shift();
  if (!code) throw new Error("Test mail provider did not receive an OTP");
  return code;
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function startAndVerify(email: string, name: string) {
  emails.add(email);
  const start = await registrationStart(request({ email, name }));
  expect(start.status).toBe(202);
  expect(await start.json()).toEqual({ requestReceived: true });

  const pending = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, emailVerified: true, passwordChangeRequired: true, profile: { select: { id: true } } },
  });
  userIds.add(pending.id);
  expect(pending).toMatchObject({ emailVerified: false, profile: null });
  expect(await prisma.session.count({ where: { userId: pending.id } })).toBe(0);

  const otp = nextOtp(email);
  const httpAuth = await import("@/app/api/auth/[...all]/route");
  const verification = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email, otp }));
  expect(verification.status).toBe(200);
  const verified = await prisma.user.findUniqueOrThrow({
    where: { id: pending.id },
    select: { id: true, emailVerified: true, passwordChangeRequired: true, profile: { select: { id: true } } },
  });
  if (!verified.profile) throw new Error("Verified registration did not provision its Profile");
  profileIds.add(verified.profile.id);
  return verified;
}

describe("auth and tenant registration integration", () => {
  beforeAll(async () => {
    process.env.IOS_SHORTCUT_API_KEY = "isolated-test-shortcut-key-000000";
    process.env.BETTER_AUTH_SECRET = "isolated-auth-test-secret-with-32-characters";
    process.env.BETTER_AUTH_URL = origin;
    process.env.AUTH_TRUSTED_ORIGINS = origin;
    process.env.AUTH_TRUSTED_PROXIES = "127.0.0.1/32";
    process.env.AUTH_PUBLIC_REGISTRATION_ENABLED = "true";
    process.env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED = "false";
    process.env.BREVO_API_KEY = "isolated-test-provider-key";
    process.env.BREVO_SENDER_EMAIL = "noreply@example.invalid";
    process.env.BREVO_SENDER_NAME = "BodyCast Test";
    process.env.AUTH_EMAIL_DAILY_LIMIT = "1000";

    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { to?: Array<{ email: string }>; textContent?: string };
      const email = payload.to?.[0]?.email?.toLowerCase();
      const code = payload.textContent?.match(/Код:\s*(\d{6})/)?.[1];
      if (!providerAccepts) return new Response(null, { status: 503 });
      if (email && code) mailbox.set(email, [...(mailbox.get(email) ?? []), code]);
      return new Response(JSON.stringify({ messageId: "isolated-provider-accepted" }), { status: 201 });
    }));

    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ databaseName: string; databaseUser: string }>>`
      SELECT current_database() AS "databaseName", current_user AS "databaseUser"
    `;
    if (identity[0]?.databaseName !== isolatedDatabase.databaseName || identity[0]?.databaseUser !== isolatedDatabase.role) {
      throw new Error("Auth integration connected to a database outside the isolated test identity");
    }
    if (!await prisma.profile.findUnique({ where: { id: 1 }, select: { id: true } })) {
      throw new Error("The isolated migration rehearsal must contain its synthetic legacy Profile 1");
    }
    // Keep legacy Profile 1's unrelated queue from affecting the tenant
    // worker assertions, while restoring its exact prior state after the suite.
    initialProfileOneTrainingState = await saveProfileOneTrainingState();
    await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1 } });
    await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });

    ({ auth } = await import("@/lib/auth"));
    ({ POST: registrationStart } = await import("@/app/api/registration/start/route"));
    ({ POST: registrationResend } = await import("@/app/api/registration/resend/route"));
    ({ POST: login } = await import("@/app/api/account/login/route"));
    ({ POST: passwordChangeRequest } = await import("@/app/api/account/password-change/request/route"));
    ({ POST: passwordChange } = await import("@/app/api/account/password-change/route"));
    ({ POST: healthSyncPost } = await import("@/app/api/v1/health/sync/route"));
    ({ GET: daysGet } = await import("@/app/api/v1/days/route"));
    ({ GET: strengthSessionGet } = await import("@/app/api/v1/training/sessions/[id]/route"));
    ({ GET: stepperWorkoutsGet } = await import("@/app/api/v1/training/stepper-workouts/route"));
  });

  afterAll(async () => {
    if (canonicalEnergyEventIds.size) {
      await prisma.activeEnergyCanonicalEvent.deleteMany({ where: { id: { in: [...canonicalEnergyEventIds] } } });
    }
    if (modelEpisodeIds.size) await prisma.modelEpisode.deleteMany({ where: { id: { in: [...modelEpisodeIds] } } });
    if (profileIds.size) {
      const ids = [...profileIds];
      await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId: { in: ids } } });
      await prisma.unifiedExperimentalPhysiologyState.deleteMany({ where: { profileId: { in: ids } } });
    }
    if (healthAuditIds.size) await prisma.healthSyncAudit.deleteMany({ where: { id: { in: [...healthAuditIds] } } });
    if (strengthSessionIds.size) await prisma.strengthDiarySession.deleteMany({ where: { id: { in: [...strengthSessionIds] } } });
    if (workoutIds.size) await prisma.workout.deleteMany({ where: { id: { in: [...workoutIds] } } });
    if (dailyHealthDataIds.size) await prisma.dailyHealthData.deleteMany({ where: { id: { in: [...dailyHealthDataIds] } } });
    if (profileIds.size) {
      const ids = [...profileIds];
      await prisma.trainingSourceChange.deleteMany({ where: { profileId: { in: ids } } });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId: { in: ids } } });
      await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: { in: ids } } });
    }
    if (profileIds.size) {
      const ids = [...profileIds];
      await prisma.profileApiKey.deleteMany({ where: { profileId: { in: ids } } });
      await prisma.exerciseCatalog.deleteMany({ where: { profileId: { in: ids } } });
      await prisma.profile.deleteMany({ where: { id: { in: ids } } });
    }
    for (const email of emails) {
      await prisma.verification.deleteMany({ where: { identifier: { contains: email } } });
    }
    const ownerEmail = process.env.AUTH_PROFILE_ONE_OWNER_EMAIL;
    if (ownerEmail) {
      const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
      if (owner) {
        await prisma.profile.updateMany({ where: { id: 1, userId: owner.id }, data: { userId: null } });
        await prisma.user.delete({ where: { id: owner.id } });
      }
    }
    if (userIds.size) {
      const ids = [...userIds];
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    if (initialProfileOneTrainingState) await restoreProfileOneTrainingState(initialProfileOneTrainingState);
    await prisma.$disconnect();
    vi.unstubAllGlobals();
  });

  it("requires email OTP before Profile or session and keeps trusted API calls while blocking raw signup", async () => {
    const httpAuth = await import("@/app/api/auth/[...all]/route");
    const disabledRoutes: Array<[string, unknown]> = [
      ["/sign-up/email", { email: "direct-route@example.invalid", name: "Direct", password: "Chosen-Password-123" }],
      ["/sign-in/email", { email: "direct-route@example.invalid", password: "Chosen-Password-123" }],
      ["/sign-in/email-otp", { email: "direct-route@example.invalid" }],
      ["/email-otp/send-verification-otp", { email: "direct-route@example.invalid", type: "email-verification" }],
      ["/email-otp/check-verification-otp", { email: "direct-route@example.invalid", otp: "000000", type: "email-verification" }],
      ["/email-otp/request-password-reset", { email: "direct-route@example.invalid" }],
      ["/email-otp/reset-password", { email: "direct-route@example.invalid", otp: "000000", password: "Chosen-Password-123" }],
      ["/forget-password/email-otp", { email: "direct-route@example.invalid", otp: "000000", password: "Chosen-Password-123" }],
      ["/change-password", { currentPassword: "Chosen-Password-123", newPassword: "Other-Password-123" }],
      ["/set-password", { newPassword: "Chosen-Password-123" }],
      ["/forget-password", { email: "direct-route@example.invalid" }],
      ["/reset-password", { token: "untrusted", newPassword: "Chosen-Password-123" }],
      ["/send-verification-email", { email: "direct-route@example.invalid" }],
      ["/verify-email", { token: "untrusted" }],
      ["/change-email", { newEmail: "other@example.invalid" }],
    ];
    for (const [path, body] of disabledRoutes) {
      const response = await httpAuth.POST(authHttpRequest(path, body));
      expect(response.status, `${path} must stay disabled on the public Better Auth router`).toBe(404);
    }
    expect(await prisma.user.count({ where: { email: "direct-route@example.invalid" } })).toBe(0);

    const { getIP } = await import("better-auth/api");
    expect(getIP(new Headers({ "x-forwarded-for": "203.0.113.17, 127.0.0.1" }), auth.options)).toBe("203.0.113.17");

    const streamedOversize = await registrationStart(new Request(`${origin}/api/registration/start`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": testClientIp() },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(10 * 1024));
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(streamedOversize.status).toBe(413);

    const oversizedDirectAuth = await httpAuth.POST(new Request(`${origin}/api/auth/email-otp/verify-email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(10 * 1024)); },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(oversizedDirectAuth.status).toBe(413);

    const email = `auth-user-${crypto.randomUUID()}@example.invalid`;
    emails.add(email);
    const response = await registrationStart(request({ email, name: "First User" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ requestReceived: true });
    const pending = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.add(pending.id);
    expect(pending.emailVerified).toBe(false);
    expect(await prisma.profile.count({ where: { userId: pending.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: pending.id } })).toBe(0);

    const blockedLogin = await login(request({ email, password: `Chosen-${crypto.randomUUID()}-password` }));
    expect(blockedLogin.status).toBe(400);
    expect(blockedLogin.headers.get("set-cookie")).toBeNull();
    const otp = nextOtp(email);
    const stored = await prisma.verification.findMany({ where: { identifier: { contains: email } } });
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((row) => !row.value.includes(otp))).toBe(true);

    const verificationStateBeforeDirectCheck = await prisma.verification.findMany({
      where: { identifier: { contains: email } },
      orderBy: { id: "asc" },
    });
    const directOtpCheck = await httpAuth.POST(authHttpRequest("/email-otp/check-verification-otp", {
      email, otp: "000000", type: "email-verification",
    }));
    expect(directOtpCheck.status).toBe(404);
    expect(await prisma.verification.findMany({
      where: { identifier: { contains: email } },
      orderBy: { id: "asc" },
    })).toEqual(verificationStateBeforeDirectCheck);

    const verified = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email, otp }));
    expect(verified.status).toBe(200);
    const provisioned = await prisma.user.findUniqueOrThrow({
      where: { id: pending.id },
      select: { emailVerified: true, profile: { select: { id: true, sex: true, dateOfBirth: true, heightCm: true } } },
    });
    expect(provisioned.emailVerified).toBe(true);
    expect(provisioned.profile).toMatchObject({ sex: null, dateOfBirth: null, heightCm: null });
    if (!provisioned.profile) throw new Error("Profile provisioning failed after verified OTP");
    profileIds.add(provisioned.profile.id);
    expect(provisioned.profile.id).not.toBe(1);
    expect(await prisma.exerciseCatalog.count({ where: { profileId: provisioned.profile.id } })).toBeGreaterThan(0);
    expect(await prisma.session.count({ where: { userId: pending.id } })).toBe(0);
    const replay = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email, otp }));
    expect(replay.status).toBeGreaterThanOrEqual(400);

    const retryEmail = `provider-retry-${crypto.randomUUID()}@example.invalid`;
    emails.add(retryEmail);
    providerAccepts = false;
    const rejectedByProvider = await registrationStart(request({ email: retryEmail, name: "Retry User" }));
    providerAccepts = true;
    expect(rejectedByProvider.status).toBe(202);
    const neutralBody = await rejectedByProvider.json() as Record<string, unknown>;
    expect(neutralBody).toEqual({ requestReceived: true });
    expect(neutralBody).not.toHaveProperty("emailSent");
    const partialUser = await prisma.user.findUnique({ where: { email: retryEmail }, select: { id: true, emailVerified: true, profile: { select: { id: true } } } });
    if (partialUser) {
      userIds.add(partialUser.id);
      expect(partialUser).toMatchObject({ emailVerified: false, profile: null });
    }
    const retryResponse = await registrationResend(request({ email: retryEmail, name: "Retry User" }));
    expect(retryResponse.status).toBe(202);
    const retried = await prisma.user.findUniqueOrThrow({ where: { email: retryEmail }, select: { id: true, emailVerified: true, profile: { select: { id: true } } } });
    userIds.add(retried.id);
    expect(retried).toMatchObject({ emailVerified: false, profile: null });
    const retryOtp = nextOtp(retryEmail);
    const concurrentVerification = await Promise.allSettled([
      httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: retryEmail, otp: retryOtp })),
      httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: retryEmail, otp: retryOtp })),
    ]);
    expect(concurrentVerification.filter((result) => result.status === "fulfilled" && result.value.status === 200)).toHaveLength(1);
    expect(concurrentVerification.filter((result) => result.status === "fulfilled" && result.value.status >= 400)).toHaveLength(1);
    const retryProfile = await prisma.profile.findUniqueOrThrow({ where: { userId: retried.id }, select: { id: true } });
    profileIds.add(retryProfile.id);

    const duplicateEmail = `signup-race-${crypto.randomUUID()}@example.invalid`;
    emails.add(duplicateEmail);
    const duplicateRequests = await Promise.all([
      registrationStart(request({ email: duplicateEmail, name: "First contender" })),
      registrationStart(request({ email: duplicateEmail, name: "Second contender" })),
    ]);
    expect(duplicateRequests.map((response) => response.status)).toEqual([202, 202]);
    expect(await prisma.user.count({ where: { email: duplicateEmail } })).toBe(1);
    const duplicateUser = await prisma.user.findUniqueOrThrow({ where: { email: duplicateEmail }, select: { id: true } });
    userIds.add(duplicateUser.id);
    expect(await prisma.profile.count({ where: { userId: duplicateUser.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: duplicateUser.id } })).toBe(0);

    process.env.AUTH_EMAIL_RECIPIENT_DAILY_LIMIT = "3";
    const { sendAuthEmail } = await import("@/modules/auth/email");
    const recipient = `quota-${crypto.randomUUID()}@example.invalid`;
    await sendAuthEmail({ email: recipient, code: "123456", purpose: "verify" });
    await sendAuthEmail({ email: recipient, code: "234567", purpose: "reset" });
    await sendAuthEmail({ email: recipient, code: "345678", purpose: "change" });
    await expect(sendAuthEmail({ email: recipient, code: "456789", purpose: "verify" }))
      .rejects.toThrow("recipient daily limit");
    const otherRecipient = `quota-other-${crypto.randomUUID()}@example.invalid`;
    await expect(sendAuthEmail({ email: otherRecipient, code: "567890", purpose: "verify" })).resolves.toBeUndefined();
    process.env.AUTH_EMAIL_RECIPIENT_DAILY_LIMIT = "100";

    const syncUrl = `${origin}/api/v1/health/sync`;
    const oversizedSync = await healthSyncPost(new Request(syncUrl, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": testClientIp() },
      body: `{"payload":"${"x".repeat(5 * 1024 * 1024)}"}`,
    }));
    expect(oversizedSync.status).toBe(413);
    const oversizedAudit = await prisma.healthSyncAudit.findFirst({
      where: { outcome: "payload-too-large", httpStatus: 413 }, orderBy: { id: "desc" },
    });
    if (!oversizedAudit) throw new Error("Oversized request was not recorded in HealthSyncAudit");
    healthAuditIds.add(oversizedAudit.id);
    expect(oversizedAudit).toMatchObject({ profileId: null, rawBody: null });

    const unauthorizedBody = JSON.stringify({ auditSentinel: crypto.randomUUID() });
    const unauthorizedSync = await healthSyncPost(new Request(syncUrl, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": testClientIp() },
      body: unauthorizedBody,
    }));
    expect(unauthorizedSync.status).toBe(401);
    const unauthorizedAudit = await prisma.healthSyncAudit.findFirst({
      where: { outcome: "unauthorized", httpStatus: 401, rawBody: unauthorizedBody }, orderBy: { id: "desc" },
    });
    if (!unauthorizedAudit) throw new Error("Unauthenticated HealthSyncAudit body was not retained");
    healthAuditIds.add(unauthorizedAudit.id);
    expect(unauthorizedAudit.profileId).toBeNull();
  });

  it("expires verification OTPs, limits attempts, and rotates resent codes", async () => {
    const httpAuth = await import("@/app/api/auth/[...all]/route");
    const expiredEmail = `otp-expiry-${crypto.randomUUID()}@example.invalid`;
    emails.add(expiredEmail);
    expect((await registrationStart(request({ email: expiredEmail, name: "Expiry User" }))).status).toBe(202);
    const expiredUser = await prisma.user.findUniqueOrThrow({ where: { email: expiredEmail }, select: { id: true } });
    userIds.add(expiredUser.id);
    const expiredCode = nextOtp(expiredEmail);
    const verificationIdentifier = `email-verification-otp-${expiredEmail}`;
    const stored = await prisma.verification.findFirstOrThrow({ where: { identifier: verificationIdentifier } });
    const configuredLifetimeMs = stored.expiresAt.getTime() - stored.createdAt.getTime();
    expect(configuredLifetimeMs).toBeGreaterThanOrEqual(295_000);
    expect(configuredLifetimeMs).toBeLessThanOrEqual(305_000);

    await prisma.verification.update({
      where: { id: stored.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: expiredEmail, otp: expiredCode }));
    expect(expired.status).toBe(400);
    expect(await prisma.profile.count({ where: { userId: expiredUser.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: expiredUser.id } })).toBe(0);

    expect((await registrationResend(request({ email: expiredEmail, name: "Expiry User" }))).status).toBe(202);
    const replacementCode = nextOtp(expiredEmail);
    expect(replacementCode).not.toBe(expiredCode);
    const staleCode = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: expiredEmail, otp: expiredCode }));
    expect(staleCode.status).toBeGreaterThanOrEqual(400);
    const replacement = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: expiredEmail, otp: replacementCode }));
    expect(replacement.status).toBe(200);
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: expiredUser.id }, select: { id: true } });
    profileIds.add(profile.id);

    const attemptsEmail = `otp-attempts-${crypto.randomUUID()}@example.invalid`;
    emails.add(attemptsEmail);
    expect((await registrationStart(request({ email: attemptsEmail, name: "Attempts User" }))).status).toBe(202);
    const attemptsUser = await prisma.user.findUniqueOrThrow({ where: { email: attemptsEmail }, select: { id: true } });
    userIds.add(attemptsUser.id);
    const validCode = nextOtp(attemptsEmail);
    const wrongCode = validCode === "000000" ? "999999" : "000000";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const invalid = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: attemptsEmail, otp: wrongCode }));
      expect(invalid.status).toBeGreaterThanOrEqual(400);
    }
    const exhausted = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: attemptsEmail, otp: validCode }));
    expect(exhausted.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.profile.count({ where: { userId: attemptsUser.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: attemptsUser.id } })).toBe(0);
    expect((await registrationResend(request({ email: attemptsEmail, name: "Attempts User" }))).status).toBe(202);
    const rotatedCode = nextOtp(attemptsEmail);
    const successfulRetry = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email: attemptsEmail, otp: rotatedCode }));
    expect(successfulRetry.status).toBe(200);
    const attemptsProfile = await prisma.profile.findUniqueOrThrow({ where: { userId: attemptsUser.id }, select: { id: true } });
    profileIds.add(attemptsProfile.id);
  });

  it("recovers verification after Profile provisioning fails without issuing a session or duplicate Profile", async () => {
    const httpAuth = await import("@/app/api/auth/[...all]/route");
    const email = `profile-provision-retry-${crypto.randomUUID()}@example.invalid`;
    emails.add(email);
    expect((await registrationStart(request({ email, name: "Provision Retry" }))).status).toBe(202);
    const pending = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    userIds.add(pending.id);
    const firstCode = nextOtp(email);

    const userIdSql = pending.id.replace(/'/g, "''");
    const triggerSuffix = crypto.randomUUID().replaceAll("-", "");
    const functionName = `bodycast_auth_profile_fail_${triggerSuffix}`;
    const triggerName = `bodycast_auth_profile_fail_${triggerSuffix}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."userId" = '${userIdSql}' THEN
          RAISE EXCEPTION 'injected isolated Profile provisioning failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "Profile"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);
    let failedVerification: Response;
    try {
      failedVerification = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email, otp: firstCode }));
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "Profile"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
    expect(failedVerification!.status).toBeGreaterThanOrEqual(500);
    const verifiedWithoutProfile = await prisma.user.findUniqueOrThrow({
      where: { id: pending.id },
      select: { emailVerified: true, profile: { select: { id: true } } },
    });
    expect(verifiedWithoutProfile).toMatchObject({ emailVerified: true, profile: null });
    expect(await prisma.session.count({ where: { userId: pending.id } })).toBe(0);
    expect(await prisma.profile.count({ where: { userId: pending.id } })).toBe(0);

    expect((await registrationResend(request({ email, name: "Provision Retry" }))).status).toBe(202);
    const retryCode = nextOtp(email);
    const staleReplay = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email, otp: firstCode }));
    expect(staleReplay.status).toBeGreaterThanOrEqual(400);
    const retry = await httpAuth.POST(authHttpRequest("/email-otp/verify-email", { email, otp: retryCode }));
    expect(retry.status).toBe(200);
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: pending.id }, select: { id: true } });
    profileIds.add(profile.id);
    expect(await prisma.profile.count({ where: { userId: pending.id } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: pending.id } })).toBe(0);
  });

  it("scopes API keys to their verified Profiles and revokes all sessions after OTP password change", async () => {
    const emailA = `auth-a-${crypto.randomUUID()}@example.invalid`;
    const emailB = `auth-b-${crypto.randomUUID()}@example.invalid`;
    const userA = await startAndVerify(emailA, "User A");
    const userB = await startAndVerify(emailB, "User B");
    if (!userA.profile || !userB.profile) throw new Error("Verified user is missing Profile");

    const passwordA = `Tenant-A-${crypto.randomUUID()}-pass`;
    const passwordB = `Tenant-B-${crypto.randomUUID()}-pass`;
    for (const email of [emailA, emailB]) {
      await auth.api.requestPasswordResetEmailOTP({ headers: new Headers({ origin }), body: { email } });
      await auth.api.resetPasswordEmailOTP({
        headers: new Headers({ origin }),
        body: { email, otp: nextOtp(email), password: email === emailA ? passwordA : passwordB },
      });
    }
    const [loginA, loginB] = await Promise.all([
      login(request({ email: emailA, password: passwordA })),
      login(request({ email: emailB, password: passwordB })),
    ]);
    expect(loginA.status).toBe(200);
    expect(loginB.status).toBe(200);
    const cookieA = cookieHeader(loginA);
    const cookieB = cookieHeader(loginB);
    if (!cookieA || !cookieB) throw new Error("Both verified test users must receive isolated sessions");

    const sessionsBeforeCredentialFailures = await prisma.session.count({ where: { userId: userA.id } });
    const wrongPassword = await login(request({ email: emailA, password: `wrong-${crypto.randomUUID()}` }));
    const unknownEmail = `missing-${crypto.randomUUID()}@example.invalid`;
    const unknownAccount = await login(request({ email: unknownEmail, password: `wrong-${crypto.randomUUID()}` }));
    expect(wrongPassword.status).toBe(400);
    expect(unknownAccount.status).toBe(wrongPassword.status);
    expect(await wrongPassword.json()).toEqual({ error: "invalid_credentials" });
    expect(await unknownAccount.json()).toEqual({ error: "invalid_credentials" });
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
    expect(unknownAccount.headers.get("set-cookie")).toBeNull();
    expect(await prisma.session.count({ where: { userId: userA.id } })).toBe(sessionsBeforeCredentialFailures);
    expect(await prisma.user.findUnique({ where: { email: unknownEmail }, select: { id: true } })).toBeNull();

    const sourceDate = "2046-06-17";
    const healthA = await prisma.dailyHealthData.create({
      data: { profileId: userA.profile.id, date: sourceDate, weightKg: 71.4, rawPayload: { marker: "profile-a" } },
    });
    const healthB = await prisma.dailyHealthData.create({
      data: { profileId: userB.profile.id, date: sourceDate, weightKg: 93.2, rawPayload: { marker: "profile-b" } },
    });
    dailyHealthDataIds.add(healthA.id);
    dailyHealthDataIds.add(healthB.id);
    await expect(prisma.healthSyncSnapshot.create({
      data: {
        profileId: userA.profile.id,
        dailyHealthDataId: healthB.id,
        date: sourceDate,
        timezone: "UTC",
        rawPayload: { marker: "cross-profile-snapshot" },
      },
    })).rejects.toMatchObject({ code: "P2003" });
    const startAt = new Date("2046-06-17T10:00:00.000Z");
    const workoutA = await prisma.workout.create({
      data: { profileId: userA.profile.id, dailyHealthDataId: healthA.id, sourceIdentity: "tenant-test:a", type: "Stair Climbing", startAt, endAt: new Date(startAt.getTime() + 20 * 60_000), durationMinutes: 20, activeEnergyKcal: 110 },
    });
    const workoutB = await prisma.workout.create({
      data: { profileId: userB.profile.id, dailyHealthDataId: healthB.id, sourceIdentity: "tenant-test:b", type: "Stair Climbing", startAt, endAt: new Date(startAt.getTime() + 20 * 60_000), durationMinutes: 20, activeEnergyKcal: 210 },
    });
    workoutIds.add(workoutA.id);
    workoutIds.add(workoutB.id);
    const sessionA = await prisma.strengthDiarySession.create({ data: { profileId: userA.profile.id, status: "CANCELLED", entryMode: "LIVE", matchStatus: "UNMATCHED", webStartedAt: startAt } });
    const sessionB = await prisma.strengthDiarySession.create({ data: { profileId: userB.profile.id, status: "CANCELLED", entryMode: "LIVE", matchStatus: "UNMATCHED", webStartedAt: startAt } });
    strengthSessionIds.add(sessionA.id);
    strengthSessionIds.add(sessionB.id);
    const otherCatalog = await prisma.exerciseCatalog.findFirstOrThrow({ where: { profileId: userB.profile.id }, select: { id: true } });
    await expect(prisma.strengthSessionExercise.create({
      data: {
        profileId: userA.profile.id,
        sessionId: sessionA.id,
        sourceExerciseCatalogId: otherCatalog.id,
        snapshotExerciseName: "cross-profile FK sentinel",
        sortOrder: 0,
        plannedSets: 1,
        resistanceType: "EXTERNAL_WEIGHT",
      },
    })).rejects.toBeTruthy();

    const [daysA, daysB, sessionForeign, stepperA, stepperB] = await Promise.all([
      daysGet(new Request(`${origin}/api/v1/days?from=${sourceDate}&to=${sourceDate}`, { headers: { cookie: cookieA } })),
      daysGet(new Request(`${origin}/api/v1/days?from=${sourceDate}&to=${sourceDate}`, { headers: { cookie: cookieB } })),
      strengthSessionGet(new Request(`${origin}/api/v1/training/sessions/${sessionB.id}`, { headers: { cookie: cookieA } }), { params: Promise.resolve({ id: String(sessionB.id) }) }),
      stepperWorkoutsGet(new Request(`${origin}/api/v1/training/stepper-workouts?limit=100`, { headers: { cookie: cookieA } })),
      stepperWorkoutsGet(new Request(`${origin}/api/v1/training/stepper-workouts?limit=100`, { headers: { cookie: cookieB } })),
    ]);
    expect(daysA.status, await daysA.clone().text()).toBe(200);
    expect(daysB.status, await daysB.clone().text()).toBe(200);
    const daysAPayload = await daysA.json() as { days: Array<{ weightKg: number }> };
    const daysBPayload = await daysB.json() as { days: Array<{ weightKg: number }> };
    expect(daysAPayload.days.map(({ weightKg }) => weightKg)).toContain(71.4);
    expect(daysAPayload.days.map(({ weightKg }) => weightKg)).not.toContain(93.2);
    expect(daysBPayload.days.map(({ weightKg }) => weightKg)).toContain(93.2);
    expect(daysBPayload.days.map(({ weightKg }) => weightKg)).not.toContain(71.4);
    expect(sessionForeign.status).toBe(404);
    const listedA = (await stepperA.json() as { workouts: Array<{ id: number }> }).workouts.map(({ id }) => id);
    const listedB = (await stepperB.json() as { workouts: Array<{ id: number }> }).workouts.map(({ id }) => id);
    expect(listedA).toContain(workoutA.id);
    expect(listedA).not.toContain(workoutB.id);
    expect(listedB).toContain(workoutB.id);
    expect(listedB).not.toContain(workoutA.id);

    const lifecycleVersions = await import("@/modules/model-episodes/physiology-v7-persistence");
    for (const profileId of [userA.profile.id, userB.profile.id]) {
      await prisma.physiologyV7Lifecycle.upsert({
        where: { profileId },
        create: { profileId, ...lifecycleVersions.currentPhysiologyV7Versions },
        update: { ...lifecycleVersions.currentPhysiologyV7Versions },
      });
    }
    const [{ createUnavailablePhysiologyRuntimeStateV7, buildPhysiologyDayV7 }, { buildResistanceTrainingExposureHistoryFromSourcesV7 }, { observedNutritionProvenance }, { PhysiologyV7PersistenceRepository }] = await Promise.all([
      import("@/model/physiology-v7/daily-runtime-v7"),
      import("@/model/physiology-v7/resistance-training-exposure-history-sources-v7"),
      import("@/modules/model-episodes/nutrition-gap-bridge"),
      import("@/modules/model-episodes/physiology-v7-persistence.repository"),
    ]);
    const v7Persistence = new PhysiologyV7PersistenceRepository(prisma);
    const v7Day = (weightKg: number) => buildPhysiologyDayV7({
      date: sourceDate,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: {
        date: sourceDate,
        observedWeightKg: weightKg,
        observedBodyFatPercent: null,
        nutrition: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null, provenance: observedNutritionProvenance() },
        workoutFeedObserved: true,
        steps: 0,
        walkingRunningDistanceKm: 0,
        workouts: [],
        stepperWorkouts: [],
        context: { heartRateSampleCount: 0, restingHeartRateSampleCount: 0, sleepSegmentCount: 0 },
      },
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: sourceDate,
        toDate: sourceDate,
        days: [{ date: sourceDate, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    const [generationA, generationB] = await Promise.all([
      prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: userA.profile.id }, select: { invalidationGeneration: true } }),
      prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: userB.profile.id }, select: { invalidationGeneration: true } }),
    ]);
    await Promise.all([
      v7Persistence.persistRange({ profileId: userA.profile.id, expectedGeneration: generationA.invalidationGeneration, rebuiltThroughDate: sourceDate, days: [v7Day(71.4)] }),
      v7Persistence.persistRange({ profileId: userB.profile.id, expectedGeneration: generationB.invalidationGeneration, rebuiltThroughDate: sourceDate, days: [v7Day(93.2)] }),
    ]);
    const v7ReadA = await v7Persistence.readDay(userA.profile.id, sourceDate);
    const v7ReadB = await v7Persistence.readDay(userB.profile.id, sourceDate);
    expect(v7ReadA.status).toBe("current");
    expect(v7ReadB.status).toBe("current");
    expect(v7ReadA.result?.observations.observedWeightKg.valueKg).toBe(71.4);
    expect(v7ReadB.result?.observations.observedWeightKg.valueKg).toBe(93.2);

    const episodeFixture = (profileId: number) => ({
      profileId,
      startDate: sourceDate,
      timezone: "UTC",
      modelVersion: "bodycast-physiology-v6",
      active: true,
      ecfPolicy: "hold-ecf",
      baselineEnergyIntakeKcalPerDay: 2_400,
      baselineCarbIntakeG: 220,
      baselineWindowStartDate: sourceDate,
      baselineWindowEndDate: sourceDate,
      baselineNutritionDayCount: 1,
      baselineWeightObservationCount: 1,
      baselineWeightTrendKgPerWeek: 0,
      baselineWeightTrendPercentPerWeek: 0,
      baselineDerivationMethod: `auth-multiuser-${profileId}`,
      initialFatMassKg: 16,
      initialLeanTissueKg: 55,
      initialGlycogenKg: 0.5,
      baselineExtracellularFluidLiters: 18,
      initialExtracellularFluidDeviationLiters: 0,
      initialAdaptiveThermogenesisKcalPerDay: 0,
      initialFilteredWeightKg: 80,
      initialWeightFilterVarianceKg2: 1,
      initialRmrKcalPerDay: 1_700,
      dynamicRmrFatCoefficient: 3.2,
      dynamicRmrLeanCoefficient: 22,
      dynamicRmrCalibrationOffsetKcalPerDay: 0,
      adaptiveThermogenesisBeta: 0.14,
      adaptiveThermogenesisTimeConstantDays: 14,
      weightProcessNoiseVarianceKg2PerDay: 0.01,
      weightMeasurementNoiseVarianceKg2: 0.25,
      calibrationDiagnostics: {},
    });
    const episodeA = await prisma.modelEpisode.create({ data: episodeFixture(userA.profile.id) });
    modelEpisodeIds.add(episodeA.id);
    const episodeB = await prisma.modelEpisode.create({ data: episodeFixture(userB.profile.id) });
    modelEpisodeIds.add(episodeB.id);
    const { UnifiedExperimentalPhysiologySourceLoaderV1 } = await import("@/model/unified-experimental-physiology-v1/source-loader");
    const unifiedLoader = new UnifiedExperimentalPhysiologySourceLoaderV1(prisma);
    const sourceDayStart = new Date(`${sourceDate}T00:00:00.000Z`);
    const [unifiedRangeA, unifiedRangeB] = await Promise.all([
      unifiedLoader.loadRange({ profileId: userA.profile.id, fromInstant: sourceDayStart, throughInstant: new Date(sourceDayStart.getTime() + 24 * 60 * 60_000) }),
      unifiedLoader.loadRange({ profileId: userB.profile.id, fromInstant: sourceDayStart, throughInstant: new Date(sourceDayStart.getTime() + 24 * 60 * 60_000) }),
    ]);
    const unifiedA = unifiedRangeA.days.flatMap(({ workouts }) => workouts);
    const unifiedB = unifiedRangeB.days.flatMap(({ workouts }) => workouts);
    expect(unifiedA.map(({ id }) => id)).toContain(workoutA.id);
    expect(unifiedA.map(({ id }) => id)).not.toContain(workoutB.id);
    expect(unifiedB.map(({ id }) => id)).toContain(workoutB.id);
    expect(unifiedB.map(({ id }) => id)).not.toContain(workoutA.id);
    expect(unifiedRangeA.days.flatMap(({ dailyHealthData }) => dailyHealthData ? [dailyHealthData.weightKg] : [])).toContain(71.4);
    expect(unifiedRangeA.days.flatMap(({ dailyHealthData }) => dailyHealthData ? [dailyHealthData.weightKg] : [])).not.toContain(93.2);
    expect(unifiedRangeB.days.flatMap(({ dailyHealthData }) => dailyHealthData ? [dailyHealthData.weightKg] : [])).toContain(93.2);
    expect(unifiedRangeB.days.flatMap(({ dailyHealthData }) => dailyHealthData ? [dailyHealthData.weightKg] : [])).not.toContain(71.4);

    const canonicalEvent = async (profileId: number, workout: typeof workoutA, kcal: number) => {
      const event = await prisma.activeEnergyCanonicalEvent.create({
        data: {
          profileId,
          logicalEventKey: `tenant-fixture:${workout.id}`,
          eventKind: "stepper",
          occurrenceAt: startAt,
          modelDate: sourceDate,
          modelTimeZone: "UTC",
          inputFingerprint: "a".repeat(64),
          isStale: false,
          currentResolutionFingerprint: "b".repeat(64),
          currentSource: "garmin",
          currentKcal: kcal,
          currentProvenance: { sourceId: workout.id, tenantMarker: profileId },
          aliases: {
            create: {
              sourceType: "workout",
              sourceId: String(workout.id),
              profile: { connect: { id: profileId } },
              workout: { connect: { profileId_id: { profileId, id: workout.id } } },
            },
          },
        },
      });
      canonicalEnergyEventIds.add(event.id);
      return event;
    };
    const canonicalA = await canonicalEvent(userA.profile.id, workoutA, 111);
    const canonicalB = await canonicalEvent(userB.profile.id, workoutB, 222);
    const canonicalRepository = await import("@/model/activity/active-energy-canonical.repository");
    expect(await canonicalRepository.readActiveEnergyResolutionByWorkoutV1(prisma, { profileId: userA.profile.id, workoutId: workoutA.id }))
      .toMatchObject({ currentKcal: 111, currentSource: "garmin", currentProvenance: { tenantMarker: userA.profile.id } });
    expect(await canonicalRepository.readActiveEnergyResolutionByWorkoutV1(prisma, { profileId: userA.profile.id, workoutId: workoutB.id })).toBeNull();
    expect(await canonicalRepository.readActiveEnergyResolutionByWorkoutV1(prisma, { profileId: userB.profile.id, workoutId: workoutB.id }))
      .toMatchObject({ currentKcal: 222, currentProvenance: { tenantMarker: userB.profile.id } });
    expect(canonicalA.profileId).toBe(userA.profile.id);
    expect(canonicalB.profileId).toBe(userB.profile.id);

    const stepperDiagnosticRoute = await import("@/app/api/v1/workouts/[id]/stepper-diagnostic/route");
    const foreignDiagnostic = await stepperDiagnosticRoute.GET(
      new Request(`${origin}/api/v1/workouts/${workoutB.id}/stepper-diagnostic`, { headers: { cookie: cookieA } }),
      { params: Promise.resolve({ id: String(workoutB.id) }) },
    );
    expect(foreignDiagnostic.status).toBe(404);

    const catalogA = await prisma.exerciseCatalog.findFirstOrThrow({ where: { profileId: userA.profile.id }, select: { id: true } });
    const exerciseB = await prisma.strengthSessionExercise.create({
      data: {
        profileId: userB.profile.id,
        sessionId: sessionB.id,
        sourceExerciseCatalogId: otherCatalog.id,
        snapshotExerciseName: "tenant B exercise",
        sortOrder: 0,
        plannedSets: 1,
        resistanceType: "EXTERNAL_WEIGHT",
      },
    });
    await prisma.strengthSessionExercise.create({
      data: {
        profileId: userA.profile.id,
        sessionId: sessionA.id,
        sourceExerciseCatalogId: catalogA.id,
        snapshotExerciseName: "tenant A exercise",
        sortOrder: 0,
        plannedSets: 1,
        resistanceType: "EXTERNAL_WEIGHT",
      },
    });
    const setB = await prisma.strengthSet.create({ data: { sessionExerciseId: exerciseB.id, setNumber: 1, reps: 8, weightKg: 20 } });
    const exerciseRoutes = await import("@/app/api/v1/training/sessions/[id]/exercises/[exerciseId]/route");
    const foreignExercisePatch = await exerciseRoutes.PATCH(new Request(`${origin}/api/v1/training/sessions/${sessionB.id}/exercises/${exerciseB.id}`, {
      method: "PATCH", headers: { origin, cookie: cookieA, "content-type": "application/json" }, body: JSON.stringify({ plannedSets: 2 }),
    }), { params: Promise.resolve({ id: String(sessionB.id), exerciseId: String(exerciseB.id) }) });
    expect(foreignExercisePatch.status).toBe(404);
    expect((await prisma.strengthSessionExercise.findUniqueOrThrow({ where: { id: exerciseB.id } })).plannedSets).toBe(1);
    const setRoutes = await import("@/app/api/v1/training/sessions/[id]/sets/[setId]/route");
    const foreignSetGet = await setRoutes.GET(new Request(`${origin}/api/v1/training/sessions/${sessionB.id}/sets/${setB.id}`, { headers: { cookie: cookieA } }), {
      params: Promise.resolve({ id: String(sessionB.id), setId: String(setB.id) }),
    });
    const foreignSetPatch = await setRoutes.PATCH(new Request(`${origin}/api/v1/training/sessions/${sessionB.id}/sets/${setB.id}`, {
      method: "PATCH", headers: { origin, cookie: cookieA, "content-type": "application/json" }, body: JSON.stringify({ reps: 12 }),
    }), { params: Promise.resolve({ id: String(sessionB.id), setId: String(setB.id) }) });
    expect(foreignSetGet.status).toBe(404);
    expect(foreignSetPatch.status).toBe(404);
    expect((await prisma.strengthSet.findUniqueOrThrow({ where: { id: setB.id } })).reps).toBe(8);

    const { enqueueTrainingSourceChangeInTransaction } = await import("@/modules/training/training-refresh-queue");
    await Promise.all([userA.profile.id, userB.profile.id].map((profileId) => prisma.$transaction((tx) =>
      enqueueTrainingSourceChangeInTransaction(tx, {
        profileId,
        operationKind: "auth_tenant_isolation_test",
        affectedSessionIds: [],
        oldModelDates: [sourceDate],
      }),
    )));
    await prisma.trainingRefreshJob.updateMany({
      where: { profileId: { in: [userA.profile.id, userB.profile.id] } },
      data: { dueAt: new Date(Date.now() - 1_000) },
    });
    const [jobA, jobB] = await Promise.all([
      prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: userA.profile.id } }),
      prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: userB.profile.id } }),
    ]);
    expect(jobA.requestedGeneration).toBe(1);
    expect(jobB.requestedGeneration).toBe(1);
    const { readTrainingRefreshVisibilityFence, isTrainingRefreshPending } = await import("@/modules/training/training-refresh-queue");
    expect(isTrainingRefreshPending(await readTrainingRefreshVisibilityFence(prisma, userA.profile.id))).toBe(true);
    expect(isTrainingRefreshPending(await readTrainingRefreshVisibilityFence(prisma, userB.profile.id))).toBe(true);

    if (isolatedDatabase.databaseName === POSTCOMMIT_FRESH_TEST_DATABASE_NAME) {
      const pendingBefore = await prisma.$queryRaw<Array<{ profileId: number }>>`
        SELECT "profileId" FROM "TrainingRefreshJob"
        WHERE "requestedGeneration" > "completedGeneration"
      `;
      expect(pendingBefore.map(({ profileId }) => profileId).sort((a, b) => a - b))
        .toEqual([userA.profile.id, userB.profile.id].sort((a, b) => a - b));
      const { processNextTrainingRefreshJob } = await import("@/modules/training/training-refresh-worker");
      const claimedProfileIds: number[] = [];
      let releaseClaimBarrier!: () => void;
      const claimBarrier = new Promise<void>((resolve) => { releaseClaimBarrier = resolve; });
      const hooks = {
        afterClaim: async (job: { profileId: number }) => {
          claimedProfileIds.push(job.profileId);
          if (claimedProfileIds.length === 2) releaseClaimBarrier();
          await claimBarrier;
        },
        afterProgressStage: async (_job: { profileId: number }, stage: string) => {
          if (stage === "invalidate-replay-suffix") {
            throw new Error("isolated tenant worker test stops before publication");
          }
        },
      };
      const worked = await Promise.all([
        processNextTrainingRefreshJob(hooks),
        processNextTrainingRefreshJob(hooks),
      ]);
      expect(worked).toEqual([true, true]);
      expect(claimedProfileIds.sort((a, b) => a - b)).toEqual([userA.profile.id, userB.profile.id].sort((a, b) => a - b));
      for (const profileId of [userA.profile.id, userB.profile.id]) {
        const retried = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
        expect(retried).toMatchObject({
          requestedGeneration: 1,
          completedGeneration: 0,
          attemptCount: 1,
          leaseToken: null,
          lastErrorType: "Error",
          lastProgressStage: "retry-wait",
        });
      }
    }

    const apiKeys = await import("@/modules/auth/api-keys");
    const access = await import("@/modules/auth/access");
    const keyA = await apiKeys.createProfileApiKey(userA.profile.id, "Health sync");
    const keyB = await apiKeys.createProfileApiKey(userB.profile.id, "Health sync");
    expect(Object.hasOwn(keyA, "secretHash")).toBe(false);
    const keyARecord = await prisma.profileApiKey.findUniqueOrThrow({ where: { id: keyA.id } });
    expect(keyARecord.secretHash).not.toContain(keyA.token);
    const principalA = await access.getProfilePrincipal(new Request(`${origin}/api/v1/health/sync?profileId=${userB.profile.id}`, {
      headers: { "x-api-key": keyA.token },
    }));
    expect(principalA).toMatchObject({ profileId: userA.profile.id, method: "api-key" });
    const principalB = await access.getProfilePrincipal(new Request(`${origin}/api/v1/health/sync`, {
      headers: { "x-api-key": keyB.token },
    }));
    expect(principalB).toMatchObject({ profileId: userB.profile.id, method: "api-key" });
    expect(await apiKeys.rotateProfileApiKey(userB.profile.id, keyA.id)).toBeNull();
    expect(await apiKeys.revokeProfileApiKey(userB.profile.id, keyA.id)).toBe(false);
    expect(await apiKeys.resolveProfileApiKey(keyA.token)).toMatchObject({ profileId: userA.profile.id });
    const rotated = await apiKeys.rotateProfileApiKey(userA.profile.id, keyA.id);
    if (!rotated) throw new Error("API key rotation failed for its owning Profile");
    expect(await apiKeys.resolveProfileApiKey(keyA.token)).toBeNull();
    expect(await apiKeys.resolveProfileApiKey(rotated.token)).toMatchObject({ profileId: userA.profile.id });
    expect(await apiKeys.revokeProfileApiKey(userA.profile.id, rotated.id)).toBe(true);
    expect(await apiKeys.resolveProfileApiKey(rotated.token)).toBeNull();

    const initialPassword = `Changed-${crypto.randomUUID()}-pass`;
    await auth.api.requestPasswordResetEmailOTP({ headers: new Headers({ origin }), body: { email: emailA } });
    await auth.api.resetPasswordEmailOTP({
      headers: new Headers({ origin }),
      body: { email: emailA, otp: nextOtp(emailA), password: initialPassword },
    });
    const signedIn = await auth.api.signInEmail({
      headers: new Headers({ origin }),
      body: { email: emailA, password: initialPassword },
      asResponse: true,
    });
    const cookie = cookieHeader(signedIn);
    if (!cookie) throw new Error("Successful login did not set an auth session cookie");
    expect(await prisma.session.count({ where: { userId: userA.id } })).toBeGreaterThan(0);

    const requested = await passwordChangeRequest(requestWithCookie("/api/account/password-change/request", {}, cookie));
    expect(requested.status).toBe(202);
    const changedPassword = `Final-${crypto.randomUUID()}-pass`;
    const changed = await passwordChange(requestWithCookie("/api/account/password-change", {
      otp: nextOtp(emailA), password: changedPassword,
    }, cookie));
    expect(changed.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: userA.id } })).toBe(0);
    const changedCookie = cookieHeader(changed);
    if (changedCookie) {
      const session = await auth.api.getSession({ headers: new Headers({ cookie: changedCookie }) });
      expect(session).toBeNull();
    }
    await expect(auth.api.signInEmail({ headers: new Headers({ origin }), body: { email: emailA, password: initialPassword } })).rejects.toBeTruthy();
    const relogin = await auth.api.signInEmail({
      headers: new Headers({ origin }), body: { email: emailA, password: changedPassword }, asResponse: true,
    });
    expect(relogin.status).toBe(200);

    const attackerIp = testClientIp();
    let ownerIp = testClientIp();
    if (ownerIp === attackerIp) ownerIp = testClientIp();
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const denied = await login(passwordLoginRequest(emailA, "wrong-password", attackerIp));
      expect([400, 401, 429]).toContain(denied.status);
    }
    const ownerLogin = await login(passwordLoginRequest(emailA, changedPassword, ownerIp));
    expect(ownerLogin.status).toBe(200);
  });

  it("binds Profile 1 only through the exact, separately enabled owner OTP bootstrap", async () => {
    const original = await prisma.profile.findUniqueOrThrow({
      where: { id: 1 },
      select: { userId: true, sex: true, dateOfBirth: true, heightCm: true },
    });
    const email = `profile-one-${crypto.randomUUID()}@example.invalid`;
    const unrelatedEmail = `unrelated-${crypto.randomUUID()}@example.invalid`;
    emails.add(email);
    emails.add(unrelatedEmail);
    const priorRegistrationEnabled = process.env.AUTH_PUBLIC_REGISTRATION_ENABLED;
    const priorBootstrapEnabled = process.env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED;
    const priorOwnerEmail = process.env.AUTH_PROFILE_ONE_OWNER_EMAIL;
    process.env.AUTH_PUBLIC_REGISTRATION_ENABLED = "false";
    process.env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED = "false";
    process.env.AUTH_PROFILE_ONE_OWNER_EMAIL = email;

    try {
      const ownerStartDisabled = await registrationStart(request({ email, name: "Legacy Owner" }));
      const unrelatedStartDisabled = await registrationStart(request({ email: unrelatedEmail, name: "Other" }));
      expect(ownerStartDisabled.status).toBe(503);
      expect(unrelatedStartDisabled.status).toBe(ownerStartDisabled.status);
      expect(await unrelatedStartDisabled.json()).toEqual(await ownerStartDisabled.json());

      const ownerResendDisabled = await registrationResend(request({ email }));
      const unrelatedResendDisabled = await registrationResend(request({ email: unrelatedEmail }));
      expect(ownerResendDisabled.status).toBe(503);
      expect(unrelatedResendDisabled.status).toBe(ownerResendDisabled.status);
      expect(await unrelatedResendDisabled.json()).toEqual(await ownerResendDisabled.json());

      process.env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED = "true";
      const unrelatedStartDuringBootstrap = await registrationStart(request({ email: unrelatedEmail, name: "Other" }));
      const unrelatedResendDuringBootstrap = await registrationResend(request({ email: unrelatedEmail }));
      expect(unrelatedStartDuringBootstrap.status).toBe(202);
      expect(await unrelatedResendDuringBootstrap.json()).toEqual(await unrelatedStartDuringBootstrap.json());
      expect(await prisma.user.findUnique({ where: { email: unrelatedEmail }, select: { id: true } })).toBeNull();

      if (original.userId) await prisma.profile.update({ where: { id: 1 }, data: { userId: null } });
      const start = await registrationStart(request({ email, name: "Legacy Owner" }));
      expect(start.status).toBe(202);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      userIds.add(user.id);
      expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);

      const verified = await auth.api.verifyEmailOTP({
        headers: new Headers({ origin }), body: { email, otp: nextOtp(email) },
      });
      expect(verified).toMatchObject({ status: true, token: null });
      const bound = await prisma.profile.findUniqueOrThrow({ where: { id: 1 }, select: { userId: true, sex: true, dateOfBirth: true, heightCm: true } });
      expect(bound).toEqual({ ...original, userId: user.id });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordChangeRequired: true } }))
        .toEqual({ passwordChangeRequired: true });
      expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(1);

      await auth.api.requestPasswordResetEmailOTP({ headers: new Headers({ origin }), body: { email } });
      await auth.api.resetPasswordEmailOTP({
        headers: new Headers({ origin }),
        body: { email, otp: nextOtp(email), password: `Owner-${crypto.randomUUID()}-pass` },
      });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordChangeRequired: true } }))
        .toEqual({ passwordChangeRequired: false });
    } finally {
      const testOwner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (testOwner) userIds.add(testOwner.id);
      await prisma.profile.updateMany({ where: { id: 1 }, data: { userId: null } });
      await prisma.profile.update({ where: { id: 1 }, data: { userId: original.userId } });
      if (priorRegistrationEnabled === undefined) delete process.env.AUTH_PUBLIC_REGISTRATION_ENABLED;
      else process.env.AUTH_PUBLIC_REGISTRATION_ENABLED = priorRegistrationEnabled;
      if (priorBootstrapEnabled === undefined) delete process.env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED;
      else process.env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED = priorBootstrapEnabled;
      if (priorOwnerEmail === undefined) delete process.env.AUTH_PROFILE_ONE_OWNER_EMAIL;
      else process.env.AUTH_PROFILE_ONE_OWNER_EMAIL = priorOwnerEmail;
    }
  });
});
