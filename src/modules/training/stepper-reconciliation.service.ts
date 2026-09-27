import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { DEFAULT_TIME_ZONE, localDateTimeToInstant } from "@/model/time-zone";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import {
  displayedDailyStepsV1,
  RECONCILIATION_POLICY_V1,
} from "@/model/activity/canonical-activity-policy-v1";
import {
  evaluateStepperReconciliationV1,
  type ReconciliationWorkoutV1,
} from "./stepper-reconciliation-v1";

const STAIR_TYPE = "Stair Climbing";

type QueryClient = PrismaClient | Prisma.TransactionClient;

export type PersistedReconciliationV1 = {
  groupIds: number[];
  displayedSteps: number | null;
  potentialDuplication: boolean;
};

type StairRow = {
  id: number;
  sourceIdentity: string;
  startAt: Date;
  endAt: Date;
  manualStepCount: number | null;
  dailyHealthData: { date: string; steps: number | null };
};

function isClient(value: QueryClient): value is PrismaClient {
  return "$connect" in value;
}

function revisionOf(pairs: readonly { manualId: number; garminId: number; manualCoverage: number; garminCoverage: number; status: string }[]): string {
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex").slice(0, 32);
}

function clusterMatched(pairs: readonly { manual: ReconciliationWorkoutV1; garmin: ReconciliationWorkoutV1 }[]): number[][] {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const next = parent.get(id) ?? id;
    if (next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  const unite = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(b, a);
  };
  for (const pair of pairs) {
    parent.set(pair.manual.id, parent.get(pair.manual.id) ?? pair.manual.id);
    parent.set(pair.garmin.id, parent.get(pair.garmin.id) ?? pair.garmin.id);
    unite(pair.manual.id, pair.garmin.id);
  }
  const groups = new Map<number, Set<number>>();
  for (const id of parent.keys()) {
    const root = find(id);
    const set = groups.get(root) ?? new Set<number>();
    set.add(id);
    groups.set(root, set);
  }
  return [...groups.values()].map((ids) => [...ids]);
}

