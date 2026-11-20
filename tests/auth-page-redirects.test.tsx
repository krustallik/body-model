import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { userId: string; email: string; profileId: number; passwordChangeRequired: boolean },
  credentialPassword: "hashed-password" as string | null,
  redirect: vi.fn((path: string) => {
    throw new Error("REDIRECT:" + path);
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("@/modules/auth/access", () => ({
  getAuthenticatedUser: async () => state.user,
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { account: { findFirst: async () => state.credentialPassword ? { password: state.credentialPassword } : null } },
}));

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

beforeEach(() => {
  vi.clearAllMocks();
  state.user = null;
  state.credentialPassword = "hashed-password";
});

describe("anonymous-only auth pages", () => {
  it.each([
    ["login", LoginPage],
    ["register", RegisterPage],
  ] as const)("allows an anonymous visitor to open %s", async (_name, page) => {
    expect(await page()).toBeTruthy();
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["login", LoginPage],
    ["register", RegisterPage],
  ] as const)("redirects a signed-in visitor away from %s", async (_name, page) => {
    state.user = {
      userId: "verified-user",
      email: "person@example.invalid",
      profileId: 7,
      passwordChangeRequired: false,
    };

    await expect(page()).rejects.toThrow("REDIRECT:/dashboard");
    expect(state.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("keeps the mandatory first-password setup route for an authenticated user", async () => {
    state.user = {
      userId: "verified-user",
      email: "person@example.invalid",
      profileId: 7,
      passwordChangeRequired: true,
    };

    await expect(LoginPage()).rejects.toThrow("REDIRECT:/password-setup");
    await expect(RegisterPage()).rejects.toThrow("REDIRECT:/password-setup");
  });

  it("continues verified users without a credential to the password-creation step", async () => {
    state.user = {
      userId: "verified-user",
      email: "person@example.invalid",
      profileId: 7,
      passwordChangeRequired: false,
    };
    state.credentialPassword = null;

    await expect(LoginPage()).rejects.toThrow("REDIRECT:/register");
    expect(state.redirect).toHaveBeenCalledWith("/register");
  });
});
