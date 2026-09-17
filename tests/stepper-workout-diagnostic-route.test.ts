import { beforeEach, describe, expect, it, vi } from "vitest";

const stepperWorkoutDiagnosticRepository = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/modules/profile/stepper-workout-diagnostic.repository", () => ({ stepperWorkoutDiagnosticRepository }));
import { GET } from "@/app/api/v1/workouts/[id]/stepper-diagnostic/route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });
describe("stepper diagnostic route", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns read-only evidence for a stair workout", async () => {
    stepperWorkoutDiagnosticRepository.get.mockResolvedValue({ workout: { workoutId: 7 } });
    const response = await GET(new Request("http://localhost/api/v1/workouts/7/stepper-diagnostic"), context("7"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ diagnostic: { workout: { workoutId: 7 } } });
  });
  it("leaves a non-stair workout outside the diagnostic", async () => {
    stepperWorkoutDiagnosticRepository.get.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/v1/workouts/8/stepper-diagnostic"), context("8"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_stair_workout" });
  });
  it("rejects invalid workout ids without repository access", async () => {
    const response = await GET(new Request("http://localhost/api/v1/workouts/nope/stepper-diagnostic"), context("nope"));
    expect(response.status).toBe(400);
    expect(stepperWorkoutDiagnosticRepository.get).not.toHaveBeenCalled();
  });
});
