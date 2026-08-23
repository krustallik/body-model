import { beforeEach, describe, expect, it, vi } from "vitest";

const { syncHealthData } = vi.hoisted(() => ({ syncHealthData: vi.fn() }));
vi.mock("@/modules/health/health.service", () => ({ syncHealthData }));

import { POST } from "@/app/api/v1/health/sync/route";

const apiKey = "a-long-test-secret";
const url = "http://localhost/api/v1/health/sync";

function request(body: unknown, key: string | null = apiKey): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== null) headers.set("x-api-key", key);
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/v1/health/sync", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.IOS_SHORTCUT_API_KEY = apiKey;
    syncHealthData.mockReset();
  });

  it.each([[null], ["wrong-key"], [""]])("returns 401 for an unauthorized key: %s", async (key) => {
    const response = await POST(request({ days: [{ date: "2026-08-21" }] }, key));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("returns the service result for a valid request", async () => {
    const result = {
      status: "ok",
      received: 1,
      created: 1,
      updated: 0,
      dates: [{ date: "2026-08-21", action: "created" }],
    };
    syncHealthData.mockResolvedValue(result);
    const response = await POST(request({ days: [{ date: "2026-08-21", steps: 10000 }] }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(syncHealthData).toHaveBeenCalledWith(
      { days: [{ date: "2026-08-21", steps: 10000 }] },
      undefined,
      [{ date: "2026-08-21", steps: 10000 }],
    );
  });

  it("preserves explicit iPhone timezone and sync instant", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request({
      Timezone: "Europe/Bratislava",
      SyncedAt: "2026-08-23T10:00:00+02:00",
      Days: [{ Date: "2026-08-23", Steps: 0 }],
    }));
    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0]).toEqual({
      timezone: "Europe/Bratislava",
      syncedAt: "2026-08-23T10:00:00+02:00",
      days: [{ date: "2026-08-23", steps: 0 }],
    });
  });

  it.each(["Mars/Kosice", "", 2])("rejects invalid timezone %j", async (timezone) => {
    const response = await POST(request({ timezone, days: [{ date: "2026-08-23" }] }));
    expect(response.status).toBe(400);
  });

  it("rejects a sync timestamp outside the iPhone calendar day", async () => {
    const response = await POST(request({
      timezone: "Europe/Bratislava",
      syncedAt: "2026-08-22T23:30:00Z",
      days: [{ date: "2026-08-22" }],
    }));
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it.each([
    ["Apple casing", { Days: [{ Date: "2026-08-22", Weightkg: 89, Steps: 10000 }] }],
    ["PascalCase", { Days: [{ Date: "2026-08-22", WeightKg: 89, ActiveEnergyKcal: 600 }] }],
    ["uppercase", { DAYS: [{ DATE: "2026-08-22", WEIGHTKG: 89, STEPS: 10000 }] }],
  ])("normalizes %s before validation", async (_name, body) => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0]).toMatchObject({ days: [{ date: "2026-08-22", weightKg: 89 }] });
    expect(syncHealthData.mock.calls[0]?.[2]).toEqual(Object.values(body)[0]);
  });

  it("normalizes nested workouts", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request({ Days: [{ Date: "2026-08-22", Workouts: [{ Type: "strength_training",
      Startat: "2026-08-22T17:00:00+02:00", Endat: "2026-08-22T18:00:00+02:00",
      Durationminutes: 60, Energykcal: 300 }] }] }));
    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0].days[0].workouts[0]).toMatchObject({
      type: "strength_training", durationMinutes: 60, energyKcal: 300,
    });
  });

  it("normalizes Apple-cased numeric strings before sending canonical numbers to the service", async () => {
    const originalDay = {
      Date: "2026-08-22",
      Weightkg: "89,4",
      Bodyfatpercent: "27,4",
      Calorieskcal: "587,5",
      Proteing: "59,7",
      Fatg: "15,3",
      Carbsg: "56,8",
      Steps: "10234",
      Averagewalkingspeedkmh: "4,72",
      Walkingdistancekm: "7,35",
    };
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });

    const response = await POST(request({ Days: [originalDay] }));

    expect(response.status).toBe(200);
    expect(syncHealthData).toHaveBeenCalledWith({ days: [{
      date: "2026-08-22",
      weightKg: 89.4,
      bodyFatPercent: 27.4,
      caloriesKcal: 587.5,
      proteinG: 59.7,
      fatG: 15.3,
      carbsG: 56.8,
      steps: 10234,
      averageWalkingSpeedKmh: 4.72,
      walkingDistanceKm: 7.35,
    }] }, undefined, [originalDay]);
  });

  it.each([
    [65, 65],
    ["65", 65],
    ["65.5", 65.5],
    ["65,5", 65.5],
    [0, 0],
    [null, null],
  ])("accepts strengthTrainingMinutes %j as %s", async (input, expected) => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const originalDay = { Date: "2026-08-22", Strengthtrainingminutes: input };
    const response = await POST(request({ Days: [originalDay] }));
    expect(response.status).toBe(200);
    expect(syncHealthData).toHaveBeenCalledWith(
      { days: [{ date: "2026-08-22", strengthTrainingMinutes: expected }] },
      undefined,
      [originalDay],
    );
  });

  it.each(["-5", "601", "abc", "65 min", [], {}])(
    "rejects invalid strengthTrainingMinutes %j",
    async (strengthTrainingMinutes) => {
      const response = await POST(request({ days: [{ date: "2026-08-22", strengthTrainingMinutes }] }));
      expect(response.status).toBe(400);
      expect(syncHealthData).not.toHaveBeenCalled();
    },
  );

  it("calculates strength training minutes from the Shortcut workout dates", async () => {
    const originalDay = {
      Date: "2026-08-21",
      Strengthtrainingminutes: "21. 8. 2026, 13:01 21. 8. 2026, 14:16",
    };
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });

    const response = await POST(request({ Days: [originalDay] }));

    expect(response.status).toBe(200);
    expect(syncHealthData).toHaveBeenCalledWith(
      { days: [{ date: "2026-08-21", strengthTrainingMinutes: 75 }] },
      undefined,
      [originalDay],
    );
  });

  it("sets strength training to zero when the latest workout is not from the synced day", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request({ Days: [{
      Date: "2026-08-22",
      Strengthtrainingminutes: "21. 8. 2026, 13:01 21. 8. 2026, 14:16",
    }] }));
    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0].days[0].strengthTrainingMinutes).toBe(0);
  });

  it("accepts an empty Shortcut workout value as no workout today", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 0, updated: 1, dates: [] });
    const response = await POST(request({ Days: [{
      Date: "2026-08-22",
      Strengthtrainingminutes: "",
    }] }));

    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0].days[0].strengthTrainingMinutes).toBe(0);
  });

  it.each(["", " ", "\t\n"])("accepts an empty numeric metric %j as null", async (averageWalkingSpeedKmh) => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request({ days: [{ date: "2026-08-23", averageWalkingSpeedKmh }] }));

    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0].days[0].averageWalkingSpeedKmh).toBeNull();
  });

  it.each(["abc", "27abc", "27%", "89 kg", "NaN", "Infinity"])(
    "rejects invalid numeric string %j",
    async (weightKg) => {
      const response = await POST(request({ days: [{ date: "2026-08-22", weightKg }] }));
      expect(response.status).toBe(400);
      expect(syncHealthData).not.toHaveBeenCalled();
    },
  );

  it.each([[], {}, true])("rejects invalid numeric value %j", async (weightKg) => {
    const response = await POST(request({ days: [{ date: "2026-08-22", weightKg }] }));
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it.each(["10000.5", "10000,5"])("leaves fractional steps for integer validation: %s", async (steps) => {
    const response = await POST(request({ days: [{ date: "2026-08-22", steps }] }));
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("parses numeric strings before applying existing range validation", async () => {
    const response = await POST(request({ days: [{ date: "2026-08-22", weightKg: "999" }] }));
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it.each(["banana", "weigthKg"])("rejects unsupported key %s", async (key) => {
    const response = await POST(request({ days: [{ date: "2026-08-22", [key]: 89 }] }));
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("returns a clear 400 response for key collisions", async () => {
    const response = await POST(request({ days: [{ date: "2026-08-22", weightKg: 89, Weightkg: 90 }] }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "normalization_error",
      details: [{ path: ["days", 0, "weightKg"], code: "key_collision" }],
    });
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("returns safe validation details for invalid payload", async () => {
    const response = await POST(request({ days: [] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "validation_error" });
  });

  it("rejects the old multi-day sync payload", async () => {
    const response = await POST(request({ days: [
      { date: "2026-08-21" },
      { date: "2026-08-22" },
    ] }));
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: "{broken",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-JSON content type", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "text/plain", "x-api-key": apiKey },
        body: JSON.stringify({ days: [{ date: "2026-08-21" }] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("does not expose database errors", async () => {
    syncHealthData.mockRejectedValue(new Error("postgres password=super-secret"));
    const response = await POST(request({ days: [{ date: "2026-08-21" }] }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_error" });
  });
});
