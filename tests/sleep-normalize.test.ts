import { describe, expect, it } from "vitest";
import { normalizeSleepSegmentsValue } from "@/modules/health/normalize-shortcut-numeric-values";
import { normalizeShortcutNumericValues } from "@/modules/health/normalize-shortcut-numeric-values";
import { HealthDaySchema } from "@/modules/health/health.schema";
import { canonicalizeSleepState } from "@/modules/health/sleep-state";

describe("sleep state mapping", () => {
  it.each([
    ["Без сну", "awake"],
    ["У ліжку", "inBed"],
    ["Повільний", "core"],
    ["Глибокий", "deep"],
    ["Швидкий", "rem"],
    ["WeirdFutureStage", "unknown"],
  ])("maps %s → %s", (raw, expected) => {
    expect(canonicalizeSleepState(raw)).toBe(expected);
  });
});

describe("normalizeSleepSegmentsValue", () => {
  it("accepts canonical arrays", () => {
    expect(normalizeSleepSegmentsValue([
      {
        startAt: "2026-09-16T22:41:00+02:00",
        endAt: "2026-09-16T23:10:00+02:00",
        state: "Повільний",
        rawState: "Повільний",
      },
    ])).toEqual([
      {
        startAt: "2026-09-16T22:41:00+02:00",
        endAt: "2026-09-16T23:10:00+02:00",
        state: "Повільний",
        rawState: "Повільний",
      },
    ]);
  });

  it("parses nested serialized JSON with literal \\n separators", () => {
    const serialized = JSON.stringify({
      startTimestamps: "2026-09-16T22:41:00+02:00\\n2026-09-16T23:10:00+02:00",
      endTimestamps: "2026-09-16T23:10:00+02:00\\n2026-09-16T23:46:00+02:00",
      states: "Повільний\\nГлибокий",
    });
    expect(normalizeSleepSegmentsValue(serialized)).toEqual([
      {
        startAt: "2026-09-16T22:41:00+02:00",
        endAt: "2026-09-16T23:10:00+02:00",
        state: "Повільний",
        rawState: "Повільний",
      },
      {
        startAt: "2026-09-16T23:10:00+02:00",
        endAt: "2026-09-16T23:46:00+02:00",
        state: "Глибокий",
        rawState: "Глибокий",
      },
    ]);
  });

  it("parses actual newlines and CRLF", () => {
    expect(normalizeSleepSegmentsValue({
      startTimestamps: "2026-09-16T22:41:00+02:00\n2026-09-16T23:10:00+02:00\r\n",
      endTimestamps: "2026-09-16T23:10:00+02:00\r\n2026-09-16T23:46:00+02:00",
      states: "Повільний\nГлибокий\n",
    })).toHaveLength(2);
  });

  it("keeps length mismatches as a non-array object for Zod", () => {
    const result = normalizeSleepSegmentsValue({
      startTimestamps: ["2026-09-16T22:41:00+02:00"],
      endTimestamps: ["2026-09-16T23:10:00+02:00", "2026-09-16T23:46:00+02:00"],
      states: ["Повільний"],
    });
    expect(Array.isArray(result)).toBe(false);
  });
});

describe("HealthDaySchema sleepSegments", () => {
  it("canonicalizes Ukrainian states and preserves rawState", () => {
    const parsed = HealthDaySchema.parse({
      date: "2026-09-17",
      sleepSegments: [
        {
          startAt: "2026-09-16T22:41:00+02:00",
          endAt: "2026-09-16T23:10:00+02:00",
          state: "Повільний",
          rawState: "Повільний",
        },
      ],
    });
    expect(parsed.sleepSegments?.[0]).toMatchObject({
      state: "core",
      rawState: "Повільний",
    });
  });

  it("rejects endAt <= startAt", () => {
    expect(() => HealthDaySchema.parse({
      date: "2026-09-17",
      sleepSegments: [
        {
          startAt: "2026-09-16T23:10:00+02:00",
          endAt: "2026-09-16T23:10:00+02:00",
          state: "core",
          rawState: "Повільний",
        },
      ],
    })).toThrow();
  });

  it("normalizes serialized sleepSegments through the day pipeline", () => {
    const normalized = normalizeShortcutNumericValues({
      days: [{
        date: "2026-09-17",
        sleepSegments: JSON.stringify({
          startTimestamps: "2026-09-16T22:41:00+02:00\\n2026-09-16T23:10:00+02:00",
          endTimestamps: "2026-09-16T23:10:00+02:00\\n2026-09-16T23:46:00+02:00",
          states: "Повільний\\nГлибокий",
        }),
      }],
    });
    const parsed = HealthDaySchema.parse((normalized as { days: unknown[] }).days[0]);
    expect(parsed.sleepSegments).toEqual([
      {
        startAt: "2026-09-16T22:41:00+02:00",
        endAt: "2026-09-16T23:10:00+02:00",
        state: "core",
        rawState: "Повільний",
      },
      {
        startAt: "2026-09-16T23:10:00+02:00",
        endAt: "2026-09-16T23:46:00+02:00",
        state: "deep",
        rawState: "Глибокий",
      },
    ]);
  });
});
