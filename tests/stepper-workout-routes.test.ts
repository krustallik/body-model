import { beforeEach, describe, expect, it, vi } from "vitest";

const stepperWorkoutRepository = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock("@/modules/training/stepper-workout.repository", () => ({ stepperWorkoutRepository }));

import { GET, POST } from "@/app/api/v1/training/stepper-workouts/route";
import { DELETE, PUT } from "@/app/api/v1/training/stepper-workouts/[id]/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const workout = { id: 4, type: "Stair Climbing", startAt: "2042-03-15T08:00:00.000Z", endAt: "2042-03-15T08:20:00.000Z", durationMinutes: 20, activeEnergyKcal: null, source: "manual" };

describe("stepper workout CRUD routes", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists and creates workout events without a made-up energy value", async () => {
    stepperWorkoutRepository.list.mockResolvedValue([workout]);
    const listed = await GET();
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ workouts: [workout] });

    stepperWorkoutRepository.create.mockResolvedValue(workout);
    const created = await POST(new Request("http://localhost/api/v1/training/stepper-workouts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ startAt: "2042-03-15T08:00:00Z", durationMinutes: 20 }),
    }));
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ workout });
    expect(stepperWorkoutRepository.create).toHaveBeenCalledWith({ startAt: "2042-03-15T08:00:00Z", durationMinutes: 20 });
  });

  it("updates and deletes manual events and refuses other workout sources", async () => {
    stepperWorkoutRepository.update.mockResolvedValue(workout);
    const updated = await PUT(new Request("http://localhost/api/v1/training/stepper-workouts/4", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ startAt: "2042-03-15T08:00:00Z", durationMinutes: 25 }),
    }), params("4"));
    expect(updated.status).toBe(200);

    stepperWorkoutRepository.update.mockResolvedValue(null);
    const readOnly = await PUT(new Request("http://localhost/api/v1/training/stepper-workouts/4", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ startAt: "2042-03-15T08:00:00Z", durationMinutes: 25 }),
    }), params("4"));
    expect(readOnly.status).toBe(404);

    stepperWorkoutRepository.delete.mockResolvedValue(true);
    expect((await DELETE(new Request("http://localhost/api/v1/training/stepper-workouts/4"), params("4"))).status).toBe(204);
  });
});
