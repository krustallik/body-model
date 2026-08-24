import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calculateAge } from "@/model/age";
import { calculateRmr } from "@/model/rmr";
import {
  calculateHybridOccupationalActivity,
  calculateOverlapAwareActivity,
  type OccupationalCategory,
} from "@/model/occupational-activity";
import {
  estimateDailyWorkWalking,
  type CumulativeSnapshot,
} from "@/model/work-interval-reconstruction";

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

export async function estimateWorkActivityForDay(
  input: {
    date: string;
    weightKg: number;
    rmrKcalPerDay: number;
    maxGapMinutes?: number;
  },
  client: PrismaClient = prisma,
) {
  const [day, snapshots, intervals] = await Promise.all([
    client.dailyHealthData.findUnique({
      where: { date: input.date },
      select: {
        walkingDistanceKm: true,
        averageWalkingSpeedKmh: true,
        strengthTrainingMinutes: true,
      },
    }),
    client.healthSyncSnapshot.findMany({
      where: { date: input.date },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: {
        receivedAt: true,
        syncedAt: true,
        steps: true,
        walkingDistanceKm: true,
      },
    }),
    client.workInterval.findMany({
      where: { date: input.date },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      select: { id: true, startAt: true, endAt: true, category: true, breakMinutes: true },
    }),
  ]);

  const cumulativeSnapshots: CumulativeSnapshot[] = snapshots.map((snapshot) => ({
    timestamp: snapshot.syncedAt ?? snapshot.receivedAt,
    steps: snapshot.steps,
    walkingDistanceKm: decimalToNumber(snapshot.walkingDistanceKm),
  }));
  const walking = estimateDailyWorkWalking({
    snapshots: cumulativeSnapshots,
    intervals: intervals.map((interval) => ({
      id: interval.id,
      startTime: interval.startAt,
      endTime: interval.endAt,
    })),
    dailyWalkingDistanceKm: decimalToNumber(day?.walkingDistanceKm ?? null),
    maxGapMinutes: input.maxGapMinutes,
  });
  const occupationalIntervals = intervals.map((interval) => {
    const durationHours = (interval.endAt.getTime() - interval.startAt.getTime()) / 3_600_000;
    const workWalkingDistanceKm = walking.intervals.find(({ intervalId }) => (
      intervalId === interval.id
    ))?.estimatedWalkingDistanceKm.value ?? null;
    const estimate = calculateHybridOccupationalActivity({
      category: interval.category as OccupationalCategory,
      durationHours,
      breakDurationHours: interval.breakMinutes === null ? null : interval.breakMinutes / 60,
      workWalkingDistanceKm,
      walkingSpeedKmh: decimalToNumber(day?.averageWalkingSpeedKmh ?? null),
      weightKg: input.weightKg,
      rmrKcalPerDay: input.rmrKcalPerDay,
    });
    return {
      id: interval.id,
      ...estimate,
      clockDurationMinutes: estimate.durationHours * 60,
      breakMinutes: interval.breakMinutes,
      activeWorkMinutes: estimate.activeWorkDurationHours * 60,
      walkingMinutes: estimate.walkingDurationHours === null
        ? null
        : estimate.walkingDurationHours * 60,
      residualWorkMinutes: estimate.residualDurationHours === null
        ? null
        : estimate.residualDurationHours * 60,
    };
  });
  const occupationalActivityKcal = occupationalIntervals.reduce(
    (sum, interval) => sum + interval.activityKcal,
    0,
  );
  const activity = calculateOverlapAwareActivity({
    occupationalActivityKcal,
    outsideWorkWalkingDistanceKm: walking.outsideWorkWalkingDistanceKm,
    dailyAverageWalkingSpeedKmh: decimalToNumber(day?.averageWalkingSpeedKmh ?? null),
    strengthTrainingMinutes: decimalToNumber(day?.strengthTrainingMinutes ?? null),
    weightKg: input.weightKg,
    rmrKcalPerDay: input.rmrKcalPerDay,
  });
  return {
    date: input.date,
    snapshotTimestampPolicy: "syncedAt-or-receivedAt" as const,
    walking,
    occupationalIntervals,
    activity,
  };
}

export async function getWorkActivityDiagnosticsForDay(
  date: string,
  client: PrismaClient = prisma,
) {
  const [profile, day] = await Promise.all([
    client.profile.findUnique({
      where: { id: 1 },
      select: { sex: true, dateOfBirth: true, heightCm: true },
    }),
    client.dailyHealthData.findUnique({
      where: { date },
      select: { weightKg: true },
    }),
  ]);
  if (!profile || day?.weightKg === null || day?.weightKg === undefined) {
    return {
      date,
      diagnostics: null,
      unavailableReason: "profile-or-weight-missing" as const,
    };
  }
  const ageYears = calculateAge(profile.dateOfBirth.toISOString().slice(0, 10), date);
  const rmrKcalPerDay = calculateRmr({
    sex: profile.sex as "male" | "female",
    weightKg: day.weightKg,
    heightCm: profile.heightCm.toNumber(),
    ageYears,
  });
  return {
    date,
    diagnostics: await estimateWorkActivityForDay({
      date,
      weightKg: day.weightKg,
      rmrKcalPerDay,
    }, client),
    unavailableReason: null,
  };
}

export type WorkActivityDiagnosticsDto = Awaited<ReturnType<typeof estimateWorkActivityForDay>>;
export type WorkActivityResponseDto = Awaited<ReturnType<typeof getWorkActivityDiagnosticsForDay>>;
