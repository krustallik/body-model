import { beforeEach, describe, expect, it, vi } from "vitest";

const stepperWorkoutRepository = vi.hoisted(() => ({ resolveCreateOperation: vi.fn() }));
vi.mock("@/modules/training/stepper-workout.repository", () => ({ stepperWorkoutRepository }));

import { GET } from "@/app/api/v1/training/stepper-create-operations/[operationId]/route";

const operationId = "08a2c74a-9ff7-4aa2-8b6e-23a826938442";
const payloadDigest = "a".repeat(64);
const params = { params: Promise.resolve({ operationId }) };

describe("Stepper create operation status route", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires and forwards the canonical payload digest before resolving an operation", async () => {
    const missingDigest = await GET(
      new Request(`http://localhost/api/v1/training/stepper-create-operations/${operationId}`),
      params,
    );
    expect(missingDigest.status).toBe(400);
    expect(stepperWorkoutRepository.resolveCreateOperation).not.toHaveBeenCalled();

    stepperWorkoutRepository.resolveCreateOperation.mockResolvedValue({ state: "CONFLICT" });
    const conflict = await GET(
      new Request(`http://localhost/api/v1/training/stepper-create-operations/${operationId}?payloadDigest=${payloadDigest}`),
      params,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ state: "CONFLICT" });
    expect(stepperWorkoutRepository.resolveCreateOperation).toHaveBeenCalledWith({ operationId, payloadDigest });
  });
});
