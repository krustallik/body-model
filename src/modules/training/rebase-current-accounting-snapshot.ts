import { Prisma } from "@prisma/client";
import { BODYWEIGHT_RESOLUTION_METHOD_V2 } from "./bodyweight-reference-v2";
import { LOAD_ACCOUNTING_METHOD_V1 } from "./load-accounting-v1";
import {
  buildMassResolutionIdentity,
  PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1,
  persistedPayloadFromUnknown,
} from "./persisted-load-accounting-v1";

/**
 * Keep the append-only current snapshot aligned with a same-local-date change
 * to the canonical accounting instant. The accounting inputs and result do
 * not change, so the input revision/fingerprint remain stable; a new snapshot
 * revision records the canonical instant without mutating historical payload.
 * Callers must already hold the session row lock and update the session's
 * canonical timestamp in the same transaction.
 */
export async function rebaseCurrentAccountingSnapshotTimestamp(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: number;
    effectiveAccountingAt: Date;
    effectiveLocalDate: string;
    timeZone: string;
    timeZoneProvenance: string;
  },
): Promise<void> {
  const session = await tx.strengthDiarySession.findUnique({
    where: { id: input.sessionId },
    select: {
      accountingInputRevision: true,
      currentSnapshotRevision: true,
      accountingTimeZone: true,
      accountingTimeZoneProvenance: true,
    },
  });
  if (!session || session.currentSnapshotRevision === null) return;

  const current = await tx.strengthSessionAccountingSnapshot.findUnique({
    where: {
      sessionId_snapshotRevision: {
        sessionId: input.sessionId,
        snapshotRevision: session.currentSnapshotRevision,
      },
    },
  });
  const payload = current?.payloadVersion === PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1
    ? persistedPayloadFromUnknown(current.payload)
    : null;
  const currentMassIdentity = payload ? buildMassResolutionIdentity({
    localDate: input.effectiveLocalDate,
    timeZone: input.timeZone,
    methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
    reference: payload.massReference,
  }) : null;
  const isCurrent = current !== null
    && payload !== null
    && current.snapshotRevision === session.currentSnapshotRevision
    && current.accountingInputRevision === session.accountingInputRevision
    && payload.sessionId === input.sessionId
    && payload.snapshotRevision === current.snapshotRevision
    && payload.accountingInputRevision === session.accountingInputRevision
    && current.inputFingerprint === payload.inputFingerprint
    && current.effectiveLocalDate === input.effectiveLocalDate
    && payload.effectiveLocalDate === input.effectiveLocalDate
    && current.timeZone === input.timeZone
    && payload.timeZone === input.timeZone
    && current.timeZoneProvenance === input.timeZoneProvenance
    && payload.timeZoneProvenance === input.timeZoneProvenance
    && (session.accountingTimeZone ?? input.timeZone) === input.timeZone
    && (session.accountingTimeZoneProvenance ?? input.timeZoneProvenance) === input.timeZoneProvenance
    && current.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
    && payload.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
    && current.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
    && payload.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
    && current.massResolutionIdentity === payload.massResolutionIdentity
    && current.massResolutionIdentity === currentMassIdentity;

  if (!isCurrent || !current || !payload) {
    // Do not leave a pointer that claims stale or malformed payload is current.
    await tx.strengthDiarySession.update({
      where: { id: input.sessionId },
      data: { currentSnapshotRevision: null },
    });
    return;
  }

  const maximum = await tx.strengthSessionAccountingSnapshot.aggregate({
    where: { sessionId: input.sessionId },
    _max: { snapshotRevision: true },
  });
  const snapshotRevision = (maximum._max.snapshotRevision ?? 0) + 1;
  const nextPayload = persistedPayloadFromUnknown({
    ...payload,
    snapshotRevision,
    effectiveAccountingAt: input.effectiveAccountingAt.toISOString(),
  });
  if (!nextPayload) throw new Error("rebased Stage 02 payload failed strict validation");

  await tx.strengthSessionAccountingSnapshot.create({
    data: {
      sessionId: input.sessionId,
      snapshotRevision,
      accountingInputRevision: current.accountingInputRevision,
      inputFingerprint: current.inputFingerprint,
      effectiveLocalDate: current.effectiveLocalDate,
      timeZone: current.timeZone,
      timeZoneProvenance: current.timeZoneProvenance,
      accountingMethodVersion: current.accountingMethodVersion,
      massResolutionMethodVersion: current.massResolutionMethodVersion,
      massResolutionIdentity: current.massResolutionIdentity,
      payloadVersion: current.payloadVersion,
      payload: JSON.parse(JSON.stringify(nextPayload)) as Prisma.InputJsonValue,
    },
  });
  await tx.strengthDiarySession.update({
    where: { id: input.sessionId },
    data: { currentSnapshotRevision: snapshotRevision },
  });
}
