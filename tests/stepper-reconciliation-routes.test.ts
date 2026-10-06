import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    stepperReconciliationCandidate: { findMany: vi.fn() },
  },
  confirm: vi.fn(),
  reject: vi.fn(),
  activateVisibility: vi.fn(),
  recordShadow: vi.fn(),
  publishActiveEnergy: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: routeMocks.prisma }));
vi.mock("@/modules/training/stepper-reconciliation.service", () => ({
  confirmStepperReconciliationV1: routeMocks.confirm,
  rejectStepperReconciliationV1: routeMocks.reject,
}));
vi.mock("@/modules/model-episodes/selection-v1-episode-ops", () => ({
  activateConfirmedReconciliationVisibilityV1: routeMocks.activateVisibility,
}));
vi.mock("@/modules/profile/experimental-stepper-active-energy-shadow.service", () => ({
  recordExperimentalStepperActiveEnergyShadowsForWorkouts: routeMocks.recordShadow,
}));
vi.mock("@/modules/activity/active-energy-publication", () => ({
  publishActiveEnergyChangesV1: routeMocks.publishActiveEnergy,
}));

import { POST as confirm } from "@/app/api/v1/training/stepper-reconciliation/confirm/route";
import { POST as reject } from "@/app/api/v1/training/stepper-reconciliation/reject/route";

const jsonRequest = (body: unknown) => new Request("http://localhost/api/v1/training/stepper-reconciliation", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Stepper reconciliation write routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    routeMocks.prisma.stepperReconciliationCandidate.findMany.mockResolvedValue([]);
    routeMocks.confirm.mockResolvedValue(undefined);
    routeMocks.reject.mockResolvedValue(undefined);
    routeMocks.activateVisibility.mockResolvedValue(undefined);
    routeMocks.recordShadow.mockResolvedValue(undefined);
    routeMocks.publishActiveEnergy.mockResolvedValue(undefined);
  });

  it("rejects malformed confirmation input before reconciliation or visibility side effects", async () => {
    const response = await confirm(jsonRequest({ manualWorkoutId: 0, garminWorkoutId: 22 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "validation_error",
      details: [expect.objectContaining({ path: ["manualWorkoutId"], code: "too_small" })],
    });
    expect(routeMocks.confirm).not.toHaveBeenCalled();
    expect(routeMocks.activateVisibility).not.toHaveBeenCalled();
    expect(routeMocks.recordShadow).not.toHaveBeenCalled();
    expect(routeMocks.publishActiveEnergy).not.toHaveBeenCalled();
  });

  it("confirms normally while leaving visibility activation untouched", async () => {
    const response = await confirm(jsonRequest({ manualWorkoutId: 31, garminWorkoutId: 44 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, activated: false });
    expect(routeMocks.confirm).toHaveBeenCalledExactlyOnceWith(routeMocks.prisma, {
      manualWorkoutId: 31,
      garminWorkoutId: 44,
    });
    expect(routeMocks.activateVisibility).not.toHaveBeenCalled();
    expect(routeMocks.recordShadow).toHaveBeenCalledExactlyOnceWith({
      workoutIds: [31, 44],
      profileId: 1,
    });
    expect(routeMocks.publishActiveEnergy).toHaveBeenCalledExactlyOnceWith();
  });

  it("runs explicitly authorized visibility activation once with the selected generation", async () => {
    const response = await confirm(jsonRequest({
      manualWorkoutId: 31,
      garminWorkoutId: 44,
      activateVisibility: true,
      generationId: "reviewed-reconciliation-17",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, activated: true });
    expect(routeMocks.confirm).toHaveBeenCalledExactlyOnceWith(routeMocks.prisma, {
      manualWorkoutId: 31,
      garminWorkoutId: 44,
    });
    expect(routeMocks.activateVisibility).toHaveBeenCalledExactlyOnceWith({
      client: routeMocks.prisma,
      generationId: "reviewed-reconciliation-17",
      manualWorkoutId: 31,
      garminWorkoutId: 44,
    });
    expect(routeMocks.confirm.mock.invocationCallOrder[0]).toBeLessThan(
      routeMocks.activateVisibility.mock.invocationCallOrder[0]!,
    );
    expect(routeMocks.recordShadow).toHaveBeenCalledExactlyOnceWith({
      workoutIds: [31, 44],
      profileId: 1,
    });
    expect(routeMocks.publishActiveEnergy).toHaveBeenCalledExactlyOnceWith();
  });

  it("maps an already-confirmed domain conflict and does not publish or activate", async () => {
    routeMocks.confirm.mockRejectedValueOnce(new Error("already confirmed"));

    const response = await confirm(jsonRequest({ manualWorkoutId: 31, garminWorkoutId: 44 }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "already confirmed" });
    expect(routeMocks.activateVisibility).not.toHaveBeenCalled();
    expect(routeMocks.recordShadow).not.toHaveBeenCalled();
    expect(routeMocks.publishActiveEnergy).not.toHaveBeenCalled();
  });

  it("stops authorized follow-up publication when activation fails", async () => {
    routeMocks.activateVisibility.mockRejectedValueOnce(new Error("activation failed"));

    const response = await confirm(jsonRequest({
      manualWorkoutId: 31,
      garminWorkoutId: 44,
      activateVisibility: true,
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_error" });
    expect(routeMocks.confirm).toHaveBeenCalledOnce();
    expect(routeMocks.activateVisibility).toHaveBeenCalledExactlyOnceWith({
      client: routeMocks.prisma,
      generationId: "recon-31-44",
      manualWorkoutId: 31,
      garminWorkoutId: 44,
    });
    expect(routeMocks.recordShadow).not.toHaveBeenCalled();
    expect(routeMocks.publishActiveEnergy).not.toHaveBeenCalled();
  });

  it("rejects malformed rejection input without loading or mutating a candidate group", async () => {
    const response = await reject(jsonRequest({ groupId: -4 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "validation_error",
      details: [expect.objectContaining({ path: ["groupId"], code: "too_small" })],
    });
    expect(routeMocks.prisma.stepperReconciliationCandidate.findMany).not.toHaveBeenCalled();
    expect(routeMocks.reject).not.toHaveBeenCalled();
  });

  it("rejects only the requested group and never activates visibility", async () => {
    routeMocks.prisma.stepperReconciliationCandidate.findMany.mockResolvedValue([
      { manualWorkoutId: 31, garminWorkoutId: 44 },
      { manualWorkoutId: 31, garminWorkoutId: 45 },
    ]);

    const response = await reject(jsonRequest({ groupId: 70 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(routeMocks.prisma.stepperReconciliationCandidate.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { groupId: 70 },
      select: { manualWorkoutId: true, garminWorkoutId: true },
    });
    expect(routeMocks.reject).toHaveBeenCalledExactlyOnceWith(routeMocks.prisma, { groupId: 70 });
    expect(routeMocks.activateVisibility).not.toHaveBeenCalled();
    expect(routeMocks.recordShadow).toHaveBeenCalledExactlyOnceWith({
      workoutIds: [31, 44, 45],
      profileId: 1,
    });
    expect(routeMocks.publishActiveEnergy).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not emit shadow or publication side effects when group rejection fails", async () => {
    routeMocks.reject.mockRejectedValueOnce(new Error("database write failed"));

    const response = await reject(jsonRequest({ groupId: 70 }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_error" });
    expect(routeMocks.recordShadow).not.toHaveBeenCalled();
    expect(routeMocks.publishActiveEnergy).not.toHaveBeenCalled();
  });
});
