import { beforeEach, describe, expect, it, vi } from "vitest";

const { scheduled, logEvent } = vi.hoisted(() => ({
  scheduled: [] as Array<() => Promise<void>>,
  logEvent: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => { scheduled.push(callback); } }));
vi.mock("@/lib/logger", () => ({ logEvent }));

import { runAuthEmailFlow } from "@/modules/auth/email-flow";

describe("post-response auth email flows", () => {
  beforeEach(() => {
    scheduled.length = 0;
    vi.clearAllMocks();
  });

  it("returns before account-specific work or a slow provider completes", async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));

    await expect(runAuthEmailFlow("password-reset-request", task)).resolves.toBeUndefined();
    expect(task).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    const completion = scheduled[0]!();
    expect(task).toHaveBeenCalledOnce();
    release();
    await completion;
  });

  it("contains provider failures and runs concurrent flows independently", async () => {
    const failure = new Error("provider failed");
    const first = vi.fn().mockRejectedValue(failure);
    const second = vi.fn().mockResolvedValue(undefined);

    await runAuthEmailFlow("registration-start", first);
    await runAuthEmailFlow("registration-resend", second);
    await Promise.all(scheduled.map((run) => run()));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(logEvent).toHaveBeenCalledWith("warn", "auth_email_flow_failed", {
      action: "registration-start",
      errorType: "Error",
    });
    expect(logEvent).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ email: expect.anything(), otp: expect.anything() }));
  });
});
