/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", intlLocale: "en-US", setLocale: () => undefined }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  });

  it("uses wider training hub layout shell", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs")) return Response.json({ programs: [] });
      if (url.includes("/sessions/recent")) return Response.json({ sessions: [] });
      if (url.includes("/match-attention")) return Response.json({ sessions: [] });
      return new Response("not found", { status: 404 });
    }));

    const { container } = render(<TrainingClient />);
    await waitFor(() => expect(screen.getByText("Training")).toBeTruthy());
    expect(container.querySelector(`.${styles.trainingHubPage}`)).toBeTruthy();
    expect(container.querySelectorAll(`.${styles.trainingHubGrid}`).length).toBeGreaterThan(0);
  });

  it("styles Archive as a destructive control and confirms before archive", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sessions/active")) return Response.json({ session: null });
      if (url.includes("/programs") && !url.includes("/archive") && !init?.method) {
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
      if (url.includes("/archive") && init?.method === "POST") {
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
  });

  it("keeps empty match-attention compact at the bottom", async () => {
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
      return new Response("not found", { status: 404 });
    }));

    const { container } = render(<TrainingClient />);
    await waitFor(() => {
      expect(screen.getByText(/Unmatched/i)).toBeTruthy();
      expect(screen.getByText(/No sessions need attention/i)).toBeTruthy();
      expect(screen.getByText("100% of plan")).toBeTruthy();
    });
    expect(screen.getByText("100% of plan").className).toContain(styles.planCompletionComplete);
    const sections = Array.from(container.querySelectorAll("section"));
    const attentionIndex = sections.findIndex((node) => (
      node.getAttribute("aria-label") === "Match attention"
    ));
    const recentIndex = sections.findIndex((node) => (
      node.getAttribute("aria-label") === "Recent strength sessions"
    ));
    expect(attentionIndex).toBeGreaterThan(recentIndex);
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
