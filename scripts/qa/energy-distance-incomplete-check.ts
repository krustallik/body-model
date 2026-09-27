import { PrismaClient } from "@prisma/client";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays, eligibleHistoricalDonors } from "@/modules/model-episodes/simulation-input-builder";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import type { BodyCompositionState } from "@/model/body-composition/state";
import { CURRENT_MODEL_VERSION } from "@/modules/model-episodes/model-version";

const prisma = new PrismaClient();
const SELECTION = `${CURRENT_MODEL_VERSION}+selection-v1`;
const body: BodyCompositionState = {
  fatMassKg: 20,
  leanTissueKg: 60,
  glycogenKg: 0.4,
  extracellularFluidDeviationLiters: 0,
  baselineExtracellularFluidLiters: 15,
};
const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: 1700,
  initialFatMassKg: 20,
  initialLeanTissueKg: 60,
});

function spend(events: NonNullable<ReturnType<typeof buildSimulationDays>[number]["input"]["workoutActivity"]>["events"] | undefined) {
  return calculateDynamicDailyExpenditure({
    bodyComposition: body,
    rmrParameters,
    macros: { proteinG: 150, carbsG: 200, fatG: 70 },
    outsideWorkWalking: { distanceKm: 0, averageSpeedKmh: 5 },
    strength: { durationMinutes: 0 },
    occupational: { category: null, durationHours: 0 },
    adaptiveThermogenesisKcalPerDay: 0,
    workoutActivity: events === undefined ? undefined : {
      events,
      selectionPolicy: "bodycast-active-energy-selection-v1",
    },
  });
}

async function main() {
  const repository = new ModelEpisodeRepository(prisma);
  const sources = await repository.loadSources("2026-09-23", "2026-09-23");
  const built = buildSimulationDays({
    from: "2026-09-23",
    to: "2026-09-23",
    sources,
    modelVersion: SELECTION,
    unifiedStartOfDayMassKgByDate: { "2026-09-23": 81 },
  });
  const day = built[0]!;
  const resolution = spend(day.input.workoutActivity?.events);
  const donors = eligibleHistoricalDonors(SELECTION, built);
  console.log(JSON.stringify({
    eventCount: day.input.workoutActivity?.events?.length ?? 0,
    events: day.input.workoutActivity?.events?.map((event) => ({
      classification: event.classification,
      activeEnergyKcal: event.activeEnergyKcal ?? null,
    })),
    energyCoverage: resolution.workoutEnergyResolution?.energyCoverage ?? null,
    selectedKcal: resolution.workoutActivityKcalPerDay,
    donorCount: donors.length,
    sourceQualityCoverage: day.sourceQuality.selectionV1?.energyCoverage ?? null,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
