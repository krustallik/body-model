import { describe, expect, it, vi } from "vitest";
import {
  persistActiveEnergyCanonicalResolutionV1,
  type ActiveEnergyCandidateV1,
  type ActiveEnergyEventInputV1,
} from "@/model/activity/active-energy-canonical.repository";

type EventRow = {
  id: number;
  profileId: number;
  logicalEventKey: string;
  eventKind?: string;
  occurrenceAt?: Date;
  modelDate?: string;
  modelTimeZone?: string;
  inputFingerprint?: string;
  resolutionRevision?: number;
  currentResolutionFingerprint?: string | null;
  currentSource?: string | null;
  currentKcal?: number | null;
  currentProvenance?: unknown;
  isStale?: boolean;
  supersededByEventId?: number | null;
  [key: string]: unknown;
};
type AliasRow = { profileId: number; sourceType: string; sourceId: string; eventId: number; workoutId?: number | null };
type CandidateRow = Record<string, unknown>;

type AliasLookup = { where: { profileId: number; OR: Array<{ sourceType: string; sourceId: string }> } };
type AliasUpsert = { where: { profileId_sourceType_sourceId: AliasRow }; create: AliasRow; update: Partial<AliasRow> };
type AliasUpdate = { where: { eventId: number }; data: { eventId: number } };
type AliasDelete = { where: { profileId: number; eventId: number; sourceType: string; sourceId?: { notIn: string[] } } };
type EventLookup = { where: { profileId_logicalEventKey: { profileId: number; logicalEventKey: string } } };
type EventIdsLookup = { where: { id: { in: number[] } } };
type EventCreate = { data: {
  profileId: number;
  logicalEventKey: string;
  eventKind: string;
  occurrenceAt: Date;
  modelDate: string;
  modelTimeZone: string;
  inputFingerprint: string;
} };
type EventUpdate = { where: { id: number }; data: Partial<EventRow> };
type EventCas = { where: { id: number; resolutionRevision: number; inputFingerprint: string }; data: Partial<EventRow> };
type CandidateUpsert = {
  where: { eventId_source_sourceIdentity_sourceFingerprint: { eventId: number; source: string; sourceIdentity: string; sourceFingerprint: string } };
  create: CandidateRow;
  update: CandidateRow;
};
type RevisionCreate = { data: Record<string, unknown> };

