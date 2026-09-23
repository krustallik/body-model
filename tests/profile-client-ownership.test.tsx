/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const localeState = vi.hoisted(() => ({ current: "en" as "en" | "uk" }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: localeState.current, setLocale: vi.fn() }),
}));
vi.mock("@/components/app-nav", () => ({ AppNav: () => <nav /> }));

import { ProfileClient } from "@/app/settings/profile/profile-client";

const legacyProfile = {
  id: 1,
  locale: "en" as const,
  sex: "female" as const,
  dateOfBirth: "1990-01-01",
  heightCm: 180,
  targetWeightKg: 51,
  targetDate: "2030-01-01",
  autoAdvanceExercises: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localeState.current = "en";
});

describe("ProfileClient goal ownership", () => {
  it.each([
    ["en", "Your profile.", "Target weight", "Target date"],
    ["uk", "Ваш профіль.", "Цільова вага", "Цільова дата"],
  ] as const)("shows profile-only fields and copy in %s", async (locale, heading, oldWeightLabel, oldDateLabel) => {
    localeState.current = locale;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/profile") return Response.json({ profile: legacyProfile });
      if (url === "/api/v1/profile/stepper-equipment") return Response.json({ assignments: [] });
      throw new Error(`unexpected ${url}`);
    }));

    render(<ProfileClient />);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByLabelText(/Height|Зріст/)).toBeTruthy();
    expect(screen.queryByText(oldWeightLabel)).toBeNull();
    expect(screen.queryByText(oldDateLabel)).toBeNull();
    expect(screen.queryByLabelText(oldWeightLabel)).toBeNull();
    expect(screen.queryByLabelText(oldDateLabel)).toBeNull();
  });

  it("submits other profile inputs without legacy goal values", async () => {
    let updatePayload: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/profile" && init?.method === "PUT") {
        updatePayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ profile: legacyProfile });
      }
      if (url === "/api/v1/profile") return Response.json({ profile: legacyProfile });
      if (url === "/api/v1/profile/stepper-equipment") return Response.json({ assignments: [] });
      throw new Error(`unexpected ${url}`);
    }));

    const user = userEvent.setup();
    render(<ProfileClient />);
    const height = await screen.findByLabelText(/Height/);
    await user.clear(height);
    await user.type(height, "181.5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updatePayload).toMatchObject({
      locale: "en",
      sex: "female",
      dateOfBirth: "1990-01-01",
      heightCm: "181.5",
      autoAdvanceExercises: false,
    });
    expect(updatePayload).not.toHaveProperty("targetWeightKg");
    expect(updatePayload).not.toHaveProperty("targetDate");
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});
