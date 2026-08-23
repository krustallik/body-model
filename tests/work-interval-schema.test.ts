import { describe, expect, it } from "vitest";
import {
  CreateWorkIntervalSchema,
  UpdateWorkIntervalSchema,
  WorkIntervalIdParamsSchema,
  WorkIntervalListQuerySchema,
} from "@/modules/work-intervals/work-interval.schema";

const valid = {
  date: "2026-08-23",
  startTime: "08:00",
  endTime: "16:00",
  category: "standingLight",
};

describe("work interval validation", () => {
  it("defaults to the user's Košice IANA timezone", () => {
    expect(CreateWorkIntervalSchema.parse(valid).timezone).toBe("Europe/Bratislava");
  });

  it("accepts every supported category", () => {
    for (const category of ["standingLight", "manualLight", "standingLightModerate", "manualModerate"]) {
      expect(CreateWorkIntervalSchema.safeParse({ ...valid, category }).success).toBe(true);
    }
  });

  it.each([
    { ...valid, date: "2026-02-30" },
    { ...valid, startTime: "8:00" },
    { ...valid, endTime: "08:00" },
    { ...valid, endTime: "07:00" },
    { ...valid, timezone: "GMT+2" },
    { ...valid, category: "office" },
    { ...valid, date: "2026-03-29", startTime: "02:30", endTime: "04:00" },
    { ...valid, date: "2026-10-25", startTime: "02:30", endTime: "04:00" },
  ])("rejects invalid or unsafe interval %#", (input) => {
    expect(CreateWorkIntervalSchema.safeParse(input).success).toBe(false);
  });

  it("supports partial nonempty PATCH and validates ids/query", () => {
    expect(UpdateWorkIntervalSchema.safeParse({ category: "manualLight" }).success).toBe(true);
    expect(UpdateWorkIntervalSchema.safeParse({}).success).toBe(false);
    expect(WorkIntervalIdParamsSchema.parse({ id: "12" }).id).toBe(12);
    expect(WorkIntervalIdParamsSchema.safeParse({ id: "0" }).success).toBe(false);
    expect(WorkIntervalIdParamsSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(WorkIntervalListQuerySchema.safeParse({ date: "2026-08-23" }).success).toBe(true);
    expect(WorkIntervalListQuerySchema.safeParse({ unknown: "x" }).success).toBe(false);
  });
});