async function writeWindow(client: QueryClient, input: {
  from: string;
  to: string;
  timezone: string;
  synchronizedSteps?: number | null;
}): Promise<PersistedReconciliationV1> {
  const start = localDateTimeToInstant(input.from, "00:00", input.timezone);
  const end = localDateTimeToInstant(addCalendarDays(input.to, 1), "00:00", input.timezone);
  const rows = await client.workout.findMany({
    where: {
      hiddenFromHistory: false,
      type: { equals: STAIR_TYPE, mode: "insensitive" },
      startAt: { lt: end },
      endAt: { gt: start },
    },
    select: {
      id: true,
      sourceIdentity: true,
      startAt: true,
      endAt: true,
      manualStepCount: true,
      dailyHealthData: { select: { date: true, steps: true } },
    },
  }) as StairRow[];
  const asWorkout = (row: StairRow): ReconciliationWorkoutV1 => ({
    id: row.id,
    origin: row.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) ? "manual" : "garmin",
    startMs: row.startAt.getTime(),
    endMs: row.endAt.getTime(),
    stepCount: row.manualStepCount,
  });
  const manual = rows.filter((row) => row.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX)).map(asWorkout);
  const garmin = rows.filter((row) => !row.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX)).map(asWorkout);
  const evaluated = evaluateStepperReconciliationV1({
    manual,
    garmin,
    synchronizedSteps: input.synchronizedSteps ?? rows.find((row) => row.dailyHealthData.steps !== null)?.dailyHealthData.steps ?? null,
  });
  const matched = evaluated.candidates.filter((candidate) => candidate.matched).map((candidate) => ({
    ...candidate,
    manual: manual.find((item) => item.id === candidate.manualWorkoutId)!,
    garmin: garmin.find((item) => item.id === candidate.garminWorkoutId)!,
  }));
  const components = clusterMatched(matched.map((pair) => ({ manual: pair.manual, garmin: pair.garmin })));
  const groupIds: number[] = [];
  const touchedWorkoutIds = new Set<number>();

  for (const component of components) {
    const pairs = matched.filter((pair) => component.includes(pair.manual.id) && component.includes(pair.garmin.id));
    const uniquePairs = pairs.filter((pair, index) => pairs.findIndex((other) =>
      other.manualWorkoutId === pair.manualWorkoutId && other.garminWorkoutId === pair.garminWorkoutId) === index);
    if (uniquePairs.length === 0) continue;
    for (const pair of uniquePairs) {
      touchedWorkoutIds.add(pair.manualWorkoutId);
      touchedWorkoutIds.add(pair.garminWorkoutId);
    }
    const existing = await client.stepperReconciliationCandidate.findMany({
      where: {
        OR: uniquePairs.map((pair) => ({
          manualWorkoutId: pair.manualWorkoutId,
          garminWorkoutId: pair.garminWorkoutId,
        })),
        group: { status: { not: "rejected" } },
      },
      select: { id: true, groupId: true, candidateStatus: true, group: { select: { status: true, evaluationRevision: true } } },
    });
    const groupIdList = [...new Set(existing.map((row) => row.groupId))];
    const localDate = rows.find((row) => row.id === uniquePairs[0]!.manualWorkoutId)?.dailyHealthData.date ?? input.from;
    const ambiguous = uniquePairs.length > 1;
    const alreadyConfirmed = existing.length > 0
      && existing.every((row) => row.group.status === "confirmed")
      && !ambiguous
      && existing.some((row) => row.candidateStatus === "confirmed");
    const status = alreadyConfirmed ? "confirmed" : ambiguous ? "ambiguous" : "pending";
    const provisionalWorkoutId = status === "ambiguous" ? null : uniquePairs[0]!.manualWorkoutId;
    const sourceRevision = revisionOf(uniquePairs.map((pair) => ({
      manualId: pair.manualWorkoutId,
      garminId: pair.garminWorkoutId,
      manualCoverage: pair.manualCoverage,
      garminCoverage: pair.garminCoverage,
      status,
    })));
    let groupId = groupIdList[0];
    if (groupId === undefined) {
      const created = await client.stepperReconciliationGroup.create({
        data: {
          status,
          evaluationRevision: 1,
          provisionalWorkoutId,
          policyVersion: RECONCILIATION_POLICY_V1,
          localDate,
          sourceRevision,
        },
        select: { id: true },
      });
      groupId = created.id;
    } else {
      for (const extra of groupIdList.slice(1)) {
        await client.stepperReconciliationCandidate.updateMany({
          where: { groupId: extra },
          data: { groupId },
        });
        await client.stepperReconciliationGroup.delete({ where: { id: extra } });
      }
      const current = await client.stepperReconciliationGroup.findUnique({
        where: { id: groupId },
        select: { sourceRevision: true, evaluationRevision: true },
      });
      await client.stepperReconciliationGroup.update({
        where: { id: groupId },
        data: {
          status,
          provisionalWorkoutId,
          localDate,
          sourceRevision,
          evaluationRevision: current?.sourceRevision === sourceRevision
            ? current.evaluationRevision
            : (current?.evaluationRevision ?? 0) + 1,
        },
      });
    }
    for (const pair of uniquePairs) {
      const candidateStatus = status === "confirmed" && pair.manualWorkoutId === provisionalWorkoutId
        ? "confirmed"
        : status === "ambiguous"
          ? "ambiguous"
          : status === "confirmed"
            ? "rejected"
            : "pending";
      await client.stepperReconciliationCandidate.upsert({
        where: {
          manualWorkoutId_garminWorkoutId: {
            manualWorkoutId: pair.manualWorkoutId,
            garminWorkoutId: pair.garminWorkoutId,
          },
        },
        create: {
          groupId,
          manualWorkoutId: pair.manualWorkoutId,
          garminWorkoutId: pair.garminWorkoutId,
          candidateStatus,
          manualCoverage: pair.manualCoverage,
          garminCoverage: pair.garminCoverage,
          stepEvidenceStatus: pair.stepEvidenceStatus,
        },
        update: {
          groupId,
          candidateStatus,
          manualCoverage: pair.manualCoverage,
          garminCoverage: pair.garminCoverage,
          stepEvidenceStatus: pair.stepEvidenceStatus,
        },
      });
    }
    groupIds.push(groupId);
  }

  const stale = await client.stepperReconciliationCandidate.findMany({
    where: {
      group: {
        status: { in: ["pending", "ambiguous"] },
        localDate: { gte: input.from, lte: input.to },
      },
    },
    select: { groupId: true, manualWorkoutId: true, garminWorkoutId: true },
  });
  const staleGroupIds = [...new Set(stale
    .filter((row) => !touchedWorkoutIds.has(row.manualWorkoutId) && !touchedWorkoutIds.has(row.garminWorkoutId))
    .map((row) => row.groupId))];
  if (staleGroupIds.length > 0) {
    await client.stepperReconciliationCandidate.updateMany({
      where: { groupId: { in: staleGroupIds } },
      data: { candidateStatus: "rejected" },
    });
    await client.stepperReconciliationGroup.updateMany({
      where: { id: { in: staleGroupIds } },
      data: { status: "rejected", provisionalWorkoutId: null },
    });
  }

  return {
    groupIds,
    displayedSteps: evaluated.displayedSteps,
    potentialDuplication: evaluated.potentialDuplication,
  };
}

