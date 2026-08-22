import { beforeEach, describe, expect, it, vi } from "vitest";

const dailyMetricRepository = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/modules/days/day.repository", () => ({ dailyMetricRepository }));

import { DELETE, PATCH } from "@/app/api/v1/days/[date]/route";
import { GET, POST } from "@/app/api/v1/days/route";
import { DuplicateDayError } from "@/modules/days/day.errors";

const baseUrl = "http://localhost/api/v1/days";
const day = {
  date: "2026-08-22",
  weightKg: 89.4,
  bodyFatPercent: 27.4,
  caloriesKcal: null,
  proteinG: 59,
  fatG: 15,
  carbsG: 56,
  steps: 23,
  activeEnergyKcal: null,
  averageWalkingSpeedKmh: 4.572,
  walkingDistanceKm: 0.0125,
  strengthTrainingMinutes: 75,
  updatedAt: "2026-08-22T10:00:00.000Z",
};

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = (date: string) => ({ params: Promise.resolve({ date }) });

describe("/api/v1/days", () => {
  beforeEach(() => {
    vi.useRealTimers();
    Object.values(dailyMetricRepository).forEach((mock) => mock.mockReset());
  });

  it("returns newest-first history using filters and pagination", async () => {
    dailyMetricRepository.list.mockResolvedValue([day]);
    const response = await GET(new Request(`${baseUrl}?from=2026-08-01&to=2026-08-22&limit=10&offset=2`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ days: [day], limit: 10, offset: 2 });
    expect(dailyMetricRepository.list).toHaveBeenCalledWith({
      from: "2026-08-01",
      to: "2026-08-22",
      limit: 10,
      offset: 2,
    });
  });

  it("defaults to the last 30 calendar days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00Z"));
    dailyMetricRepository.list.mockResolvedValue([]);

    await GET(new Request(baseUrl));

    expect(dailyMetricRepository.list).toHaveBeenCalledWith({
      from: "2026-07-24",
      to: "2026-08-22",
      limit: 30,
      offset: 0,
    });
  });

  it("creates a manual day", async () => {
    dailyMetricRepository.create.mockResolvedValue(day);
    const response = await POST(jsonRequest(baseUrl, "POST", {
      date: day.date,
      weightKg: "89.4",
      caloriesKcal: "",
      steps: "0",
    }));

    expect(response.status).toBe(201);
    expect(dailyMetricRepository.create).toHaveBeenCalledWith({
      date: day.date,
      weightKg: 89.4,
      caloriesKcal: null,
      steps: 0,
    });
  });

  it("returns 409 for a duplicate date", async () => {
    dailyMetricRepository.create.mockRejectedValue(new DuplicateDayError());
    const response = await POST(jsonRequest(baseUrl, "POST", { date: day.date }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "date_conflict" });
  });

  it("updates one field", async () => {
    dailyMetricRepository.update.mockResolvedValue({ ...day, weightKg: 88.9 });
    const response = await PATCH(
      jsonRequest(`${baseUrl}/${day.date}`, "PATCH", { weightKg: "88.9" }),
      routeContext(day.date),
    );

    expect(response.status).toBe(200);
    expect(dailyMetricRepository.update).toHaveBeenCalledWith(day.date, { weightKg: 88.9 });
  });

  it("updates multiple fields and parses decimal dot and comma", async () => {
    dailyMetricRepository.update.mockResolvedValue(day);
    await PATCH(
      jsonRequest(`${baseUrl}/${day.date}`, "PATCH", {
        weightKg: "89.4",
        bodyFatPercent: "27,4",
        walkingDistanceKm: "7,25",
      }),
      routeContext(day.date),
    );

    expect(dailyMetricRepository.update).toHaveBeenCalledWith(day.date, {
      weightKg: 89.4,
      bodyFatPercent: 27.4,
      walkingDistanceKm: 7.25,
    });
  });

  it("keeps empty/null distinct from explicit zero", async () => {
    dailyMetricRepository.update.mockResolvedValue(day);
    await PATCH(
      jsonRequest(`${baseUrl}/${day.date}`, "PATCH", {
        caloriesKcal: "",
        proteinG: null,
        fatG: "0",
        steps: 0,
      }),
      routeContext(day.date),
    );

    expect(dailyMetricRepository.update).toHaveBeenCalledWith(day.date, {
      caloriesKcal: null,
      proteinG: null,
      fatG: 0,
      steps: 0,
    });
  });

  it("does not pass rawPayload or a new date to manual PATCH", async () => {
    dailyMetricRepository.update.mockResolvedValue(day);
    const response = await PATCH(
      jsonRequest(`${baseUrl}/${day.date}`, "PATCH", { weightKg: 80 }),
      routeContext(day.date),
    );

    expect(response.status).toBe(200);
    const update = dailyMetricRepository.update.mock.calls[0]?.[1];
    expect(update).not.toHaveProperty("rawPayload");
    expect(update).not.toHaveProperty("date");
  });

  it("deletes a day", async () => {
    dailyMetricRepository.delete.mockResolvedValue(true);
    const response = await DELETE(new Request(`${baseUrl}/${day.date}`, { method: "DELETE" }), routeContext(day.date));
    expect(response.status).toBe(204);
    expect(dailyMetricRepository.delete).toHaveBeenCalledWith(day.date);
  });

  it.each([
    ["update", async () => PATCH(jsonRequest(`${baseUrl}/${day.date}`, "PATCH", { steps: 1 }), routeContext(day.date))],
    ["delete", async () => DELETE(new Request(`${baseUrl}/${day.date}`, { method: "DELETE" }), routeContext(day.date))],
  ])("returns 404 when %s targets a missing date", async (operation, call) => {
    if (operation === "update") dailyMetricRepository.update.mockResolvedValue(null);
    else dailyMetricRepository.delete.mockResolvedValue(false);
    const response = await call();
    expect(response.status).toBe(404);
  });
});
