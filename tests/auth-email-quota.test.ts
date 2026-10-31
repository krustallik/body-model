import { beforeEach, describe, expect, it, vi } from "vitest";

const quotaMocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  consume: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getEnv: quotaMocks.getEnv }));
vi.mock("@/modules/auth/rate-limit", () => ({ consumeApplicationAuthLimit: quotaMocks.consume }));

import { reservePublicOtpEmailQuota } from "@/modules/auth/email-quota";

describe("public OTP email budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quotaMocks.getEnv.mockReturnValue({
      AUTH_EMAIL_PUBLIC_OTP_DAILY_LIMIT: 20,
      AUTH_EMAIL_DAILY_LIMIT: 250,
    });
    quotaMocks.consume.mockResolvedValue({ allowed: true, retryAfter: null });
  });

  it("takes its own daily reservation below the shared provider quota", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await expect(reservePublicOtpEmailQuota()).resolves.toBeUndefined();
    expect(quotaMocks.consume).toHaveBeenCalledExactlyOnceWith(
      `bodycast:brevo:public-otp:${day}`,
      86_400,
      20,
    );
  });

  it.each([
    [undefined, 250],
    [250, 250],
    [251, 250],
  ])("fails closed when public OTP has no strictly smaller budget (%s / %s)", async (publicLimit, globalLimit) => {
    quotaMocks.getEnv.mockReturnValue({
      AUTH_EMAIL_PUBLIC_OTP_DAILY_LIMIT: publicLimit,
      AUTH_EMAIL_DAILY_LIMIT: globalLimit,
    });
    await expect(reservePublicOtpEmailQuota()).rejects.toThrow("below the shared daily email quota");
    expect(quotaMocks.consume).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic public OTP budget is exhausted", async () => {
    quotaMocks.consume.mockResolvedValue({ allowed: false, retryAfter: 86_400 });
    await expect(reservePublicOtpEmailQuota()).rejects.toThrow("Public OTP email quota");
  });
});
