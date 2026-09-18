import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createUnavailablePhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import type { PhysiologyDayResultV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { addCalendarDays } from "./model-calendar";
import { currentPhysiologyV7Versions } from "./physiology-v7-persistence";
import { PhysiologyV7PersistenceRepository } from "./physiology-v7-persistence.repository";
import { PhysiologyV7PersistedRebuildService } from "./physiology-v7-persisted-rebuild.service";

export const PHYSIOLOGY_V7_SHADOW_VERSION = "bodycast-physiology-v7-shadow-1" as const;
const LARGE_DIVERGENCE_KG = 5;

type ShadowRequest = {
  profileId: number;
  fromDate: string;
  toDate: string;
  timeZone: string;
  productionEpisodeId?: number;
  productionModelVersion?: string;
  /** Diagnostic test/read mode; production shadow always rebuilds first. */
  rebuild?: boolean;
};

type Rebuild = Pick<PhysiologyV7PersistedRebuildService, "rebuild">;

function dates(fromDate: string, toDate: string): string[] {
  const values: string[] = [];
  for (let date = fromDate; date <= toDate; date = addCalendarDays(date, 1)) values.push(date);
  return values;
}

function productionProjection(row: {
  id: number; status: string; modelVersion: string; filteredWeightKg: number | null;
  fatMassKg: number | null; leanTissueKg: number | null; glycogenKg: number | null;
  extracellularFluidDeviationLiters: number | null;
}) {
  return {
    identifier: row.id, status: row.status, modelVersion: row.modelVersion,
    filteredWeightKg: row.filteredWeightKg, fatMassKg: row.fatMassKg,
    leanTissueKg: row.leanTissueKg, glycogenKg: row.glycogenKg,
    extracellularFluidDeviationLiters: row.extracellularFluidDeviationLiters,
  };
}

function v7Projection(result: PhysiologyDayResultV7 | null) {
  if (result === null) return { observedWeightKg: null, reconstructedModelMassKg: null, compartments: null, counts: { known: 0, carried: 0, unavailable: 0 } };
  const compartments = result.resultingState.compartments;
  const values = Object.fromEntries(Object.entries(compartments).map(([key, value]) => [key, value.availability === "available" ? value.valueKg : null]));
  const all = Object.values(compartments);
  return {
    observedWeightKg: result.observations.observedWeightKg.valueKg,
    reconstructedModelMassKg: result.massReconstruction.valueKg,
    compartments: values,
    counts: {
      known: all.filter((value) => value.transitionStatus === "known-numeric").length,
      carried: all.filter((value) => value.transitionStatus === "carried-forward").length,
      unavailable: all.filter((value) => value.availability === "unavailable").length,
    },
  };
}

/**
 * Operational side-channel only. It may refresh the derived v7 cache, but it
 * never writes durable sources or legacy production output and its own rows
 * are never read by forecast/TDEE/physiology calculation paths.
 */
export class PhysiologyV7ShadowService {
  constructor(
    private readonly client: PrismaClient = prisma,
    private readonly rebuildService: Rebuild = new PhysiologyV7PersistedRebuildService(),
    private readonly persistence = new PhysiologyV7PersistenceRepository(client),
  ) {}

  async run(input: ShadowRequest): Promise<void> {
    const startedAt = Date.now();
    const rangeDates = dates(input.fromDate, input.toDate);
    const productionRows = await this.client.dailyModelState.findMany({
      where: { date: { gte: input.fromDate, lte: input.toDate }, episode: { profileId: input.profileId } },
      select: { id: true, date: true, status: true, modelVersion: true, filteredWeightKg: true, fatMassKg: true, leanTissueKg: true, glycogenKg: true, extracellularFluidDeviationLiters: true },
    });
    const productionByDate = new Map(productionRows.map((row) => [row.date, row]));
    try {
      if (input.rebuild !== false) {
        await this.rebuildService.rebuild({
          profileId: input.profileId, fromDate: input.fromDate, toDate: input.toDate,
          historyFromDate: input.fromDate, timeZone: input.timeZone,
          initialState: createUnavailablePhysiologyRuntimeStateV7(),
        });
      }
      const v7Rows = new Map((await this.persistence.readRange(input.profileId, input.fromDate, input.toDate)).map((row) => [row.date, row]));
      await Promise.all(rangeDates.map(async (date) => {
        const v7 = v7Rows.get(date) ?? { status: "missing" as const, date, resultFingerprint: null, result: null };
        const projection = v7Projection(v7.result);
        const reasons: string[] = [];
        if (v7.status === "missing") reasons.push("v7-missing-result");
        if (v7.status === "stale") reasons.push("v7-stale-cache");
        if (projection.counts.unavailable > 0) reasons.push("v7-unavailable-compartments");
        if (v7.status === "stale") reasons.push("v7-version-or-lifecycle-mismatch");
        const production = productionByDate.get(date);
        const comparison = {
          availability: "unavailable",
          reason: "legacy-and-v7-output-semantics-not-compatible",
          largeDivergenceThresholdKg: LARGE_DIVERGENCE_KG,
          divergenceKg: null,
        };
        await this.client.physiologyV7ShadowDiagnostic.upsert({
          where: { profileId_date: { profileId: input.profileId, date } },
          create: {
            profileId: input.profileId, date, productionEpisodeId: input.productionEpisodeId ?? null,
            productionModelVersion: input.productionModelVersion ?? production?.modelVersion ?? null,
            productionOutput: (production ? productionProjection(production) : { availability: "missing" }) as Prisma.InputJsonValue,
            v7Status: v7.status, v7ResultFingerprint: v7.resultFingerprint,
            v7Versions: currentPhysiologyV7Versions as Prisma.InputJsonValue,
            v7Projection: projection as Prisma.InputJsonValue, comparison: comparison as Prisma.InputJsonValue,
            reasonCodes: reasons as Prisma.InputJsonValue, runtimeDurationMs: Date.now() - startedAt,
            executionStatus: "success", errorCode: null,
          },
          update: {
            productionEpisodeId: input.productionEpisodeId ?? null,
            productionModelVersion: input.productionModelVersion ?? production?.modelVersion ?? null,
            productionOutput: (production ? productionProjection(production) : { availability: "missing" }) as Prisma.InputJsonValue,
            v7Status: v7.status, v7ResultFingerprint: v7.resultFingerprint,
            v7Versions: currentPhysiologyV7Versions as Prisma.InputJsonValue,
            v7Projection: projection as Prisma.InputJsonValue, comparison: comparison as Prisma.InputJsonValue,
            reasonCodes: reasons as Prisma.InputJsonValue, runtimeDurationMs: Date.now() - startedAt,
            executionStatus: "success", errorCode: null,
          },
        });
      }));
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : "shadow-unknown-failure";
      await Promise.all(rangeDates.map((date) => this.client.physiologyV7ShadowDiagnostic.upsert({
        where: { profileId_date: { profileId: input.profileId, date } },
        create: { profileId: input.profileId, date, productionEpisodeId: input.productionEpisodeId ?? null,
          productionModelVersion: input.productionModelVersion ?? null, productionOutput: { availability: "not-read-after-shadow-failure" },
          v7Status: "failure", v7ResultFingerprint: null, v7Versions: currentPhysiologyV7Versions as Prisma.InputJsonValue,
          v7Projection: { availability: "unavailable" }, comparison: { availability: "unavailable", reason: "shadow-rebuild-failure" },
          reasonCodes: ["v7-rebuild-failure"], runtimeDurationMs: Date.now() - startedAt, executionStatus: "failure", errorCode },
        update: { v7Status: "failure", v7ResultFingerprint: null, v7Versions: currentPhysiologyV7Versions as Prisma.InputJsonValue,
          v7Projection: { availability: "unavailable" }, comparison: { availability: "unavailable", reason: "shadow-rebuild-failure" },
          reasonCodes: ["v7-rebuild-failure"], runtimeDurationMs: Date.now() - startedAt, executionStatus: "failure", errorCode },
      })));
    }
  }
}

export const physiologyV7ShadowService = new PhysiologyV7ShadowService();
