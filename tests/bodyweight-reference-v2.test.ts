import { describe, expect, it } from "vitest";
import { resolveBodyweightReferenceV2 } from "@/modules/training/bodyweight-reference-v2";

const sample = (id: string, timestamp: string, valueKg: number, source = "apple-health-shortcut") => ({
  id, timestamp: new Date(timestamp), valueKg, source,
});

describe("historical bodyweight resolution v2", () => {
  const localDate = "2026-09-24";
  const modelEstimate = {
    localDate, valueKg: 86.4, episodeId: 7, modelVersion: "episode-v5", uncertainty: null,
  } as const;

  it("prefers exact observed mass, then nearest observed within inclusive seven days", () => {
    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "Europe/Bratislava",
      observedSamples: [sample("exact", "2026-09-24T12:00:00Z", 87), sample("near", "2026-09-23T12:00:00Z", 90)],
      modelEstimate,
    })).toMatchObject({ status: "observed", valueKg: 87, localDate, sourceId: "exact" });

    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "Europe/Bratislava",
      observedSamples: [sample("edge", "2026-10-01T12:00:00Z", 90)],
      modelEstimate,
    })).toMatchObject({
      status: "nearest-observed", valueKg: 90, localDate,
      observationLocalDate: "2026-10-01", dayOffset: 7, approximate: true,
    });

    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "UTC",
      observedSamples: [sample("negative-edge", "2026-09-17T12:00:00Z", 91)],
    })).toMatchObject({
      status: "nearest-observed", valueKg: 91,
      observationLocalDate: "2026-09-17", dayOffset: -7,
    });
  });

  it("rejects observations at either eight-day boundary and breaks equidistant ties toward the earlier day", () => {
    for (const [id, timestamp] of [
      ["outside-before", "2026-09-16T12:00:00Z"],
      ["outside-after", "2026-10-02T12:00:00Z"],
    ] as const) {
      expect(resolveBodyweightReferenceV2({
        localDate, timeZone: "UTC",
        observedSamples: [sample(id, timestamp, 99)],
      }).status).toBe("unavailable");
    }

    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "UTC",
      observedSamples: [
        sample("later", "2026-09-25T12:00:00Z", 91),
        sample("earlier", "2026-09-23T12:00:00Z", 89),
      ],
    })).toMatchObject({ status: "nearest-observed", sourceId: "earlier", dayOffset: -1 });
  });

  it("breaks same-date nearest ties by newest timestamp", () => {
    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "UTC",
      observedSamples: [
        sample("earlier-time", "2026-09-23T10:00:00Z", 88),
        sample("later-time", "2026-09-23T12:00:00Z", 89),
      ],
    })).toMatchObject({ status: "nearest-observed", sourceId: "later-time", valueKg: 89 });
  });

  it("uses a stable ID tie-break after equal timestamps and ignores unproven samples", () => {
    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "UTC",
      observedSamples: [
        sample("2", "2026-09-23T10:00:00Z", 88),
        sample("10", "2026-09-23T10:00:00Z", 89),
        sample("unproven", "2026-09-24T08:00:00Z", 70, "legacy"),
      ],
    })).toMatchObject({ status: "nearest-observed", sourceId: "10", valueKg: 89 });
    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "UTC",
      observedSamples: [sample("unproven", "2026-09-24T08:00:00Z", 70, "legacy")],
    }).status).toBe("unavailable");
  });

  it("uses a model estimate only without a usable observed sample and requires the requested date", () => {
    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "Europe/Bratislava", observedSamples: [], modelEstimate,
    }).status).toBe("model-estimated");
    expect(resolveBodyweightReferenceV2({
      localDate, timeZone: "Europe/Bratislava", observedSamples: [],
      modelEstimate: { ...modelEstimate, localDate: "2026-09-25" },
    }).status).toBe("unavailable");
  });

  it("derives local dates across DST transitions", () => {
    const result = resolveBodyweightReferenceV2({
      localDate: "2026-03-29", timeZone: "Europe/Bratislava",
      observedSamples: [sample("dst", "2026-03-29T00:30:00Z", 87)],
    });
    expect(result).toMatchObject({ status: "observed", localDate: "2026-03-29", sourceId: "dst" });
  });
});
