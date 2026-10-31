import { getEnv } from "@/lib/env";
import { consumeApplicationAuthLimit } from "./rate-limit";

export async function reservePublicOtpEmailQuota(): Promise<void> {
  const env = getEnv();
  const max = env.AUTH_EMAIL_PUBLIC_OTP_DAILY_LIMIT;
  if (max === undefined || max >= env.AUTH_EMAIL_DAILY_LIMIT) {
    throw new Error("Public OTP email quota must be configured below the shared daily email quota");
  }

  const day = new Date().toISOString().slice(0, 10);
  const quota = await consumeApplicationAuthLimit(`bodycast:brevo:public-otp:${day}`, 86_400, max);
  if (!quota.allowed) throw new Error("Public OTP email quota has been reached");
}
