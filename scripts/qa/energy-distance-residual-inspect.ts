import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const mode = process.argv[2] ?? "baseline";
  if (mode === "baseline" || mode === "after-confirm" || mode === "after-reject" || mode === "after-activation") {
    const groups = await prisma.stepperReconciliationGroup.findMany({
      where: {
        OR: [
          { localDate: { in: ["2026-09-24", "2026-09-25"] } },
          { provisionalWorkoutId: { in: [337, 338, 339] } },
          { candidates: { some: { OR: [{ manualWorkoutId: { in: [337, 338, 339] } }, { garminWorkoutId: { in: [337, 338, 339] } }] } } },
        ],
      },
      include: { candidates: true },
      orderBy: [{ localDate: "asc" }, { id: "asc" }],
    });
    const workouts = await prisma.workout.findMany({
      where: {
        OR: [
          { id: { in: [337, 338, 339] } },
          { sourceIdentity: { startsWith: "manual:stepper:residual-" } },
          { sourceIdentity: { startsWith: "ext:residual-" } },
        ],
      },
      select: {
        id: true,
        sourceIdentity: true,
        hiddenFromHistory: true,
        syncProtected: true,
        supersededByWorkoutId: true,
        activeEnergyKcal: true,
        manualActiveEnergyKcal: true,
        manualStepCount: true,
      },
      orderBy: { id: "asc" },
    });
    console.log(JSON.stringify({ mode, groups: groups.map((g) => ({
      id: g.id,
      status: g.status,
      date: g.localDate,
      provisionalWorkoutId: g.provisionalWorkoutId,
      candidates: g.candidates.map((c) => ({
        manualWorkoutId: c.manualWorkoutId,
        garminWorkoutId: c.garminWorkoutId,
        candidateStatus: c.candidateStatus,
      })),
    })), workouts }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
