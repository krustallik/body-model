import { beforeEach, describe, expect, it, vi } from "vitest";

const profileRepository = vi.hoisted(() => ({
  get: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/modules/profile/profile.repository", () => ({ profileRepository }));

import { GET, PUT } from "@/app/api/v1/profile/route";

const url = "http://localhost/api/v1/profile";
const profile = {
  id: 1,
  sex: "male",
  dateOfBirth: "1990-05-12",
  heightCm: 180,
  targetWeightKg: 81.4,
  targetDate: "2027-06-01",
  createdAt: "2026-08-22T10:00:00.000Z",
  updatedAt: "2026-08-22T10:00:00.000Z",
};

function request(body: unknown): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/v1/profile", () => {
  beforeEach(() => {
    vi.useRealTimers();
    profileRepository.get.mockReset();
    profileRepository.upsert.mockReset();
  });

  it("returns null before a profile is created", async () => {
    profileRepository.get.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profile: null });
  });

  it("creates a profile and parses decimal comma", async () => {
    profileRepository.upsert.mockResolvedValue(profile);
    const response = await PUT(request({
      sex: "male",
      dateOfBirth: "1990-05-12",
      heightCm: "180",
      targetWeightKg: "81,4",
      targetDate: "2027-06-01",
    }));

    expect(response.status).toBe(200);
    expect(profileRepository.upsert).toHaveBeenCalledWith({
      sex: "male",
      dateOfBirth: "1990-05-12",
      heightCm: 180,
      targetWeightKg: 81.4,
      targetDate: "2027-06-01",
    });
  });

  it("fully updates a profile and clears omitted goal values", async () => {
    profileRepository.upsert.mockResolvedValue({ ...profile, targetWeightKg: null, targetDate: null });
    const response = await PUT(request({
      sex: "female",
      dateOfBirth: "1991-01-01",
      heightCm: "171.5",
      targetWeightKg: "",
      targetDate: "",
    }));

    expect(response.status).toBe(200);
    expect(profileRepository.upsert).toHaveBeenCalledWith({
      sex: "female",
      dateOfBirth: "1991-01-01",
      heightCm: 171.5,
      targetWeightKg: null,
      targetDate: null,
    });
  });

  it.each([
    ["invalid sex", { ...profile, sex: "other" }],
    ["future date of birth", { ...profile, dateOfBirth: "2999-01-01" }],
    ["invalid height", { ...profile, heightCm: 0 }],
    ["invalid target weight", { ...profile, targetWeightKg: -1 }],
  ])("returns validation errors for %s", async (_label, body) => {
    const response = await PUT(request({
      sex: body.sex,
      dateOfBirth: body.dateOfBirth,
      heightCm: body.heightCm,
      targetWeightKg: body.targetWeightKg,
      targetDate: body.targetDate,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
    expect(profileRepository.upsert).not.toHaveBeenCalled();
  });
});
