import { describe, expect, it } from "vitest";
import { resolveBodyweightReferenceV1 } from "@/modules/training/bodyweight-reference-v1";

describe("historical bodyweight reference resolution", () => {
  const modelEstimate = {
    localDate: "2026-09-24", valueKg: 86.4, episodeId: 7,
    modelVersion: "episode-v5", uncertainty: null,
  } as const;

  it("prefers the newest observed sample on the exact local date", () => {
    const result = resolveBodyweightReferenceV1({
      localDate: "2026-09-24", timeZone: "Europe/Bratislava",
      observedSamples: [
        { id: "old", timestamp: new Date("2026-09-24T06:00:00Z"), valueKg: 88, source: "apple-health-shortcut" },
        { id: "new", timestamp: new Date("2026-09-24T21:00:00Z"), valueKg: 87, source: "apple-health-shortcut" },
        { id: "wrong-source", timestamp: new Date("2026-09-24T22:00:00Z"), valueKg: 70, source: "other" },
      ],
      modelEstimate,
    });
    expect(result).toMatchObject({ status: "observed", valueKg: 87, sourceId: "new" });
  });

  it("uses model output only when exact-day observed data is absent", () => {
    const result = resolveBodyweightReferenceV1({
      localDate: "2026-09-24", timeZone: "Europe/Bratislava",
      observedSamples: [
        { id: "next-local-day", timestamp: new Date("2026-09-24T23:15:00Z"), valueKg: 99, source: "apple-health-shortcut" },
      ],
      modelEstimate,
    });
    expect(result).toMatchObject({
      status: "model-estimated", valueKg: 86.4, sourceId: "7", modelVersion: "episode-v5",
    });
  });

  it("does not fall back to current or wrong-date weight", () => {
    const result = resolveBodyweightReferenceV1({
      localDate: "2026-09-24", timeZone: "UTC",
      observedSamples: [
        { id: "future", timestamp: new Date("2026-09-25T12:00:00Z"), valueKg: 99, source: "apple-health-shortcut" },
      ],
      modelEstimate: { ...modelEstimate, localDate: "2026-09-25" },
    });
    expect(result).toMatchObject({ status: "unavailable", valueKg: null });
  });

  it("rejects impossible local dates and invalid timezones", () => {
    expect(resolveBodyweightReferenceV1({
      localDate: "2026-02-30", timeZone: "UTC", observedSamples: [],
    }).status).toBe("unavailable");
    expect(resolveBodyweightReferenceV1({
      localDate: "2026-09-24", timeZone: "Mars/Olympus", observedSamples: [],
    }).status).toBe("unavailable");
  });
});
