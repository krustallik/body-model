import { describe, expect, it } from "vitest";
import {
  backfillLegacyWeightProvenance,
  LEGACY_WEIGHT_PROVENANCE_BACKFILL_SOURCE,
  LEGACY_WEIGHT_PROVENANCE_BACKFILL_WHERE,
  summarizeLegacyWeightProvenanceBackfill,
} from "@/modules/health/legacy-weight-provenance-backfill";
import { resolveBodyweightReferenceV2 } from "@/modules/training/bodyweight-reference-v2";

type Row = { id: number; metric: string; source: string | null; date: string; timestamp: Date; value: number };

function memoryClient(initial: Row[]) {
  const rows = structuredClone(initial);
  const healthMetricSample = {
    async aggregate() {
      const selected = rows.filter((row) => row.metric === "weight-kg" && row.source === null);
      const dates = selected.map((row) => row.date).sort();
      return {
        _count: { _all: selected.length },
        _min: { date: dates[0] ?? null },
        _max: { date: dates.at(-1) ?? null },
      };
    },
    async updateMany(args: { where: { metric: string; source: null }; data: { source: string } }) {
      let count = 0;
      for (const row of rows) {
        if (row.metric === args.where.metric && row.source === args.where.source) {
          row.source = args.data.source;
          count += 1;
        }
      }
      return { count };
    },
  };
  return { rows, client: { healthMetricSample } };
}

describe("legacy Apple weight provenance correction", () => {
  it("targets only NULL-source weight rows, preserves marked/non-weight rows, and is idempotent", async () => {
    const { rows, client } = memoryClient([
      { id: 1, metric: "weight-kg", source: null, date: "2026-09-16", timestamp: new Date("2026-09-16T08:00:00Z"), value: 89.8 },
      { id: 2, metric: "weight-kg", source: "apple-health-shortcut", date: "2026-09-17", timestamp: new Date("2026-09-17T08:00:00Z"), value: 88.9 },
      { id: 3, metric: "heart-rate-bpm", source: null, date: "2026-09-16", timestamp: new Date("2026-09-16T08:00:00Z"), value: 70 },
    ]);
    const beforeRows = structuredClone(rows);
    const reviewed = await summarizeLegacyWeightProvenanceBackfill(client as never);
    expect(reviewed).toEqual({ count: 1, minDate: "2026-09-16", maxDate: "2026-09-16" });
    expect(LEGACY_WEIGHT_PROVENANCE_BACKFILL_WHERE).toEqual({ metric: "weight-kg", source: null });

    const result = await backfillLegacyWeightProvenance(client as never, reviewed);
    expect(result).toMatchObject({ updatedCount: 1, remaining: { count: 0, minDate: null, maxDate: null } });
    expect(rows[0]).toEqual({ ...beforeRows[0], source: LEGACY_WEIGHT_PROVENANCE_BACKFILL_SOURCE });
    expect(rows[1]).toEqual(beforeRows[1]);
    expect(rows[2]).toEqual(beforeRows[2]);

    const repeat = await backfillLegacyWeightProvenance(client as never, { count: 0, minDate: null, maxDate: null });
    expect(repeat.updatedCount).toBe(0);
    expect(rows[1]).toEqual(beforeRows[1]);
    expect(rows[2]).toEqual(beforeRows[2]);
  });

  it("makes an authoritative legacy sample visible without changing date/tie-break semantics", async () => {
    const target = new Date("2026-09-16T08:00:00Z");
    const samples = [
      { id: "legacy", timestamp: target, valueKg: 89.8, source: null },
      { id: "older", timestamp: new Date("2026-09-15T08:00:00Z"), valueKg: 89.7, source: "apple-health-shortcut" },
    ];
    expect(resolveBodyweightReferenceV2({ localDate: "2026-09-16", timeZone: "Europe/Bratislava", observedSamples: samples })).toMatchObject({ status: "nearest-observed", valueKg: 89.7 });
    expect(resolveBodyweightReferenceV2({
      localDate: "2026-09-16",
      timeZone: "Europe/Bratislava",
      observedSamples: [{ ...samples[0]!, source: "apple-health-shortcut" }, samples[1]!],
    })).toMatchObject({ status: "observed", valueKg: 89.8, localDate: "2026-09-16", source: "apple-health-shortcut" });
    expect(resolveBodyweightReferenceV2({
      localDate: "2026-09-16",
      timeZone: "Europe/Bratislava",
      observedSamples: [
        { id: "tie-a", timestamp: new Date("2026-09-16T08:00:00Z"), valueKg: 90, source: "apple-health-shortcut" },
        { id: "tie-b", timestamp: new Date("2026-09-16T08:00:00Z"), valueKg: 91, source: "apple-health-shortcut" },
      ],
    })).toMatchObject({ status: "observed", valueKg: 91 });
  });

  it("rejects a write when the reviewed dry-run scope has changed", async () => {
    const { client } = memoryClient([
      { id: 1, metric: "weight-kg", source: null, date: "2026-09-16", timestamp: new Date("2026-09-16T08:00:00Z"), value: 89.8 },
    ]);
    await expect(backfillLegacyWeightProvenance(client as never, { count: 0, minDate: null, maxDate: null }))
      .rejects.toThrow("scope changed since dry-run");
  });
});
