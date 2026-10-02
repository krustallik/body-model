import { Prisma } from "@prisma/client";
import { instantToLocalDateTime } from "@/model/time-zone";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";

type DbTransaction = Prisma.TransactionClient;
type SourceAlias = { sourceType: string; sourceId: string };

async function modelDateForInstant(
  tx: DbTransaction,
  profileId: number,
  instant: Date,
): Promise<string> {
  const episodes = await tx.modelEpisode.findMany({
    where: { profileId },
    select: { startDate: true, timezone: true, active: true, deactivatedAt: true },
    orderBy: { startDate: "asc" },
  });
  // A missing episode uses the model's stable default timezone. Request and
  // session-accounting timezones never define a replay date boundary.
  return episodeTimeContextForInstantV1(episodes, instant).date;
}
/** Must be called in the source writer's transaction, before that transaction commits. */
export async function invalidateActiveEnergySourcesInTransactionV1(input: {
  tx: DbTransaction;
  profileId: number;
  aliases?: readonly SourceAlias[];
  affectedInstants: readonly (Date | null | undefined)[];
  affectedModelDates?: readonly string[];
}): Promise<string | null> {
  const instants = input.affectedInstants.filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()));
  if (instants.length === 0 && (input.affectedModelDates?.length ?? 0) === 0) return null;
  // Serialize the source mutation's invalidation with candidate publication.
  // The lock is transaction-scoped, so it releases only after source and stale
  // watermark changes commit or roll back together.
  await new PhysiologyV7PersistenceRepository(input.tx).lockProfile(input.profileId);
  const dates = await Promise.all(instants.map((instant) => modelDateForInstant(
    input.tx, input.profileId, instant,
  )));
  const staleFromDate = [...dates, ...(input.affectedModelDates ?? [])].sort()[0]!;
  const affectedDates = [...new Set([...dates, ...(input.affectedModelDates ?? [])])];
  if (affectedDates.length > 0) {
    await input.tx.activeEnergyCanonicalEvent.updateMany({
      where: { profileId: input.profileId, modelDate: { in: affectedDates } },
      data: { isStale: true },
    });
  }
  if (input.aliases && input.aliases.length > 0) {
    const rows = await input.tx.activeEnergyEventAlias.findMany({
      where: {
        profileId: input.profileId,
        OR: input.aliases.map((alias) => ({ sourceType: alias.sourceType, sourceId: alias.sourceId })),
      },
      select: { eventId: true },
    });
    const eventIds = [...new Set(rows.map((row) => row.eventId))];
    if (eventIds.length > 0) {
      await input.tx.activeEnergyCanonicalEvent.updateMany({ where: { id: { in: eventIds } }, data: { isStale: true } });
    }
  }
  await new PhysiologyV7PersistenceRepository(input.tx).invalidate(input.profileId, staleFromDate);
  return staleFromDate;
}

export async function invalidateWorkoutEnergyInTransactionV1(input: {
  tx: DbTransaction;
  profileId: number;
  workoutIds: readonly number[];
  affectedInstants: readonly (Date | null | undefined)[];
  affectedModelDates?: readonly string[];
}): Promise<string | null> {
  return invalidateActiveEnergySourcesInTransactionV1({
    tx: input.tx,
    profileId: input.profileId,
    aliases: input.workoutIds.map((id) => ({ sourceType: "workout", sourceId: String(id) })),
    affectedInstants: input.affectedInstants,
    affectedModelDates: input.affectedModelDates,
  });
}

/**
 * Observed mass is a ±7-calendar-day Stepper estimator input. Re-find dependent
 * workouts in each event's model-episode timezone and stale only their exact
 * canonical model dates in the source writer's transaction.
 */
export async function invalidateStepperMassDependenciesInTransactionV1(input: {
  tx: DbTransaction;
  profileId: number;
  measurementDates: readonly string[];
  measurementInstants?: readonly Date[];
}): Promise<string | null> {
  const measurementDates = input.measurementDates;
  const measurementInstants = input.measurementInstants ?? [];
  if (measurementDates.length === 0 && measurementInstants.length === 0) return null;
  const [episodes, workouts] = await Promise.all([
    input.tx.modelEpisode.findMany({
      where: { profileId: input.profileId },
      select: { startDate: true, timezone: true, active: true, deactivatedAt: true },
      orderBy: { startDate: "asc" },
    }),
    input.tx.workout.findMany({
      where: { hiddenFromHistory: false, type: { equals: "Stair Climbing", mode: "insensitive" } },
      select: { id: true, startAt: true, endAt: true },
    }),
  ]);
  const dependent: Array<{ id: number; startAt: Date; endAt: Date; modelDate: string }> = [];
  for (const workout of workouts) {
    const context = episodeTimeContextForInstantV1(episodes, workout.startAt);
    const workoutDay = calendarDayIndex(context.date);
    const dateMatch = measurementDates.some((date) => Math.abs(calendarDayIndex(date) - workoutDay) <= 7);
    const instantMatch = measurementInstants.some((instant) => {
      const measurementDate = instantToLocalDateTime(instant, context.timeZone).date;
      return Math.abs(calendarDayIndex(measurementDate) - workoutDay) <= 7;
    });
    if (dateMatch || instantMatch) dependent.push({ ...workout, modelDate: context.date });
  }
  if (dependent.length === 0) return null;
  return invalidateActiveEnergySourcesInTransactionV1({
    tx: input.tx,
    profileId: input.profileId,
    aliases: dependent.map((workout) => ({ sourceType: "workout", sourceId: String(workout.id) })),
    affectedInstants: dependent.flatMap((workout) => [workout.startAt, workout.endAt]),
    affectedModelDates: dependent.map((workout) => workout.modelDate),
  });
}

