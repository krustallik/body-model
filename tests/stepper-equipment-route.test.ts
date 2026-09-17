import { beforeEach, describe, expect, it, vi } from "vitest";

const stepperEquipmentRepository = vi.hoisted(() => ({ list: vi.fn(), configureMs100: vi.fn() }));
vi.mock("@/modules/profile/stepper-equipment.repository", () => ({ stepperEquipmentRepository }));

import { GET, POST } from "@/app/api/v1/profile/stepper-equipment/route";

const assignment = {
  id: 1,
  machineFamily: "DOMYOS_MS100",
  configuration: "fixed",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  effectiveTo: null,
  createdAt: "2026-09-17T12:00:00.000Z",
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/v1/profile/stepper-equipment", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("/api/v1/profile/stepper-equipment", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists immutable assignment history", async () => {
    stepperEquipmentRepository.list.mockResolvedValue([assignment]);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ assignments: [assignment] });
  });

  it("creates an explicitly effective configuration", async () => {
    stepperEquipmentRepository.configureMs100.mockResolvedValue(assignment);
    const response = await POST(request({ effectiveFrom: assignment.effectiveFrom }));
    expect(response.status).toBe(201);
    expect(stepperEquipmentRepository.configureMs100).toHaveBeenCalledWith(assignment.effectiveFrom);
  });

  it("rejects a configuration without an offset timestamp", async () => {
    const response = await POST(request({ effectiveFrom: "2026-09-01" }));
    expect(response.status).toBe(400);
    expect(stepperEquipmentRepository.configureMs100).not.toHaveBeenCalled();
  });
});
