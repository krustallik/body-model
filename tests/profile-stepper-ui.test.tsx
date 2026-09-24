/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: "en", setLocale: vi.fn() }) }));
vi.mock("@/components/app-nav", () => ({ AppNav: () => <nav /> }));
import { ProfileClient } from "@/app/settings/profile/profile-client";

const profile = { id: 1, locale: "en", sex: "male", dateOfBirth: "1990-01-01", heightCm: 180, targetWeightKg: null, targetDate: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("ProfileClient stepper equipment", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("does not expose configurable stepper equipment in the profile", async () => {
    const fetchMock = vi.fn(async () => Response.json({ profile }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProfileClient />);
    expect(await screen.findByRole("heading", { name: "Your profile." })).toBeTruthy();
    expect(screen.queryByText(/MS100/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
