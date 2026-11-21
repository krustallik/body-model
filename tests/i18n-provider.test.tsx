/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const route = vi.hoisted(() => ({ pathname: "/login" }));

vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

import { I18nProvider, useI18n } from "@/i18n/i18n-provider";

function LocaleProbe() {
  const { locale } = useI18n();
  return <span>{locale}</span>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("I18nProvider profile locale lookup", () => {
  it.each(["/login", "/register", "/forgot-password"])("skips the protected profile lookup for anonymous users on %s", async (pathname) => {
    route.pathname = pathname;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    expect(screen.getByText("uk")).toBeTruthy();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/get-session", { cache: "no-store" });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/profile", { cache: "no-store" });
  });

  it("loads profile locale for an authenticated registration-password step", async () => {
    route.pathname = "/register";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "test-user", emailVerified: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profile: { locale: "en" } }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    expect(await screen.findByText("en")).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/get-session", { cache: "no-store" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/profile", { cache: "no-store" });
  });

  it("does not request profile data for a forced password-setup session", async () => {
    route.pathname = "/forgot-password";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { emailVerified: true, passwordChangeRequired: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/profile", { cache: "no-store" });
  });

  it("does not request profile data on password setup", () => {
    route.pathname = "/password-setup";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start a stale profile request after the auth page unmounts", async () => {
    route.pathname = "/register";
    let resolveSession!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const sessionResponse = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveSession = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(sessionResponse);
    vi.stubGlobal("fetch", fetchMock);

    const rendered = render(<I18nProvider><LocaleProbe /></I18nProvider>);
    rendered.unmount();
    resolveSession({ ok: true, json: async () => ({ user: { emailVerified: true } }) });
    await sessionResponse;
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored locale for anonymous auth pages", async () => {
    route.pathname = "/forgot-password";
    window.localStorage.setItem("bodycast-locale", "en");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    expect(await screen.findByText("en")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/profile", { cache: "no-store" });
  });

  it("still loads the saved profile locale on app routes", async () => {
    route.pathname = "/dashboard";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ profile: { locale: "en" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    expect(await screen.findByText("en")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/profile", { cache: "no-store" });
  });
});
