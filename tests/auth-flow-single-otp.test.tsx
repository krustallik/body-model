/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: "en" }) }));

import { AuthFlow } from "@/app/auth-flow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("single-OTP public registration", () => {
  it("moves from verified email straight to password creation without a second code", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/registration/start") return Response.json({ requestReceived: true }, { status: 202 });
      if (path === "/api/auth/email-otp/verify-email") return Response.json({ status: true });
      if (path === "/api/account/bootstrap-status") {
        return Response.json({ passwordChangeRequired: false, onboardingRequired: false });
      }
      if (path === "/api/registration/password-setup") return Response.json({ completed: true });
      throw new Error(`Unexpected auth request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AuthFlow mode="register" />);
    await user.type(screen.getByLabelText("Email"), "new.person@example.invalid");
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Email verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByLabelText("Create password")).toBeTruthy();
    expect(screen.getByLabelText("Repeat password")).toBeTruthy();
    expect(screen.queryByLabelText("One-time code")).toBeNull();
    expect(screen.queryByLabelText("Email verification code")).toBeNull();
    expect(screen.getByText("Email verified. Create a password to finish registration.")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/registration/password-reset/request");

    await user.type(screen.getByLabelText("Create password"), "Synthetic-Test-Password-123");
    await user.type(screen.getByLabelText("Repeat password"), "Synthetic-Test-Password-123");
    await user.click(screen.getByRole("button", { name: "Create password" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/registration/password-setup", expect.objectContaining({
      body: JSON.stringify({ password: "Synthetic-Test-Password-123" }),
    }));
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });
});
