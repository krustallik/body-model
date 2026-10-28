import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  forecastModelEpisode: vi.fn(),
  getModelStatus: vi.fn(),
  recalculateModelEpisode: vi.fn(),
}));
const authAccess = vi.hoisted(() => ({ getSessionPrincipal: vi.fn() }));
const trainingFence = vi.hoisted(() => ({ read: vi.fn(), pending: vi.fn() }));
vi.mock("@/modules/auth/access", () => authAccess);
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/training/training-refresh-queue", () => ({
  readTrainingRefreshVisibilityFence: trainingFence.read,
  isTrainingRefreshPending: trainingFence.pending,
}));
vi.mock("@/modules/model-forecast/model-forecast.service", () => ({
  forecastModelEpisode: services.forecastModelEpisode,
}));
vi.mock("@/modules/model-episodes/model-episode.service", () => ({
  getModelStatus: services.getModelStatus,
  recalculateModelEpisode: services.recalculateModelEpisode,
}));

import { POST } from "@/app/api/forecast/route";
import { ForecastScenarioEvidenceError, ForecastUnavailableError } from "@/modules/model-forecast/model-forecast.errors";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";

const validBody = { horizonDays: 7, scenario: { mode: "recent-behavior" } };
function request(body: unknown) { return new Request("http://localhost/api/forecast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("forecast application route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 1, userId: "user-1", method: "session" });
    services.getModelStatus.mockResolvedValue({ daysModeled: 28, latestModeledDate: "2026-08-24" });
    trainingFence.read.mockResolvedValue({ requestedGeneration: 1, completedGeneration: 1 });
    trainingFence.pending.mockReturnValue(false);
  });

  it("validates and delegates to the real application service with the stable seed", async () => {
    expect((await POST(request({ horizonDays: 0 }))).status).toBe(400);
    services.forecastModelEpisode.mockResolvedValue({ status: "ok", dates: [] });
    expect((await POST(request(validBody))).status).toBe(200);
    expect(services.forecastModelEpisode).toHaveBeenCalledWith({ ...validBody, profileId: 1, seed: 20_260_824 });
    expect(services.recalculateModelEpisode).not.toHaveBeenCalled();
  });

  it("persists model days before forecasting when DailyModelState is still empty", async () => {
    services.getModelStatus.mockResolvedValue({ daysModeled: 0, latestModeledDate: null });
    services.recalculateModelEpisode.mockResolvedValue({ status: "ok", daysPersisted: 28 });
    services.forecastModelEpisode.mockResolvedValue({ status: "ok", dates: [] });
    expect((await POST(request(validBody))).status).toBe(200);
    expect(services.recalculateModelEpisode).toHaveBeenCalledWith({ profileId: 1 });
    expect(services.forecastModelEpisode).toHaveBeenCalledWith({ ...validBody, profileId: 1, seed: 20_260_824 });
  });

  it("does not persist an intermediate model while Training publication is pending", async () => {
    trainingFence.pending.mockReturnValue(true);
    services.forecastModelEpisode.mockResolvedValue({ status: "ok", dates: [] });

    expect((await POST(request(validBody))).status).toBe(200);
    expect(services.getModelStatus).not.toHaveBeenCalled();
    expect(services.recalculateModelEpisode).not.toHaveBeenCalled();
    expect(services.forecastModelEpisode).toHaveBeenCalledWith({ ...validBody, profileId: 1, seed: 20_260_824 });
  });

  it("skips persistence when there is no active episode yet", async () => {
    services.getModelStatus.mockRejectedValue(new NoActiveModelEpisodeError());
    services.forecastModelEpisode.mockRejectedValue(new NoActiveModelEpisodeError());
    expect((await POST(request(validBody))).status).toBe(404);
    expect(services.recalculateModelEpisode).not.toHaveBeenCalled();
  });

  it("turns missing recent-behavior evidence into an actionable 422 response", async () => {
    services.forecastModelEpisode.mockRejectedValue(new ForecastScenarioEvidenceError("Need seven reliable donor days"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "insufficient_scenario_evidence", message: "Need seven reliable donor days" });
  });

  it("returns an actionable bootstrap CTA when no weight exists", async () => {
    services.forecastModelEpisode.mockRejectedValue(new ForecastUnavailableError("missing-weight"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "forecast_unavailable", reason: "missing-weight" });
  });

  it("does not leak unexpected exceptions", async () => {
    services.forecastModelEpisode.mockRejectedValue(new Error("secret database detail"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "forecast_failed" });
  });

  it("allows concurrent forecasts for different Profiles while preserving same-profile locking", async () => {
    let resolveBothEntered!: () => void;
    let resolveFirstEntered!: () => void;
    const bothEntered = new Promise<void>((resolve) => { resolveBothEntered = resolve; });
    const firstEntered = new Promise<void>((resolve) => { resolveFirstEntered = resolve; });
    const resolvers = new Map<number, (value: { status: string; dates: unknown[] }) => void>();
    services.forecastModelEpisode.mockImplementation((input: { profileId: number }) => new Promise((resolve) => {
      resolvers.set(input.profileId, resolve);
      if (resolvers.size === 1) resolveFirstEntered();
      if (resolvers.size === 2) resolveBothEntered();
    }));

    authAccess.getSessionPrincipal.mockResolvedValueOnce({ profileId: 101, userId: "user-a", method: "session" });
    const first = POST(request(validBody));
    await firstEntered;
    authAccess.getSessionPrincipal.mockResolvedValueOnce({ profileId: 202, userId: "user-b", method: "session" });
    const second = POST(request(validBody));
    await bothEntered;
    expect([...resolvers.keys()].sort()).toEqual([101, 202]);
    resolvers.get(101)?.({ status: "ok", dates: [] });
    resolvers.get(202)?.({ status: "ok", dates: [] });
    const responses = await Promise.all([first, second]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
  });
});
