import { Prisma, type PrismaClient } from "@prisma/client";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { ACTIVE_ENERGY_SELECTION_POLICY_V1 } from "./canonical-activity-policy-v1";

export type ActiveEnergyCandidateV1 = {
  source: "bodycast-strength-estimate" | "bodycast-strength-met-fallback" | "bodycast-stepper-mechanical" | "manual-kcal" | "device-kcal";
  sourceIdentity: string;
  sourceFingerprint: string;
  valueKcal: number | null;
  provenance: Record<string, unknown>;
};

export type ActiveEnergyAliasV1 = {
  sourceType: "workout" | "strength-session";
  sourceId: string;
  workoutId?: number;
};

export type ActiveEnergyEventInputV1 = {
  profileId: number;
  logicalEventKey: string;
  eventKind: "strength" | "stepper" | "other";
  occurrenceAt: Date;
  modelDate: string;
  modelTimeZone: string;
  inputFingerprint: string;
  aliases: readonly ActiveEnergyAliasV1[];
  candidates: readonly ActiveEnergyCandidateV1[];
  /** Transactional source-token check prevents an older async calculation publishing over newer inputs. */
  validateSource?: (tx: Prisma.TransactionClient) => Promise<boolean>;
};

function validKcal(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function priority(kind: ActiveEnergyEventInputV1["eventKind"], source: ActiveEnergyCandidateV1["source"]): number {
  if (kind === "strength") {
    return source === "bodycast-strength-estimate" ? 0
      : source === "bodycast-strength-met-fallback" ? 1
        : source === "manual-kcal" ? 2
          : source === "device-kcal" ? 3 : 4;
  }
  if (kind === "stepper") {
    return source === "bodycast-stepper-mechanical" ? 0
      : source === "manual-kcal" ? 1
        : source === "device-kcal" ? 2 : 4;
  }
  return source === "manual-kcal" ? 0 : source === "device-kcal" ? 1 : 4;
}

function selectCandidate(input: ActiveEnergyEventInputV1): ActiveEnergyCandidateV1 | null {
  return [...input.candidates]
    .filter((candidate) => validKcal(candidate.valueKcal) !== null)
    .sort((left, right) => priority(input.eventKind, left.source) - priority(input.eventKind, right.source)
      || left.sourceIdentity.localeCompare(right.sourceIdentity))[0] ?? null;
}

/** Persist raw candidates and append a CAS-protected canonical resolution revision. */
export async function persistActiveEnergyCanonicalResolutionV1(
  client: PrismaClient | Prisma.TransactionClient,
  input: ActiveEnergyEventInputV1,
): Promise<{ eventId: number; revision: number; current: boolean }> {
  const persist = async (tx: Prisma.TransactionClient) => {
    // Source writers take the same profile lock in their transaction before
    // invalidating the lifecycle. This closes the read/validate-to-publish race:
    // either this candidate commits first and the later mutation marks it stale,
    // or the mutation commits first and this validator sees the newer sources.
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(input.profileId);
    if (input.validateSource && !(await input.validateSource(tx))) {
      return { eventId: -1, revision: -1, current: false };
    }
    const aliases = [...input.aliases].sort((left, right) => left.sourceType.localeCompare(right.sourceType)
      || left.sourceId.localeCompare(right.sourceId));
    const aliasEvents = aliases.length === 0 ? [] : await tx.activeEnergyEventAlias.findMany({
      where: { profileId: input.profileId, OR: aliases.map((alias) => ({ sourceType: alias.sourceType, sourceId: alias.sourceId })) },
      select: { eventId: true },
    });
    const eventIds = [...new Set(aliasEvents.map((row) => row.eventId))];
    const [logicalEvent, aliasedEvents] = await Promise.all([
      tx.activeEnergyCanonicalEvent.findUnique({ where: { profileId_logicalEventKey: { profileId: input.profileId, logicalEventKey: input.logicalEventKey } } }),
      eventIds.length === 0 ? Promise.resolve([]) : tx.activeEnergyCanonicalEvent.findMany({ where: { id: { in: eventIds } } }),
    ]);
    // Prefer the canonical logical key when it already exists, otherwise keep
    // the oldest aliased row as the stable identity during matched-source merge.
    let event = logicalEvent ?? [...aliasedEvents].sort((left, right) => left.id - right.id)[0] ?? null;
    if (event === null) {
      event = await tx.activeEnergyCanonicalEvent.create({
        data: {
          profileId: input.profileId, logicalEventKey: input.logicalEventKey, eventKind: input.eventKind,
          occurrenceAt: input.occurrenceAt, modelDate: input.modelDate, modelTimeZone: input.modelTimeZone,
          inputFingerprint: input.inputFingerprint,
        },
      });
    } else {
      event = await tx.activeEnergyCanonicalEvent.update({
        where: { id: event.id },
        data: {
          logicalEventKey: input.logicalEventKey, eventKind: input.eventKind, occurrenceAt: input.occurrenceAt,
          modelDate: input.modelDate, modelTimeZone: input.modelTimeZone, inputFingerprint: input.inputFingerprint,
        },
      });
    }

    // Merge aliases from formerly separate diary/workout identities onto one
    // event, retaining the old event and its immutable resolution history.
    for (const otherId of [...new Set([...eventIds, ...(logicalEvent ? [logicalEvent.id] : [])])].filter((id) => id !== event.id)) {
      await tx.activeEnergyEventAlias.updateMany({ where: { eventId: otherId }, data: { eventId: event.id } });
      await tx.activeEnergyCanonicalEvent.update({
        where: { id: otherId },
        data: { isStale: true, supersededByEventId: event.id },
      });
    }
    for (const alias of aliases) {
      await tx.activeEnergyEventAlias.upsert({
        where: { profileId_sourceType_sourceId: { profileId: input.profileId, sourceType: alias.sourceType, sourceId: alias.sourceId } },
        create: { profileId: input.profileId, sourceType: alias.sourceType, sourceId: alias.sourceId, eventId: event.id, workoutId: alias.workoutId },
        update: { eventId: event.id, workoutId: alias.workoutId ?? null },
      });
    }
    if (input.eventKind === "strength" || input.eventKind === "stepper") {
      const currentWorkoutAliases = aliases
        .filter((alias) => alias.sourceType === "workout")
        .map((alias) => alias.sourceId);
      await tx.activeEnergyEventAlias.deleteMany({
        where: {
          profileId: input.profileId,
          eventId: event.id,
          sourceType: "workout",
          ...(currentWorkoutAliases.length === 0 ? {} : { sourceId: { notIn: currentWorkoutAliases } }),
        },
      });
    }
    for (const candidate of input.candidates) {
      const valueKcal = validKcal(candidate.valueKcal);
      await tx.activeEnergyCandidate.upsert({
        where: { eventId_source_sourceIdentity_sourceFingerprint: { eventId: event.id, source: candidate.source, sourceIdentity: candidate.sourceIdentity, sourceFingerprint: candidate.sourceFingerprint } },
        create: { eventId: event.id, source: candidate.source, sourceIdentity: candidate.sourceIdentity, sourceFingerprint: candidate.sourceFingerprint, availability: valueKcal === null ? "unavailable" : "available", valueKcal, provenance: candidate.provenance as Prisma.InputJsonValue },
        update: { availability: valueKcal === null ? "unavailable" : "available", valueKcal, provenance: candidate.provenance as Prisma.InputJsonValue },
      });
    }
    const selected = selectCandidate(input);
    const source = selected?.source ?? "unavailable";
    const valueKcal = selected === null ? null : validKcal(selected.valueKcal);
    const provenance = {
      policyVersion: ACTIVE_ENERGY_SELECTION_POLICY_V1,
      source,
      sourceIdentity: selected?.sourceIdentity ?? null,
      sourceFingerprint: selected?.sourceFingerprint ?? null,
      evidence: selected?.provenance ?? null,
    };
    const resolutionFingerprint = stableSha256(JSON.stringify({
      logicalEventKey: input.logicalEventKey, inputFingerprint: input.inputFingerprint,
      source, valueKcal, provenance,
    }));
    if (event.currentResolutionFingerprint === resolutionFingerprint) {
      if (event.isStale) {
        await tx.activeEnergyCanonicalEvent.updateMany({
          where: { id: event.id, resolutionRevision: event.resolutionRevision, inputFingerprint: input.inputFingerprint },
          data: { isStale: false },
        });
      }
      return { eventId: event.id, revision: event.resolutionRevision, current: true };
    }
    const nextRevision = event.resolutionRevision + 1;
    const update = await tx.activeEnergyCanonicalEvent.updateMany({
      where: { id: event.id, resolutionRevision: event.resolutionRevision, inputFingerprint: input.inputFingerprint },
      data: {
        resolutionRevision: nextRevision, currentResolutionFingerprint: resolutionFingerprint,
        currentSource: source, currentKcal: valueKcal, currentProvenance: provenance as Prisma.InputJsonValue,
        isStale: false,
      },
    });
    if (update.count !== 1) throw new Error("active-energy canonical resolution CAS failed");
    await tx.activeEnergyResolutionRevision.create({
      data: {
        eventId: event.id, revision: nextRevision, resolutionFingerprint, source, valueKcal,
        provenance: provenance as Prisma.InputJsonValue,
      },
    });
    return { eventId: event.id, revision: nextRevision, current: true };
  };
  if ("$transaction" in client && typeof client.$transaction === "function") {
    return client.$transaction((tx) => persist(tx));
  }
  return persist(client);
}

export async function readActiveEnergyResolutionByWorkoutV1(
  client: PrismaClient | Prisma.TransactionClient,
  input: { profileId: number; workoutId: number },
) {
  return client.activeEnergyCanonicalEvent.findFirst({
    where: { profileId: input.profileId, aliases: { some: { sourceType: "workout", sourceId: String(input.workoutId) } } },
    select: { currentKcal: true, currentSource: true, currentProvenance: true, currentResolutionFingerprint: true, resolutionRevision: true, modelDate: true, modelTimeZone: true },
  });
}
