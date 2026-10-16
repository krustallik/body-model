/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: () => <nav>nav</nav>,
}));

import { TrainingClient } from "@/app/training/training-client";
import { MATCH_STATUS, SESSION_STATUS } from "@/modules/training/training.constants";
import styles from "@/app/training/training.module.css";

describe("Training hub UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("uses wider training hub layout shell", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs")) return Response.json({ programs: [] });
      if (url.includes("/sessions/recent")) return Response.json({ sessions: [] });
      if (url.includes("/match-attention")) return Response.json({ sessions: [] });
      if (url.includes("/stepper-workouts")) return Response.json({ workouts: [] });
      return new Response("not found", { status: 404 });
    }));

    const { container } = render(<TrainingClient />);
    await waitFor(() => expect(screen.getByText("Training")).toBeTruthy());
    expect(container.querySelector(`.${styles.trainingHubPage}`)).toBeTruthy();
    expect(container.querySelectorAll(`.${styles.trainingHubGrid}`).length).toBeGreaterThan(0);
  });

  it("shows stale publication status passed through a completed-workout return URL", async () => {
    window.history.replaceState(null, "", "/training?programsRefresh=123&finishPublication=stale");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs")) return Response.json({ programs: [] });
      if (url.includes("/sessions/recent")) return Response.json({ sessions: [] });
      if (url.includes("/match-attention")) return Response.json({ sessions: [] });
      if (url.includes("/stepper-workouts")) return Response.json({ workouts: [] });
      return new Response("not found", { status: 404 });
    }));

    render(<TrainingClient />);

    expect((await screen.findByRole("status")).textContent).toContain("Workout finished. Model publication is still updating");
    await waitFor(() => expect(new URLSearchParams(window.location.search).has("finishPublication")).toBe(false));
  });

  it("starts a free workout without requiring a program", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs")) return Response.json({ programs: [] });
      if (url.includes("/sessions/start-dynamic") && init?.method === "POST") {
        return Response.json({ session: { id: 91 } }, { status: 201 });
      }
      if (url.includes("/sessions/recent")) return Response.json({ sessions: [] });
      if (url.includes("/match-attention")) return Response.json({ sessions: [] });
      if (url.includes("/stepper-workouts")) return Response.json({ workouts: [] });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TrainingClient />);
    const start = await screen.findByRole("button", { name: "Start without a program" });
    await user.click(start);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/training/sessions/start-dynamic",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("styles Archive as a destructive control and confirms before archive", async () => {
    const user = userEvent.setup();
    let archived = false;
    let programReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs") && !url.includes("/archive") && !init?.method) {
        programReads += 1;
        if (archived) return Response.json({ programs: [] });
        return Response.json({
          programs: [{
            id: 7,
            name: "Push A",
            archivedAt: null,
            currentVersionId: 11,
            currentVersionNumber: 1,
            exerciseCount: 3,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z",
          }],
        });
      }
      if (url.includes("/sessions/recent")) return Response.json({ sessions: [] });
      if (url.includes("/match-attention")) return Response.json({ sessions: [] });
      if (url.includes("/stepper-workouts")) return Response.json({ workouts: [] });
      if (url.includes("/archive") && init?.method === "POST") {
        archived = true;
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<TrainingClient />);
    await waitFor(() => expect(screen.getByText("Push A")).toBeTruthy());

    const archive = screen.getByRole("button", { name: "Archive" });
    expect(archive.className).toContain(styles.archiveButton);
    await user.click(archive);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/training/programs/7/archive",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => expect(screen.queryByText("Push A")).toBeNull());
    expect(programReads).toBe(1);
  });

  it("deletes a completed diary session after explaining cascaded diary data and refreshes immediately", async () => {
    const user = userEvent.setup();
    let deleted = false;
    let recentReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs") && !init?.method) return Response.json({ programs: [] });
      if (url.includes("/sessions/recent")) {
        recentReads += 1;
        return Response.json({ sessions: deleted ? [] : [{
          id: 12,
          status: SESSION_STATUS.COMPLETED,
          entryMode: "LIVE",
          programId: null,
          programName: null,
          webStartedAt: "2026-09-17T15:54:00.000Z",
          webEndedAt: "2026-09-17T15:58:00.000Z",
          occurrenceAt: "2026-09-17T15:54:00.000Z",
          matchStatus: MATCH_STATUS.UNMATCHED,
          matchMethod: null,
          matchedWorkoutId: 987,
          planCompletionPercent: null,
        }] });
      }
      if (url.includes("/match-attention")) return Response.json({ sessions: [] });
      if (url.includes("/stepper-workouts")) return Response.json({ workouts: [] });
      if (url.endsWith("/api/v1/training/sessions/12") && init?.method === "DELETE") {
        deleted = true;
        return Response.json({ deleted: true, matchedWorkoutId: 987, modelPublicationStatus: "stale" });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<TrainingClient />);
    await screen.findByText("Free workout");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Free workout")).toBeNull());
    expect(await screen.findByText("No sessions yet.")).toBeTruthy();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("sets, and accounting snapshots"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Garmin and Apple Health"));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/training/sessions/12", { method: "DELETE" });
    expect((await screen.findByRole("status")).textContent).toContain("Model publication is still updating");
    expect(recentReads).toBeGreaterThanOrEqual(2);
  });

  it("omits empty match-attention while retaining recent session details", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs")) return Response.json({ programs: [] });
      if (url.includes("/sessions/recent")) {
        return Response.json({
          sessions: [{
            id: 1,
            status: SESSION_STATUS.COMPLETED,
            entryMode: "LIVE",
            programId: 7,
            programName: "Push A",
            webStartedAt: "2026-09-17T15:54:00.000Z",
            webEndedAt: "2026-09-17T15:58:00.000Z",
            occurrenceAt: "2026-09-17T15:54:00.000Z",
            matchStatus: MATCH_STATUS.UNMATCHED,
            matchMethod: null,
            matchedWorkoutId: null,
            planCompletionPercent: 100,
          }],
        });
      }
      if (url.includes("/match-attention")) return Response.json({ sessions: [] });
      if (url.includes("/stepper-workouts")) return Response.json({ workouts: [] });
      return new Response("not found", { status: 404 });
    }));

    const { container } = render(<TrainingClient />);
    await waitFor(() => {
      expect(screen.getByText(/Unmatched/i)).toBeTruthy();
      expect(screen.getByText("100% of plan")).toBeTruthy();
    });
    expect(screen.getByText("100% of plan").className).toContain(styles.planCompletionComplete);
    const sections = Array.from(container.querySelectorAll("section"));
    const recentIndex = sections.findIndex((node) => (
      node.getAttribute("aria-label") === "Recent strength sessions"
    ));
    expect(sections.some((node) => node.getAttribute("aria-label") === "Match attention")).toBe(false);
    expect(recentIndex).toBeGreaterThanOrEqual(0);
    expect(screen.queryByText(/No sessions need attention/i)).toBeNull();
    expect(screen.queryByRole("region", { name: "Active session" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start without a program" })).toBeTruthy();
  });

  it("surfaces match-attention above active session when items exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs")) return Response.json({ programs: [] });
      if (url.includes("/sessions/recent")) return Response.json({ sessions: [] });
      if (url.includes("/match-attention")) {
        return Response.json({
          sessions: [{
            id: 9,
            status: SESSION_STATUS.COMPLETED,
            entryMode: "LIVE",
            programId: 7,
            programName: "Push A",
            webStartedAt: "2026-09-16T12:00:00.000Z",
            webEndedAt: "2026-09-16T13:00:00.000Z",
            occurrenceAt: "2026-09-16T12:00:00.000Z",
            matchStatus: MATCH_STATUS.AMBIGUOUS,
            matchMethod: null,
            matchedWorkoutId: null,
          }],
        });
      }
      if (url.includes("/stepper-workouts")) return Response.json({ workouts: [] });
      return new Response("not found", { status: 404 });
    }));

    const { container } = render(<TrainingClient />);
    await waitFor(() => {
      expect(screen.getByText("Ambiguous")).toBeTruthy();
    });
    const sections = Array.from(container.querySelectorAll("section"));
    expect(sections[0]?.getAttribute("aria-label")).toBe("Match attention");
  });
});
