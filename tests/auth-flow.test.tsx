/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const localeState = vi.hoisted(() => ({ current: "en" as "en" | "uk" }));
const routerState = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => routerState }));
vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: localeState.current }) }));

import { AuthFlow } from "@/app/auth-flow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localeState.current = "en";
});

describe("AuthFlow", () => {
  it("asks before sending a password-change code and presents the expiry after sending", async () => {
    const fetchMock = vi.fn(async () => Response.json({ accepted: true }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AuthFlow mode="change-password" signedInEmail="person@example.invalid" />);

    expect(screen.queryByLabelText("One-time code from email")).toBeNull();
    expect(screen.getByText("person@example.invalid")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Send code to email" }));

    expect(await screen.findByLabelText("Six-digit email code")).toBeTruthy();
    expect(screen.getByText("Code expires in 5:00.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/account/password-change/request", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      credentials: "same-origin",
    }));
  });

  it("uses the email-verification code once, then creates the password without another code", async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path === "/api/registration/start") return Response.json({ requestReceived: true }, { status: 202 });
      if (path === "/api/auth/email-otp/verify-email") return Response.json({ success: true });
      if (path === "/api/account/bootstrap-status") return Response.json({ passwordChangeRequired: false, onboardingRequired: false });
      if (path === "/api/registration/password-setup") return Response.json({ completed: true });
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AuthFlow mode="register" />);

    await user.type(screen.getByLabelText("Email"), "new.person@example.invalid");
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    expect(await screen.findByLabelText("Six-digit email code")).toBeTruthy();

    await user.type(screen.getByLabelText("Six-digit email code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByText("Email verified. Create a password to finish registration.")).toBeTruthy();
    expect(screen.getByLabelText(/New password/)).toBeTruthy();
    expect(screen.queryByLabelText("Six-digit email code")).toBeNull();
    expect(screen.queryByLabelText("One-time code from email")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/email-otp/verify-email", expect.objectContaining({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new.person@example.invalid", otp: "123456" }),
    }));
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain("/api/registration/password-reset/request");

    await user.type(screen.getByLabelText("New password"), "Synthetic-Test-Password-123");
    await user.type(screen.getByLabelText("Confirm new password"), "Synthetic-Test-Password-123");
    await user.click(screen.getByRole("button", { name: "Create password" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/registration/password-setup", expect.objectContaining({
      body: JSON.stringify({ password: "Synthetic-Test-Password-123" }),
    }));
    expect(routerState.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("keeps wrong OTP errors actionable and leaves the protected action disabled", async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path === "/api/registration/start") return Response.json({ requestReceived: true }, { status: 202 });
      if (path === "/api/auth/email-otp/verify-email") return Response.json({ error: "invalid_code" }, { status: 400 });
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AuthFlow mode="register" />);

    await user.type(screen.getByLabelText("Email"), "new.person@example.invalid");
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));
    await user.type(await screen.findByLabelText("Six-digit email code"), "111111");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    expect((await screen.findByRole("alert")).textContent).toContain("That code did not match");
    expect(screen.queryByLabelText("New password")).toBeNull();
  });
});
