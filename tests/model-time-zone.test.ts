import { describe, expect, it } from "vitest";
import {
  instantToLocalDateTime,
  isValidTimeZone,
  LocalTimeError,
  localDateTimeToInstant,
} from "@/model/time-zone";

describe("IANA timezone conversion", () => {
  it("converts Košice summer time to UTC without using server-local time", () => {
    expect(localDateTimeToInstant("2026-08-23", "10:00", "Europe/Bratislava").toISOString())
      .toBe("2026-08-23T08:00:00.000Z");
  });

  it("applies the winter UTC+1 offset rather than a fixed UTC+2", () => {
    expect(localDateTimeToInstant("2026-01-23", "10:00", "Europe/Bratislava").toISOString())
      .toBe("2026-01-23T09:00:00.000Z");
  });

  it("round-trips an instant to local date and time", () => {
    expect(instantToLocalDateTime(new Date("2026-08-23T08:00:00Z"), "Europe/Bratislava"))
      .toEqual({ date: "2026-08-23", time: "10:00" });
  });

  it.each([
    ["2026-03-29", "02:30", "nonexistent-local-time"],
    ["2026-10-25", "02:30", "ambiguous-local-time"],
  ])("rejects DST gap/fold local time %s %s", (date, time, code) => {
    try {
      localDateTimeToInstant(date, time, "Europe/Bratislava");
      throw new Error("expected timezone conversion to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalTimeError);
      expect((error as LocalTimeError).code).toBe(code);
    }
  });

  it.each([
    ["2026-02-30", "10:00"],
    ["2026-08-23", "24:00"],
    ["23-08-2026", "10:00"],
  ])("rejects invalid local date/time %s %s", (date, time) => {
    expect(() => localDateTimeToInstant(date, time, "Europe/Bratislava")).toThrow(RangeError);
  });

  it("validates IANA zones and invalid instants", () => {
    expect(isValidTimeZone("Europe/Bratislava")).toBe(true);
    expect(isValidTimeZone("Mars/Košice")).toBe(false);
    expect(() => instantToLocalDateTime(new Date(Number.NaN), "Europe/Bratislava"))
      .toThrow(TypeError);
  });
});
