import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ forecastModelEpisode: vi.fn() }));
vi.mock("@/modules/model-forecast/model-forecast.service", () => services);

import { POST } from "@/app/api/forecast/route";
import { ForecastScenarioEvidenceError } from "@/modules/model-forecast/model-forecast.errors";

const validBody = { horizonDays: 7, scenario: { mode: "recent-behavior" } };
function request(body: unknown) { return new Request("http://localhost/api/forecast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("forecast application route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates and delegates to the real application service with the stable seed", async () => {
    expect((await POST(request({ horizonDays: 0 }))).status).toBe(400);
    services.forecastModelEpisode.mockResolvedValue({ status: "ok", dates: [] });
    expect((await POST(request(validBody))).status).toBe(200);
    expect(services.forecastModelEpisode).toHaveBeenCalledWith({ ...validBody, seed: 20_260_824 });
  });

  it("turns missing recent-behavior evidence into an actionable 422 response", async () => {
    services.forecastModelEpisode.mockRejectedValue(new ForecastScenarioEvidenceError("Need seven reliable donor days"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "insufficient_scenario_evidence", message: "Need seven reliable donor days" });
  });

  it("does not leak unexpected exceptions", async () => {
    services.forecastModelEpisode.mockRejectedValue(new Error("secret database detail"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "forecast_failed" });
  });
});
