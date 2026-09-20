import { beforeEach, describe, expect, it, vi } from "vitest";

const { syncHealthData, recordHealthSyncAudit } = vi.hoisted(() => ({
  syncHealthData: vi.fn(),
  recordHealthSyncAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/health/health.service", () => ({ syncHealthData }));
vi.mock("@/modules/health/health-sync-audit", () => ({ recordHealthSyncAudit }));

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
    recordHealthSyncAudit.mockReset();
    recordHealthSyncAudit.mockResolvedValue(undefined);
  });

  it.each([[null], ["wrong-key"], [""]])("returns 401 for an unauthorized key: %s", async (key) => {
    const response = await POST(request({ days: [{ date: "2026-08-21" }] }, key));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(syncHealthData).not.toHaveBeenCalled();
    expect(recordHealthSyncAudit).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "unauthorized", httpStatus: 401, rawBody: JSON.stringify({ days: [{ date: "2026-08-21" }] }),
    }));
  });

  it("returns the service result for a valid request", async () => {
    const result = {
      status: "ok",
      received: 1,
      created: 1,
      updated: 0,
      dates: [{ date: "2026-08-21", action: "created" }],
      retentionCutoffDate: "2026-07-22",
      prunedDays: 0,
      prunedSnapshots: 0,
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
    expect(recordHealthSyncAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", httpStatus: 200 }));
  });

  it("accepts the current iPhone serialized HR fields and sends only canonical arrays to the service", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request({
      days: [{
        date: "2026-09-17T09:41:25+02:00",
        bpm: JSON.stringify({
          timestamps: "2026-09-15T08:00:00+02:00\\n2026-09-15T08:02:00+02:00",
          bpm: "61\\n63",
        }),
        bpminpeace: JSON.stringify({
          timestamps: "2026-09-13T00:00:00+02:00\\n2026-09-14T00:00:00+02:00",
          bvminpeace: "68\\n57",
        }),
      }],
    }));

    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0]).toEqual({
      days: [{
        date: "2026-09-17",
        bpm: {
          timestamps: ["2026-09-15T08:00:00+02:00", "2026-09-15T08:02:00+02:00"],
          bpm: [61, 63],
        },
        bpminpeace: {
          timestamps: ["2026-09-13T00:00:00+02:00", "2026-09-14T00:00:00+02:00"],
          bpminpeace: [68, 57],
        },
      }],
    });
  });

  it("expands the timestamped range nutrition/body metrics without touching other feeds", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 3, created: 3, updated: 0, dates: [] });
    const response = await POST(request({ days: [{
      date: "2026-09-20T18:44:44+02:00",
      caloriesKcal: { timeStamps: "2026-09-17T08:31:00+02:002026-09-18T08:33:00+02:00", Calories: "2300\\n2400" },
      weightKg: JSON.stringify({ TimeStamps: "2026-09-17T07:00:00+02:00\\n2026-09-17T20:00:00+02:00", Weights: "81.4\\n81.1" }),
      averageWalkingSpeedKmh: JSON.stringify({ timeStamps: "2026-09-17T12:00:00+02:00\\n2026-09-17T18:00:00+02:00", speeds: "4\\n6" }),
    }] }));

    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0]).toEqual({
      syncedAt: "2026-09-20T18:44:44+02:00",
      rangePayload: true,
      days: [
        { date: "2026-09-17", caloriesKcal: 2300, weightKg: 81.1, averageWalkingSpeedKmh: 5 },
        { date: "2026-09-18", caloriesKcal: 2400 },
      ],
    });
    expect(syncHealthData.mock.calls[0]?.[4]).toBeInstanceOf(Map);
  });

  it("accepts singleton step interval arrays and sends the canonical interval series to the service", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const intervalPayload = {
      stepCounts: "20\n43\n190",
      timeStampsStart: "2026-09-19T15:00:00+02:00\n2026-09-19T15:15:00+02:00\n2026-09-19T15:30:00+02:00",
      timeStampsEnd: "2026-09-19T15:14:59+02:00\n2026-09-19T15:29:59+02:00\n2026-09-19T15:44:59+02:00",
    };

    const response = await POST(request({ days: [{ date: "2026-09-19", steps: [intervalPayload] }] }));

    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0]).toEqual({
      days: [{
        date: "2026-09-19",
        steps: undefined,
        stepIntervals: {
          starts: intervalPayload.timeStampsStart.split("\n"),
          ends: intervalPayload.timeStampsEnd.split("\n"),
          values: [20, 43, 190],
        },
      }],
    });
    expect(syncHealthData.mock.calls[0]?.[2]).toEqual([{ date: "2026-09-19", steps: [intervalPayload] }]);
  });

  it("rejects singleton step interval arrays with mismatched lengths", async () => {
    const response = await POST(request({ days: [{
      date: "2026-09-19",
      steps: [{
        stepCounts: "20\n43",
        timeStampsStart: "2026-09-19T15:00:00+02:00",
        timeStampsEnd: "2026-09-19T15:14:59+02:00\n2026-09-19T15:29:59+02:00",
      }],
    }] }));

    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("logs received and successful sync requests including training fields", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    syncHealthData.mockResolvedValue({
      status: "ok",
      received: 1,
      created: 1,
      updated: 0,
      dates: [{ date: "2026-09-16", action: "created" }],
      retentionCutoffDate: "2026-08-17",
      prunedDays: 2,
      prunedSnapshots: 3,
    });

    const body = {
      Days: [{
        Date: "2026-09-16",
        Trainingtype: "Stair Climbing\\NTraditional Strength Training",
        Trainingactivekcal: "154\\N562",
        Strengthtrainingminutes:
          "16. 9. 2026, 12:40\\N16. 9. 2026, 10:44\\N16. 9. 2026, 12:52\\N16. 9. 2026, 11:46",
      }],
    };
    const response = await POST(request(body));

    expect(response.status).toBe(200);
    const events = info.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "health_sync_received",
        hasTrainingType: true,
        hasTrainingActiveKcal: true,
        hasStrengthTrainingMinutes: true,
        trainingTypeLineCount: 2,
        trainingActiveKcalLineCount: 2,
        strengthTrainingMinutesLineCount: 4,
        rawBody: JSON.stringify(body),
      }),
      expect.objectContaining({
        event: "health_sync_success",
        derivedWorkoutCount: 2,
        prunedDays: 2,
        prunedSnapshots: 3,
        retentionCutoffDate: "2026-08-17",
      }),
    ]));
    const received = events.find((event) => event.event === "health_sync_received");
    expect(received).not.toHaveProperty("apiKey");
    expect(received).not.toHaveProperty("authorization");
    info.mockRestore();
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

  it("marks strength training as observed zero when the latest workout is not from the synced day", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request({ Days: [{
      Date: "2026-08-22",
      Strengthtrainingminutes: "21. 8. 2026, 13:01 21. 8. 2026, 14:16",
    }] }));
    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0].days[0].strengthTrainingMinutes).toBe(0);
  });

  it("accepts an empty Shortcut workout value as observed zero", async () => {
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

  it("logs raw day keys when validation fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(request({ Days: [{ Steps: 100, Fatg: 10 }] }));
    expect(response.status).toBe(400);
    expect(warn).toHaveBeenCalled();
    const record = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "warn",
      event: "health_sync_validation_failed",
      daysCount: 1,
      hasDate: false,
      hasDateCapital: false,
    });
    expect(String(record.day0Keys)).toContain("Steps");
    expect(String(record.issueSummary)).toContain("date");
    warn.mockRestore();
  });

  it("accepts the exact Apple-cased screenshot day through the HTTP route", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 1, created: 1, updated: 0, dates: [] });
    const response = await POST(request({
      days: [{
        Fatg: 62,
        Carbsg: 253,
        Averagewalkingspeedkmh: "5",
        Calorieskcal: 2411,
        Trainingtype: "Stair Climbing\\Nstair Climbing\\Ntraditional Strength Training",
        Proteing: 203,
        Walkingdistancekm: "0.5814353488389005",
        Bodyfatpercent: "27.6",
        Date: "2026-09-16",
        Trainingactivekcal: "154\\N18\\N562",
        Strengthtrainingminutes:
          "16. 9. 2026, 12:40\\N16. 9. 2026, 12:34\\N16. 9. 2026, 10:44\\N16. 9. 2026, 12:52\\N16. 9. 2026, 12:36\\N16. 9. 2026, 11:46",
        Weightkg: "89.80000305175781",
        Steps: "4449",
      }],
    }));
    expect(response.status).toBe(200);
    expect(syncHealthData.mock.calls[0]?.[0].days[0]).toMatchObject({
      date: "2026-09-16",
      steps: 4449,
      fatG: 62,
    });
    expect(syncHealthData.mock.calls[0]?.[0].days[0].workouts).toHaveLength(3);
  });

  it("accepts a sync payload of up to three days", async () => {
    syncHealthData.mockResolvedValue({ status: "ok", received: 2, created: 2, updated: 0, dates: [] });
    const response = await POST(request({ days: [
      { date: "2026-08-21" },
      { date: "2026-08-22" },
    ] }));
    expect(response.status).toBe(200);
    expect(syncHealthData).toHaveBeenCalled();
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
    expect(recordHealthSyncAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "invalid-json", httpStatus: 400, rawBody: "{broken" }));
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
    expect(recordHealthSyncAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "invalid-content-type", httpStatus: 400 }));
  });

  it("does not expose database errors", async () => {
    syncHealthData.mockRejectedValue(new Error("postgres password=super-secret"));
    const response = await POST(request({ days: [{ date: "2026-08-21" }] }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_error" });
    expect(recordHealthSyncAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "internal-error", httpStatus: 500 }));
  });
});