function database() {
  const state: {
    events: EventRow[];
    aliases: AliasRow[];
    candidates: CandidateRow[];
    revisions: Array<Record<string, unknown>>;
    nextEventId: number;
    forceCasMiss: boolean;
  } = { events: [], aliases: [], candidates: [], revisions: [], nextEventId: 1, forceCasMiss: false };

  const tx = {
    $executeRaw: vi.fn(async () => 0),
    activeEnergyEventAlias: {
      findMany: vi.fn(async (query: AliasLookup) => {
        const requested = query.where.OR;
        return state.aliases
          .filter((row) => row.profileId === query.where.profileId
            && requested.some((item) => item.sourceType === row.sourceType && item.sourceId === row.sourceId))
          .map((row) => ({ eventId: row.eventId }));
      }),
      upsert: vi.fn(async (query: AliasUpsert) => {
        const key = query.where.profileId_sourceType_sourceId;
        const found = state.aliases.find((row) => row.profileId === key.profileId
          && row.sourceType === key.sourceType && row.sourceId === key.sourceId);
        if (found) Object.assign(found, query.update);
        else state.aliases.push({ ...query.create });
        return found ?? query.create;
      }),
      updateMany: vi.fn(async (query: AliasUpdate) => {
        let count = 0;
        for (const row of state.aliases) {
          if (row.eventId === query.where.eventId) {
            row.eventId = query.data.eventId;
            count += 1;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async (query: AliasDelete) => {
        const where = query.where;
        const keep = where.sourceId?.notIn;
        const before = state.aliases.length;
        state.aliases = state.aliases.filter((row) => !(row.profileId === where.profileId
          && row.eventId === where.eventId
          && row.sourceType === where.sourceType
          && (keep === undefined || !keep.includes(row.sourceId))));
        return { count: before - state.aliases.length };
      }),
    },
    activeEnergyCanonicalEvent: {
      findUnique: vi.fn(async (query: EventLookup) => state.events.find((row) => row.profileId === query.where.profileId_logicalEventKey.profileId
        && row.logicalEventKey === query.where.profileId_logicalEventKey.logicalEventKey) ?? null),
      findMany: vi.fn(async (query: EventIdsLookup) => state.events.filter((row) => query.where.id.in.includes(row.id))),
      create: vi.fn(async (query: EventCreate) => {
        const row: EventRow = {
          id: state.nextEventId++,
          resolutionRevision: 0,
          currentResolutionFingerprint: null,
          currentSource: null,
          currentKcal: null,
          currentProvenance: null,
          isStale: false,
          supersededByEventId: null,
          ...query.data,
        };
        state.events.push(row);
        return row;
      }),
      update: vi.fn(async (query: EventUpdate) => {
        const row = state.events.find((item) => item.id === query.where.id);
        if (!row) throw new Error("event missing in test database");
        Object.assign(row, query.data);
        return row;
      }),
      updateMany: vi.fn(async (query: EventCas) => {
        if (state.forceCasMiss) return { count: 0 };
        const row = state.events.find((item) => item.id === query.where.id
          && item.resolutionRevision === query.where.resolutionRevision
          && item.inputFingerprint === query.where.inputFingerprint);
        if (!row) return { count: 0 };
        Object.assign(row, query.data);
        return { count: 1 };
      }),
    },
    activeEnergyCandidate: {
      upsert: vi.fn(async (query: CandidateUpsert) => {
        const key = query.where.eventId_source_sourceIdentity_sourceFingerprint;
        const found = state.candidates.find((row) => row.eventId === key.eventId && row.source === key.source
          && row.sourceIdentity === key.sourceIdentity && row.sourceFingerprint === key.sourceFingerprint);
        if (found) Object.assign(found, query.update);
        else state.candidates.push({ ...query.create });
        return found ?? query.create;
      }),
    },
    activeEnergyResolutionRevision: {
      create: vi.fn(async (query: RevisionCreate) => {
        state.revisions.push(query.data);
        return query.data;
      }),
    },
  };
  const client = {
    $transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { client, state, tx };
}

function candidate(
  source: ActiveEnergyCandidateV1["source"],
  sourceIdentity: string,
  valueKcal: number | null,
): ActiveEnergyCandidateV1 {
  return { source, sourceIdentity, sourceFingerprint: `${sourceIdentity}:fingerprint`, valueKcal, provenance: { sourceIdentity } };
}

function eventInput(overrides: Partial<ActiveEnergyEventInputV1> = {}): ActiveEnergyEventInputV1 {
  return {
    profileId: 7,
    logicalEventKey: "strength-session:21",
    eventKind: "strength",
    occurrenceAt: new Date("2026-10-01T15:00:00.000Z"),
    modelDate: "2026-10-01",
    modelTimeZone: "Europe/Bratislava",
    inputFingerprint: "source-input-v1",
    aliases: [
      { sourceType: "strength-session", sourceId: "21" },
      { sourceType: "workout", sourceId: "42", workoutId: 42 },
    ],
    candidates: [
      candidate("bodycast-strength-estimate", "session:21", 320),
      candidate("bodycast-strength-met-fallback", "workout:42:met", 210),
      candidate("manual-kcal", "workout:42:manual", 180),
      candidate("device-kcal", "workout:42:device", 260),
    ],
    ...overrides,
  };
}

describe("canonical active-energy persistence", () => {
  it("persists raw candidates and selects the BodyCast Strength estimate once", async () => {
    const db = database();
    const input = eventInput();

    const first = await persistActiveEnergyCanonicalResolutionV1(db.client as never, input);

    expect(first).toEqual({ eventId: 1, revision: 1, current: true });
    expect(db.state.events[0]).toMatchObject({
      logicalEventKey: input.logicalEventKey,
      currentSource: "bodycast-strength-estimate",
      currentKcal: 320,
      resolutionRevision: 1,
      isStale: false,
    });
    expect(db.state.candidates).toHaveLength(4);
    expect(db.state.revisions).toHaveLength(1);
    expect(db.state.revisions[0]).toMatchObject({ revision: 1, source: "bodycast-strength-estimate", valueKcal: 320 });
    expect(db.state.aliases.map(({ sourceType, sourceId, eventId }) => [sourceType, sourceId, eventId])).toEqual([
      ["strength-session", "21", 1], ["workout", "42", 1],
    ]);

    const replay = await persistActiveEnergyCanonicalResolutionV1(db.client as never, input);
    expect(replay).toEqual({ eventId: 1, revision: 1, current: true });
    expect(db.state.revisions).toHaveLength(1);
  });

  it("uses Stepper source precedence without summing candidates", async () => {
    const db = database();
    const input = eventInput({
      logicalEventKey: "stepper-reconciliation:9",
      eventKind: "stepper",
      aliases: [{ sourceType: "workout", sourceId: "91", workoutId: 91 }],
      candidates: [
        candidate("device-kcal", "device:91", 350),
        candidate("manual-kcal", "manual:91", 180),
        candidate("bodycast-stepper-mechanical", "stepper:91", 74),
      ],
    });

    await persistActiveEnergyCanonicalResolutionV1(db.client as never, input);

    expect(db.state.events[0]).toMatchObject({ currentSource: "bodycast-stepper-mechanical", currentKcal: 74 });
    expect(db.state.candidates.map((row) => row.valueKcal)).toEqual([350, 180, 74]);
    expect(db.state.events[0]?.currentKcal).not.toBe(604);
  });

  it("records unavailable evidence but excludes invalid kcal from selection", async () => {
    const db = database();
    const input = eventInput({
      candidates: [candidate("bodycast-strength-estimate", "session:21", -3), candidate("device-kcal", "device:42", Number.NaN)],
    });

    await persistActiveEnergyCanonicalResolutionV1(db.client as never, input);

    expect(db.state.candidates.map((row) => row.availability)).toEqual(["unavailable", "unavailable"]);
    expect(db.state.events[0]).toMatchObject({ currentSource: "unavailable", currentKcal: null });
    expect(db.state.revisions[0]).toMatchObject({ source: "unavailable", valueKcal: null });
  });

  it("does not write a candidate when transactional source validation rejects stale inputs", async () => {
    const db = database();
    const result = await persistActiveEnergyCanonicalResolutionV1(db.client as never, eventInput({
      validateSource: async () => false,
    }));

    expect(result).toEqual({ eventId: -1, revision: -1, current: false });
    expect(db.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(db.tx.activeEnergyCanonicalEvent.create).not.toHaveBeenCalled();
    expect(db.tx.activeEnergyCandidate.upsert).not.toHaveBeenCalled();
  });

  it("merges matched aliases onto the oldest stable event and marks the other row superseded", async () => {
    const db = database();
    db.state.events.push(
      { id: 2, profileId: 7, logicalEventKey: "old-workout:2", resolutionRevision: 1, inputFingerprint: "old", isStale: false },
      { id: 5, profileId: 7, logicalEventKey: "old-session:5", resolutionRevision: 2, inputFingerprint: "old", isStale: false },
    );
    db.state.nextEventId = 6;
    db.state.aliases.push(
      { profileId: 7, sourceType: "workout", sourceId: "92", eventId: 5, workoutId: 92 },
      { profileId: 7, sourceType: "strength-session", sourceId: "92", eventId: 2 },
    );
    const input = eventInput({
      logicalEventKey: "strength-session:92",
      aliases: [
        { sourceType: "workout", sourceId: "92", workoutId: 92 },
        { sourceType: "strength-session", sourceId: "92" },
      ],
    });

    const result = await persistActiveEnergyCanonicalResolutionV1(db.client as never, input);

    expect(result.eventId).toBe(2);
    expect(db.state.events.find((row) => row.id === 5)).toMatchObject({ isStale: true, supersededByEventId: 2 });
    expect(db.state.aliases.every((row) => row.eventId === 2)).toBe(true);
    expect(db.state.revisions).toHaveLength(1);
  });

  it("fails closed when the revision compare-and-swap loses", async () => {
    const db = database();
    db.state.forceCasMiss = true;

    await expect(persistActiveEnergyCanonicalResolutionV1(db.client as never, eventInput()))
      .rejects.toThrow("active-energy canonical resolution CAS failed");
    expect(db.state.revisions).toHaveLength(0);
  });
});
