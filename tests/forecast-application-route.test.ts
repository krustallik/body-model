import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  forecastModelEpisode: vi.fn(),
  getModelStatus: vi.fn(),
  recalculateModelEpisode: vi.fn(),
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
    services.getModelStatus.mockResolvedValue({ daysModeled: 28, latestModeledDate: "2026-08-24" });
  });

  it("validates and delegates to the real application service with the stable seed", async () => {
    expect((await POST(request({ horizonDays: 0 }))).status).toBe(400);
    services.forecastModelEpisode.mockResolvedValue({ status: "ok", dates: [] });
    expect((await POST(request(validBody))).status).toBe(200);
    expect(services.forecastModelEpisode).toHaveBeenCalledWith({ ...validBody, seed: 20_260_824 });
    expect(services.recalculateModelEpisode).not.toHaveBeenCalled();
  });

  it("persists model days before forecasting when DailyModelState is still empty", async () => {
    services.getModelStatus.mockResolvedValue({ daysModeled: 0, latestModeledDate: null });
    services.recalculateModelEpisode.mockResolvedValue({ status: "ok", daysPersisted: 28 });
    services.forecastModelEpisode.mockResolvedValue({ status: "ok", dates: [] });
    expect((await POST(request(validBody))).status).toBe(200);
    expect(services.recalculateModelEpisode).toHaveBeenCalledWith({});
    expect(services.forecastModelEpisode).toHaveBeenCalled();
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
});
