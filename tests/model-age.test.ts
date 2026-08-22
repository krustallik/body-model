import { describe, expect, it } from "vitest";
import { calculateAge } from "@/model/age";

describe("calculateAge", () => {
  it("uses completed years when the birthday is before the reference date", () => {
    expect(calculateAge("1990-05-12", "2026-08-22")).toBe(36);
  });

  it("does not count the current year when the birthday is after the reference date", () => {
    expect(calculateAge("1990-11-12", "2026-08-22")).toBe(35);
  });

  it("counts a birthday exactly on the reference date", () => {
    expect(calculateAge("1990-08-22", "2026-08-22")).toBe(36);
  });

  it("handles leap-day birthdays using the calendar date", () => {
    expect(calculateAge("2000-02-29", "2024-02-29")).toBe(24);
    expect(calculateAge("2000-02-29", "2023-02-28")).toBe(22);
    expect(calculateAge("2000-02-29", "2023-03-01")).toBe(23);
  });

  it.each([
    ["bad format", "1990/01/01", "2026-08-22"],
    ["invalid birth date", "1990-02-30", "2026-08-22"],
    ["invalid reference date", "1990-01-01", "2026-13-01"],
    ["year zero", "0000-01-01", "2026-08-22"],
  ])("rejects %s", (_label, birth, reference) => {
    expect(() => calculateAge(birth, reference)).toThrow();
  });

  it("rejects a birth date after the reference date", () => {
    expect(() => calculateAge("2026-08-23", "2026-08-22")).toThrow(RangeError);
  });
});
