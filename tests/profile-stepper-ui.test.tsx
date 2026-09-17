/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ locale: "en", setLocale: vi.fn() }) }));
vi.mock("@/components/app-nav", () => ({ AppNav: () => <nav /> }));
import { ProfileClient } from "@/app/settings/profile/profile-client";

const profile = { id: 1, locale: "en", sex: "male", dateOfBirth: "1990-01-01", heightCm: 180, targetWeightKg: null, targetDate: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const assignment = { id: 1, machineFamily: "DOMYOS_MS100", configuration: "fixed", effectiveFrom: "2026-09-01T10:00:00.000Z", effectiveTo: null, createdAt: "2026-09-01T10:00:00.000Z" };

describe("ProfileClient stepper equipment", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("shows the active MS100 assignment and adds a later historical version", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/profile") return Response.json({ profile });
      if (url === "/api/v1/profile/stepper-equipment" && !init?.method) return Response.json({ assignments: [assignment] });
      if (url === "/api/v1/profile/stepper-equipment" && init?.method === "POST") return Response.json({ assignment: { ...assignment, id: 2, effectiveFrom: "2026-09-20T10:00:00.000Z" } }, { status: 201 });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProfileClient />);
    expect(await screen.findByText(/Current configuration since/)).toBeTruthy();
    expect(screen.getByText("DOMYOS MS100 · fixed")).toBeTruthy();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-09-20T10:00" } });
    await user.click(screen.getByRole("button", { name: "Change from this date" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/profile/stepper-equipment", expect.objectContaining({ method: "POST" })));
    expect((await screen.findAllByText("DOMYOS MS100 · fixed")).length).toBe(2);
  });
});