export async function persistStepperReconciliationV1(
  client: QueryClient,
  input: {
    from: string;
    to: string;
    timezone?: string;
    synchronizedSteps?: number | null;
  },
): Promise<PersistedReconciliationV1> {
  const request = {
    from: input.from,
    to: input.to,
    timezone: input.timezone ?? DEFAULT_TIME_ZONE,
    synchronizedSteps: input.synchronizedSteps,
  };
  if (!isClient(client)) return writeWindow(client, request);
  try {
    return await client.$transaction((transaction) => writeWindow(transaction, request));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return client.$transaction((transaction) => writeWindow(transaction, request));
    }
    throw error;
  }
}

export async function confirmStepperReconciliationV1(
  client: PrismaClient,
  input: { manualWorkoutId: number; garminWorkoutId: number },
): Promise<void> {
  await client.$transaction(async (transaction) => {
    const candidate = await transaction.stepperReconciliationCandidate.findUnique({
      where: {
        manualWorkoutId_garminWorkoutId: {
          manualWorkoutId: input.manualWorkoutId,
          garminWorkoutId: input.garminWorkoutId,
        },
      },
    });
    if (candidate === null || candidate.manualCoverage < 0.7 || candidate.garminCoverage < 0.7) {
      throw new Error("reconciliation confirmation requires a current bidirectional match");
    }
    const conflict = await transaction.stepperReconciliationCandidate.findFirst({
      where: {
        candidateStatus: "confirmed",
        NOT: { id: candidate.id },
        OR: [
          { manualWorkoutId: input.manualWorkoutId },
          { garminWorkoutId: input.garminWorkoutId },
        ],
      },
      select: { id: true },
    });
    if (conflict) throw new Error("workout is already confirmed in another reconciliation");
    await transaction.stepperReconciliationCandidate.updateMany({
      where: { groupId: candidate.groupId, NOT: { id: candidate.id } },
      data: { candidateStatus: "rejected" },
    });
    await transaction.stepperReconciliationCandidate.update({
      where: { id: candidate.id },
      data: { candidateStatus: "confirmed" },
    });
    await transaction.stepperReconciliationGroup.update({
      where: { id: candidate.groupId },
      data: {
        status: "confirmed",
        provisionalWorkoutId: input.manualWorkoutId,
        evaluationRevision: { increment: 1 },
      },
    });
  });
}

export async function rejectStepperReconciliationV1(
  client: PrismaClient,
  input: { groupId: number },
): Promise<void> {
  await client.$transaction(async (transaction) => {
    await transaction.stepperReconciliationCandidate.updateMany({
      where: { groupId: input.groupId },
      data: { candidateStatus: "rejected" },
    });
    await transaction.stepperReconciliationGroup.update({
      where: { id: input.groupId },
      data: { status: "rejected", provisionalWorkoutId: null, evaluationRevision: { increment: 1 } },
    });
  });
}

export function reconciliationStepsFromManual(input: {
  synchronizedSteps: number | null;
  manualSteps: number;
  status: "pending" | "ambiguous" | "confirmed" | "rejected" | "unrelated";
}): { displayedSteps: number | null; potentialDuplication: boolean } {
  const steps = displayedDailyStepsV1({
    synchronizedSteps: input.synchronizedSteps,
    manualSteps: input.manualSteps,
    superseded: input.status === "confirmed",
    unresolvedOverlap: input.status === "pending" || input.status === "ambiguous",
  });
  return { displayedSteps: steps.displayedSteps, potentialDuplication: steps.potentialDuplication };
}
