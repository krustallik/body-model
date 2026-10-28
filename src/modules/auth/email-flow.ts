import { logEvent } from "@/lib/logger";

export async function runAuthEmailFlow(action: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    // Never log an OTP, email address, or provider response body.
    logEvent("warn", "auth_email_flow_failed", {
      action,
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
}
