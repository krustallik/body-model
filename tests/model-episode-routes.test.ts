import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  recalculateModelEpisode: vi.fn(),
  getModelStatus: vi.fn(),
  getModelHistory: vi.fn(),
}));
vi.mock("@/modules/model-episodes/model-episode.service", () => services);

import { GET as GET_HISTORY } from "@/app/api/v1/model/history/route";
import { POST as POST_RECALCULATE } from "@/app/api/v1/model/recalculate/route";
import { GET as GET_STATUS } from "@/app/api/v1/model/status/route";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";

const apiKey = "a-long-model-test-secret";

function authorized(url: string, method = "GET", body?: string): Request {
  return new Request(url, {
    method,
    headers: {
      "x-api-key": apiKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body,
  });
}

describe("model episode API routes", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.IOS_SHORTCUT_API_KEY = apiKey;
    vi.clearAllMocks();
  });

  it.each([
    ["recalculate", () => POST_RECALCULATE(new Request(
      "http://localhost/api/v1/model/recalculate",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ))],
    ["status", () => GET_STATUS(new Request("http://localhost/api/v1/model/status"))],
    ["history", () => GET_HISTORY(new Request("http://localhost/api/v1/model/history"))],
  ])("protects %s with the existing API key convention", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("validates recalculation JSON and returns a concise success", async () => {
    const missingType = await POST_RECALCULATE(authorized(
      "http://localhost/api/v1/model/recalculate", "POST",
    ));
    expect(missingType.status).toBe(400);
    const invalidJson = await POST_RECALCULATE(new Request(
      "http://localhost/api/v1/model/recalculate",
      { method: "POST", headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: "{" },
    ));
    expect(invalidJson.status).toBe(400);
    const invalid = await POST_RECALCULATE(authorized(
      "http://localhost/api/v1/model/recalculate", "POST", JSON.stringify({ episodeId: 0 }),
    ));
    expect(invalid.status).toBe(400);

    const result = { status: "ok", episodeId: 3, daysPersisted: 20 };
    services.recalculateModelEpisode.mockResolvedValue(result);
    const response = await POST_RECALCULATE(authorized(
      "http://localhost/api/v1/model/recalculate", "POST", JSON.stringify({ episodeId: 3 }),
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(services.recalculateModelEpisode).toHaveBeenCalledWith({ episodeId: 3 });
  });

  it.each([
    [new NoActiveModelEpisodeError(), "no_active_episode", 404],
    [new ModelEpisodeNotFoundError(), "episode_not_found", 404],
    [new Error("private failure"), "recalculation_failed", 500],
  ])("maps recalculation failure without exposing details", async (error, code, status) => {
    services.recalculateModelEpisode.mockRejectedValue(error);
    const response = await POST_RECALCULATE(authorized(
      "http://localhost/api/v1/model/recalculate", "POST", "{}",
    ));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
  });

  it("returns model status and validates episode id", async () => {
    const invalid = await GET_STATUS(authorized(
      "http://localhost/api/v1/model/status?episodeId=abc",
    ));
    expect(invalid.status).toBe(400);
    const status = {
      episodeId: 4,
      daysModeled: 30,
      incompleteDays: 0,
      observedNutritionDays: 28,
      imputedNutritionDays: 2,
      unbridgeableNutritionDays: 0,
    };
    services.getModelStatus.mockResolvedValue(status);
    const response = await GET_STATUS(authorized(
      "http://localhost/api/v1/model/status?episodeId=4",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(status);
    expect(services.getModelStatus).toHaveBeenCalledWith(4);
  });

  it.each([
    [new NoActiveModelEpisodeError(), "no_active_episode", 404],
    [new ModelEpisodeNotFoundError(), "episode_not_found", 404],
    [new Error("private failure"), "internal_error", 500],
  ])("maps model status failure", async (error, code, status) => {
    services.getModelStatus.mockRejectedValue(error);
    const response = await GET_STATUS(authorized("http://localhost/api/v1/model/status"));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
  });

  it("returns chronological range history and validates ranges", async () => {
    const invalid = await GET_HISTORY(authorized(
      "http://localhost/api/v1/model/history?from=2026-08-22&to=2026-08-01",
    ));
    expect(invalid.status).toBe(400);
    const history = { episodeId: 2, days: [{ date: "2026-08-01" }], limit: 10, offset: 0 };
    services.getModelHistory.mockResolvedValue(history);
    const response = await GET_HISTORY(authorized(
      "http://localhost/api/v1/model/history?from=2026-08-01&to=2026-08-22&limit=10",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(history);
    expect(services.getModelHistory).toHaveBeenCalledWith({
      from: "2026-08-01", to: "2026-08-22", limit: 10, offset: 0,
    });
  });

  it.each([
    [new NoActiveModelEpisodeError(), "no_active_episode", 404],
    [new ModelEpisodeNotFoundError(), "episode_not_found", 404],
    [new Error("private failure"), "internal_error", 500],
  ])("maps model history failure", async (error, code, status) => {
    services.getModelHistory.mockRejectedValue(error);
    const response = await GET_HISTORY(authorized("http://localhost/api/v1/model/history"));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
  });
});
