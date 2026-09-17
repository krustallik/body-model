/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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

describe("Training hub UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    });
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
