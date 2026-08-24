import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  recoverModelEpisode: vi.fn(),
  getModelRecoveryStatus: vi.fn(),
}));
vi.mock("@/modules/model-recovery/model-recovery.service", () => services);

import { POST as POST_RECOVER } from "@/app/api/v1/model/recover/route";
import { GET as GET_RECOVERY_STATUS } from "@/app/api/v1/model/recovery-status/route";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";

const apiKey = "a-long-model-test-secret";

function request(url: string, method = "GET", body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      "x-api-key": apiKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("historical recovery API", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.IOS_SHORTCUT_API_KEY = apiKey;
    vi.clearAllMocks();
  });

  it.each([
    () => POST_RECOVER(new Request("http://localhost/api/v1/model/recover", { method: "POST" })),
    () => GET_RECOVERY_STATUS(new Request("http://localhost/api/v1/model/recovery-status")),
  ])("uses the model API authorization convention", async (invoke) => {
    expect((await invoke()).status).toBe(401);
  });

  it("validates bounded recovery controls and applies a deterministic default seed", async () => {
    expect((await POST_RECOVER(request(
      "http://localhost/api/v1/model/recover", "POST", { seed: -1 },
    ))).status).toBe(400);
    expect((await POST_RECOVER(request(
      "http://localhost/api/v1/model/recover", "POST", { config: { particleCount: 2 } },
    ))).status).toBe(400);

    services.recoverModelEpisode.mockResolvedValue({ status: "ok" });
    const response = await POST_RECOVER(request(
      "http://localhost/api/v1/model/recover",
      "POST",
      { episodeId: 7, config: { particleCount: 256 } },
    ));
    expect(response.status).toBe(200);
    expect(services.recoverModelEpisode).toHaveBeenCalledWith({
      episodeId: 7,
      seed: 20_260_824,
      config: { particleCount: 256 },
    });
  });

  it.each([
    [new NoActiveModelEpisodeError(), 404, "no_active_episode"],
    [new ModelEpisodeNotFoundError(), 404, "episode_not_found"],
    [new ModelRecoveryEvidenceError("no donor"), 422, "insufficient_recovery_evidence"],
    [new Error("private"), 500, "recovery_failed"],
  ])("maps recovery failures", async (error, status, code) => {
    services.recoverModelEpisode.mockRejectedValue(error);
    const response = await POST_RECOVER(request(
      "http://localhost/api/v1/model/recover", "POST", {},
    ));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
  });

  it("returns compact recovery metadata without a particle ensemble", async () => {
    services.getModelRecoveryStatus.mockResolvedValue({
      episodeId: 7,
      recovery: { id: 3, status: "degraded", posteriorSummary: {} },
    });
    const response = await GET_RECOVERY_STATUS(request(
      "http://localhost/api/v1/model/recovery-status?episodeId=7",
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recovery).not.toHaveProperty("ensemble");
    expect(services.getModelRecoveryStatus).toHaveBeenCalledWith(7);
  });

  it("validates the recovery-status query", async () => {
    const response = await GET_RECOVERY_STATUS(request(
      "http://localhost/api/v1/model/recovery-status?episodeId=not-a-number",
    ));
    expect(response.status).toBe(400);
    expect(services.getModelRecoveryStatus).not.toHaveBeenCalled();
  });

  it.each([
    [new NoActiveModelEpisodeError(), 404, "no_active_episode"],
    [new ModelEpisodeNotFoundError(), 404, "episode_not_found"],
    [new Error("private"), 500, "internal_error"],
  ])("maps recovery-status failures", async (error, status, code) => {
    services.getModelRecoveryStatus.mockRejectedValue(error);
    const response = await GET_RECOVERY_STATUS(request(
      "http://localhost/api/v1/model/recovery-status",
    ));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });
});
