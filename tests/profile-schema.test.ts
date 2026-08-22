import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileInputSchema } from "@/modules/profile/profile.schema";

const validProfile = {
  sex: "male",
  dateOfBirth: "1990-05-12",
  heightCm: 180,
  targetWeightKg: 81.4,
  targetDate: "2027-06-01",
};

describe("ProfileInputSchema", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["decimal dot", "81.4", 81.4],
    ["decimal comma", "81,4", 81.4],
  ])("parses target weight using %s", (_label, input, expected) => {
    expect(ProfileInputSchema.parse({ ...validProfile, targetWeightKg: input }).targetWeightKg).toBe(expected);
  });

  it("parses numeric height and converts empty optional fields to null", () => {
    const result = ProfileInputSchema.parse({
      ...validProfile,
      heightCm: "180",
      targetWeightKg: "",
      targetDate: "",
    });
    expect(result).toMatchObject({ heightCm: 180, targetWeightKg: null, targetDate: null });
  });

  it("keeps explicit zero numeric before rejecting it as out of range", () => {
    const result = ProfileInputSchema.safeParse({ ...validProfile, targetWeightKg: "0" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["targetWeightKg"]);
  });

  it.each([
    ["invalid sex", { sex: "other" }, "sex"],
    ["zero height", { heightCm: 0 }, "heightCm"],
    ["excessive height", { heightCm: 301 }, "heightCm"],
    ["negative target weight", { targetWeightKg: -1 }, "targetWeightKg"],
    ["excessive target weight", { targetWeightKg: 501 }, "targetWeightKg"],
  ])("rejects %s", (_label, change, field) => {
    const result = ProfileInputSchema.safeParse({ ...validProfile, ...change });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });

  it("rejects a future date of birth", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00Z"));
    const result = ProfileInputSchema.safeParse({ ...validProfile, dateOfBirth: "2026-08-23" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["dateOfBirth"]);
  });
});
