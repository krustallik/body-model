import { beforeEach, describe, expect, it, vi } from "vitest";

const trainingService = vi.hoisted(() => ({
  listMatchAttention: vi.fn(),
  listMatchCandidates: vi.fn(),
  manualMatch: vi.fn(),
}));

vi.mock("@/modules/training/training.service", () => ({ trainingService }));

import { GET as ATTENTION } from "@/app/api/v1/training/sessions/match-attention/route";
import { GET as CANDIDATES } from "@/app/api/v1/training/sessions/[id]/match-candidates/route";
import { POST as MATCH } from "@/app/api/v1/training/sessions/[id]/match/route";
import {
  SessionNotFoundError,
  WorkoutAlreadyMatchedError,
  WorkoutNotEligibleError,
} from "@/modules/training/training.errors";
import { MATCH_METHOD, MATCH_STATUS, SESSION_STATUS } from "@/modules/training/training.constants";

const base = "http://localhost/api/v1/training/sessions";
const candidates = [{
  id: 100,
  type: "Traditional Strength Training",
  startAt: "2026-09-17T16:02:00.000Z",
  endAt: "2026-09-17T17:00:00.000Z",
  durationMinutes: 58,
  activeEnergyKcal: 410,
  externalId: "garmin-1",
  alreadyMatched: false,
}];
const matchedSession = {
  id: 42,
  status: SESSION_STATUS.COMPLETED,
  programId: 7,
  programName: "Моє тренування",
  programVersionId: 11,
  programVersionNumber: 1,
  webStartedAt: "2026-09-17T16:00:00.000Z",
  webEndedAt: "2026-09-17T17:00:00.000Z",
  matchStatus: MATCH_STATUS.MATCHED,
  matchMethod: MATCH_METHOD.MANUAL,
  matchedAt: "2026-09-17T17:05:00.000Z",
  matchedWorkoutId: 100,
  matchedWorkout: candidates[0],
  exercises: [],
  ordinaryTonnageKg: null,
  createdAt: "2026-09-17T16:00:00.000Z",
  updatedAt: "2026-09-17T17:05:00.000Z",
};

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sessionCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/v1/training matching routes", () => {
  beforeEach(() => {
    Object.values(trainingService).forEach((mock) => mock.mockReset());
  });

  it("lists match-attention sessions", async () => {
    trainingService.listMatchAttention.mockResolvedValue([{ id: 42, matchStatus: MATCH_STATUS.AMBIGUOUS }]);
    const response = await ATTENTION();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessions: [{ id: 42, matchStatus: MATCH_STATUS.AMBIGUOUS }],
    });
    expect(trainingService.listMatchAttention).toHaveBeenCalledOnce();
  });

  it("returns match candidates for a session", async () => {
    trainingService.listMatchCandidates.mockResolvedValue(candidates);
    const response = await CANDIDATES(new Request(`${base}/42/match-candidates`), sessionCtx("42"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ candidates });
    expect(trainingService.listMatchCandidates).toHaveBeenCalledWith(42);
  });

  it("rejects invalid session id for candidates without service call", async () => {
    const response = await CANDIDATES(
      new Request(`${base}/nope/match-candidates`),
      sessionCtx("nope"),
    );
    expect(response.status).toBe(400);
    expect(trainingService.listMatchCandidates).not.toHaveBeenCalled();
  });

  it("maps candidates not-found to 404", async () => {
    trainingService.listMatchCandidates.mockRejectedValue(new SessionNotFoundError());
    const response = await CANDIDATES(new Request(`${base}/42/match-candidates`), sessionCtx("42"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "session_not_found" });
  });

  it("applies a valid manual match", async () => {
    trainingService.manualMatch.mockResolvedValue(matchedSession);
    const response = await MATCH(
      jsonRequest(`${base}/42/match`, "POST", { workoutId: 100 }),
      sessionCtx("42"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: matchedSession });
    expect(trainingService.manualMatch).toHaveBeenCalledWith(42, { workoutId: 100 });
  });

  it("allows explicit unmatched finalize via workoutId=null", async () => {
    const unmatched = {
      ...matchedSession,
      matchStatus: MATCH_STATUS.UNMATCHED,
      matchedWorkoutId: null,
      matchedWorkout: null,
    };
    trainingService.manualMatch.mockResolvedValue(unmatched);
    const response = await MATCH(
      jsonRequest(`${base}/42/match`, "POST", { workoutId: null }),
      sessionCtx("42"),
    );
    expect(response.status).toBe(200);
    expect(trainingService.manualMatch).toHaveBeenCalledWith(42, { workoutId: null });
  });

  it("rejects invalid match body without mutation", async () => {
    const response = await MATCH(
      jsonRequest(`${base}/42/match`, "POST", { workoutId: "garmin" }),
      sessionCtx("42"),
    );
    expect(response.status).toBe(400);
    expect(trainingService.manualMatch).not.toHaveBeenCalled();
  });

  it("maps ineligible candidate to 400", async () => {
    trainingService.manualMatch.mockRejectedValue(new WorkoutNotEligibleError());
    const response = await MATCH(
      jsonRequest(`${base}/42/match`, "POST", { workoutId: 100 }),
      sessionCtx("42"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "workout_not_eligible" });
  });

  it("maps already-owned workout to 409", async () => {
    trainingService.manualMatch.mockRejectedValue(new WorkoutAlreadyMatchedError());
    const response = await MATCH(
      jsonRequest(`${base}/42/match`, "POST", { workoutId: 100 }),
      sessionCtx("42"),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "workout_already_matched" });
  });

  it("maps match not-found to 404", async () => {
    trainingService.manualMatch.mockRejectedValue(new SessionNotFoundError());
    const response = await MATCH(
      jsonRequest(`${base}/42/match`, "POST", { workoutId: 100 }),
      sessionCtx("42"),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "session_not_found" });
  });
});
