/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams("returnTo=%2Ftraining%3FrecentPage%3D2"),
}));
vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));
vi.mock("@/components/app-nav", () => ({ AppNav: () => <nav>nav</nav> }));
vi.mock("@/app/training/exercise-load-config-editor", () => ({ ExerciseLoadConfigEditor: () => null }));

import { ProgramEditorClient } from "@/app/training/program-editor";

describe("Training program editor return context", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigation.push.mockReset();
    navigation.refresh.mockReset();
  });

  it("returns to the same hub page and refreshes after saving a program", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [{
        id: 5,
        name: "Push up",
        stableKey: "pushup",
        isActive: true,
        archivedAt: null,
        muscleMapping: null,
        loadAccountingConfig: null,
      }] });
      if (url === "/api/v1/training/programs" && init?.method === "POST") return Response.json({ program: { id: 11 } });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProgramEditorClient />);
    await user.type(await screen.findByLabelText("Name"), "Push day");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(expect.stringMatching(/^\/training\?recentPage=2&programsRefresh=\d+$/)));
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/training/programs", expect.objectContaining({ method: "POST" }));
  });

  it("returns to the same hub page and refreshes after archiving a program", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/training/exercises") return Response.json({ exercises: [] });
      if (url === "/api/v1/training/programs/7" && !init?.method) {
        return Response.json({ program: { name: "Push day", exercises: [] } });
      }
      if (url === "/api/v1/training/programs/7/archive" && init?.method === "POST") return Response.json({ ok: true });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ProgramEditorClient programId={7} />);
    await user.click(await screen.findByRole("button", { name: "Archive" }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(expect.stringMatching(/^\/training\?recentPage=2&programsRefresh=\d+$/)));
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/training/programs/7/archive", { method: "POST" });
  });
});
