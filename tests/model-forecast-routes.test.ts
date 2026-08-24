import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ forecastModelEpisode: vi.fn() }));
vi.mock("@/modules/model-forecast/model-forecast.service", () => services);

import { POST } from "@/app/api/v1/model/forecast/route";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { ForecastScenarioEvidenceError } from "@/modules/model-forecast/model-forecast.errors";

const apiKey = "a-long-model-test-secret";
const body = {
  horizonDays: 30,
  scenario: {
    mode: "fixed",
    schedule: { defaultDay: {
      nutrition: { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 },
      outsideWorkWalkingDistanceKm: 0,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 0,
      occupation: [],
    } },
  },
};

function request(payload: unknown, authorized = true): Request {
  return new Request("http://localhost/api/v1/model/forecast", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
}

describe("forecast API", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.IOS_SHORTCUT_API_KEY = apiKey;
    vi.clearAllMocks();
  });

  it("authorizes, validates, and applies deterministic default seed", async () => {
    expect((await POST(request(body, false))).status).toBe(401);
    expect((await POST(request({ ...body, horizonDays: 0 }))).status).toBe(400);
    services.forecastModelEpisode.mockResolvedValue({ status: "ok", dates: [] });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(services.forecastModelEpisode).toHaveBeenCalledWith({ ...body, seed: 20_260_824 });
  });

  it.each([
    [new NoActiveModelEpisodeError(), 404, "no_active_episode"],
    [new ModelEpisodeNotFoundError(), 404, "episode_not_found"],
    [new ForecastScenarioEvidenceError("need donors"), 422, "insufficient_scenario_evidence"],
    [new Error("private"), 500, "forecast_failed"],
  ])("maps failures without leaking internals", async (error, status, code) => {
    services.forecastModelEpisode.mockRejectedValue(error);
    const response = await POST(request(body));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
  });
});
