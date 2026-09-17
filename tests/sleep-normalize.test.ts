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

  it("keeps Shortcut dictionaries as parallel series for Zod", () => {
    expect(normalizeSleepSegmentsValue({
      startTimestamps: "2026-09-16T22:41:00+02:00\n2026-09-16T23:10:00+02:00",
      endTimestamps: "2026-09-16T23:10:00+02:00\n2026-09-16T23:46:00+02:00",
      states: "Повільний\nГлибокий",
    })).toEqual({
      startTimestamps: ["2026-09-16T22:41:00+02:00", "2026-09-16T23:10:00+02:00"],
      endTimestamps: ["2026-09-16T23:10:00+02:00", "2026-09-16T23:46:00+02:00"],
      states: ["Повільний", "Глибокий"],
    });
  });

  it("parses nested serialized JSON with literal \\n separators", () => {
    const serialized = JSON.stringify({
      startTimestamps: "2026-09-16T22:41:00+02:00\\n2026-09-16T23:10:00+02:00",
      endTimestamps: "2026-09-16T23:10:00+02:00\\n2026-09-16T23:46:00+02:00",
      states: "Повільний\\nГлибокий",
    });
    expect(normalizeSleepSegmentsValue(serialized)).toEqual({
      startTimestamps: ["2026-09-16T22:41:00+02:00", "2026-09-16T23:10:00+02:00"],
      endTimestamps: ["2026-09-16T23:10:00+02:00", "2026-09-16T23:46:00+02:00"],
      states: ["Повільний", "Глибокий"],
    });
  });

  it("parses actual newlines and CRLF", () => {
    const result = normalizeSleepSegmentsValue({
      startTimestamps: "2026-09-16T22:41:00+02:00\n2026-09-16T23:10:00+02:00\r\n",
      endTimestamps: "2026-09-16T23:10:00+02:00\r\n2026-09-16T23:46:00+02:00",
      states: "Повільний\nГлибокий\n",
    }) as { startTimestamps: string[] };
    expect(result.startTimestamps).toHaveLength(2);
  });

  it("preserves length mismatches in the parallel dictionary", () => {
    const result = normalizeSleepSegmentsValue({
      startTimestamps: ["2026-09-16T22:41:00+02:00"],
      endTimestamps: ["2026-09-16T23:10:00+02:00", "2026-09-16T23:46:00+02:00"],
      states: ["Повільний"],
    }) as { startTimestamps: string[]; endTimestamps: string[]; states: string[] };
    expect(result.startTimestamps).toHaveLength(1);
    expect(result.endTimestamps).toHaveLength(2);
    expect(result.states).toHaveLength(1);
  });

  it("reads nested keys case-insensitively", () => {
    expect(normalizeSleepSegmentsValue({
      StartTimestamps: ["2026-09-16T22:41:00+02:00"],
      EndTimestamps: ["2026-09-16T23:10:00+02:00"],
      States: ["Повільний"],
    })).toEqual({
      startTimestamps: ["2026-09-16T22:41:00+02:00"],
      endTimestamps: ["2026-09-16T23:10:00+02:00"],
      states: ["Повільний"],
    });
  });
});

describe("HealthDaySchema sleepSegments", () => {
  it("accepts the raw iPhone Shortcut dictionary object", () => {
    const parsed = HealthDaySchema.parse({
      date: "2026-09-17",
      sleepSegments: {
        startTimestamps: [
          "2026-09-16T22:41:00+02:00",
          "2026-09-16T23:10:00+02:00",
        ],
        endTimestamps: [
          "2026-09-16T23:10:00+02:00",
          "2026-09-16T23:46:00+02:00",
        ],
        states: ["Повільний", "Глибокий"],
      },
    });
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

  it("reports mismatched parallel series clearly", () => {
    const result = HealthDaySchema.safeParse({
      date: "2026-09-17",
      sleepSegments: {
        startTimestamps: ["2026-09-16T22:41:00+02:00"],
        endTimestamps: ["2026-09-16T23:10:00+02:00", "2026-09-16T23:46:00+02:00"],
        states: ["Повільний"],
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => (
      issue.message.includes("must have the same length")
    ))).toBe(true);
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
