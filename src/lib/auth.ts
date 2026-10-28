import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { sendAuthEmail } from "@/modules/auth/email";
import { provisionProfileAfterEmailVerification } from "@/modules/auth/profile-provisioning";
import { databaseAuthRateLimitStorage } from "@/modules/auth/rate-limit";

const env = getEnv();
const baseURL = env.BETTER_AUTH_URL ?? "http://localhost:3000";
const trustedOrigins = [baseURL, ...(env.AUTH_TRUSTED_ORIGINS ?? "").split(",")]
  .filter((origin): origin is string => Boolean(origin?.trim()))
  .map((origin) => new URL(origin.trim()).origin);
const trustedProxies = (env.AUTH_TRUSTED_PROXIES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const developmentSecret = "bodycast-local-development-only-secret-change-me";
const secret = env.BETTER_AUTH_SECRET ?? (env.NODE_ENV === "production" ? undefined : developmentSecret);
if (!secret) throw new Error("BETTER_AUTH_SECRET must be configured before BodyCast auth can start");

export const auth = betterAuth({
  appName: "BodyCast",
  baseURL,
  secret,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  user: {
    additionalFields: {
      passwordChangeRequired: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      await prisma.user.updateMany({
        where: { id: user.id, emailVerified: true, profile: { isNot: null } },
        data: { passwordChangeRequired: false },
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    afterEmailVerification: provisionProfileAfterEmailVerification,
  },
  plugins: [emailOTP({
    overrideDefaultEmailVerification: true,
    disableSignUp: true,
    expiresIn: 300,
    allowedAttempts: 3,
    storeOTP: "hashed",
    resendStrategy: "rotate",
    sendVerificationOTP: async ({ email, otp, type }) => {
      const purpose = type === "email-verification" ? "verify"
        : type === "change-email" ? "change" : "reset";
      await sendAuthEmail({ email, code: otp, purpose });
    },
  })],
  disabledPaths: [
    "/sign-up/email",
    "/sign-in/email",
    "/sign-in/email-otp",
    "/email-otp/send-verification-otp",
    "/email-otp/check-verification-otp",
    "/email-otp/request-password-reset",
    "/email-otp/reset-password",
    "/forget-password/email-otp",
    "/change-password",
    "/set-password",
    "/forget-password",
    "/reset-password",
    "/send-verification-email",
    "/verify-email",
    "/change-email",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
    "/delete-user",
    "/delete-user/callback",
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customStorage: databaseAuthRateLimitStorage,
  },
  session: {
    cookieCache: { enabled: false },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
    },
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
      trustedProxies,
    },
  },
});

export { trustedOrigins };
