export type RollbackJournalEntryV1 = {
  recordKind: string;
  recordId: number;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  sourceRevision: string | null;
};

export type VisibilitySnapshotV1 = {
  recordId: number;
  hiddenFromHistory: boolean;
  syncProtected: boolean;
  supersededByWorkoutId: number | null;
  revision: string;
};

/**
 * Records the exact previous flags before an activation writes them.
 * Rollback restores those values. It does not force every flag to false.
 */
export function planActivationVisibilityV1(input: {
  current: VisibilitySnapshotV1;
  supersedingWorkoutId: number;
}): { next: VisibilitySnapshotV1; journal: RollbackJournalEntryV1[] } {
  const next: VisibilitySnapshotV1 = {
    ...input.current,
    hiddenFromHistory: true,
    syncProtected: true,
    supersededByWorkoutId: input.supersedingWorkoutId,
  };
  const journal: RollbackJournalEntryV1[] = [
    entry(input.current, "hiddenFromHistory", input.current.hiddenFromHistory, true),
    entry(input.current, "syncProtected", input.current.syncProtected, true),
    entry(input.current, "supersededByWorkoutId", input.current.supersededByWorkoutId, input.supersedingWorkoutId),
  ];
  return { next, journal };
}

export function rollbackVisibilityV1(input: {
  current: VisibilitySnapshotV1;
  journal: readonly RollbackJournalEntryV1[];
}): VisibilitySnapshotV1 | { conflict: true } {
  const mine = input.journal.filter((row) => row.recordId === input.current.recordId);
  if (mine.some((row) => row.sourceRevision !== input.current.revision && row.field === "hiddenFromHistory"
    && input.current.hiddenFromHistory !== row.newValue)) {
    return { conflict: true };
  }
  const restored: VisibilitySnapshotV1 = { ...input.current };
  for (const row of mine) {
    if (row.field === "hiddenFromHistory") restored.hiddenFromHistory = row.previousValue === true;
    if (row.field === "syncProtected") restored.syncProtected = row.previousValue === true;
    if (row.field === "supersededByWorkoutId") {
      restored.supersededByWorkoutId = typeof row.previousValue === "number" ? row.previousValue : null;
    }
  }
  return restored;
}

export type VisibilityStoreV1 = {
  read(recordId: number): Promise<VisibilitySnapshotV1 | null>;
  write(next: VisibilitySnapshotV1): Promise<void>;
  appendJournal(generationId: string, journal: readonly RollbackJournalEntryV1[]): Promise<void>;
  readJournal(generationId: string): Promise<readonly RollbackJournalEntryV1[]>;
};

/**
 * Synthetic activation. Applies visibility through the supplied store and
 * keeps an exact journal. It does not open a production database.
 */
export async function activateVisibilityGenerationV1(input: {
  store: VisibilityStoreV1;
  generationId: string;
  changes: readonly { recordId: number; supersedingWorkoutId: number }[];
}): Promise<{ applied: number }> {
  const journal: RollbackJournalEntryV1[] = [];
  for (const change of input.changes) {
    const current = await input.store.read(change.recordId);
    if (current === null) throw new Error(`missing visibility record ${change.recordId}`);
    const planned = planActivationVisibilityV1({
      current,
      supersedingWorkoutId: change.supersedingWorkoutId,
    });
    await input.store.write(planned.next);
    journal.push(...planned.journal);
  }
  await input.store.appendJournal(input.generationId, journal);
  return { applied: input.changes.length };
}

export async function rollbackVisibilityGenerationV1(input: {
  store: VisibilityStoreV1;
  generationId: string;
}): Promise<{ restored: number; conflicts: number[] }> {
  const journal = await input.store.readJournal(input.generationId);
  const ids = [...new Set(journal.map((row) => row.recordId))];
  const conflicts: number[] = [];
  let restored = 0;
  for (const recordId of ids) {
    const current = await input.store.read(recordId);
    if (current === null) throw new Error(`missing visibility record ${recordId}`);
    const result = rollbackVisibilityV1({ current, journal });
    if ("conflict" in result) {
      conflicts.push(recordId);
      continue;
    }
    await input.store.write(result);
    restored += 1;
  }
  return { restored, conflicts };
}

export function memoryVisibilityStoreV1(
  initial: readonly VisibilitySnapshotV1[],
): VisibilityStoreV1 & { snapshot(): VisibilitySnapshotV1[] } {
  const rows = new Map(initial.map((row) => [row.recordId, { ...row }]));
  const journals = new Map<string, RollbackJournalEntryV1[]>();
  return {
    async read(recordId) {
      const row = rows.get(recordId);
      return row === undefined ? null : { ...row };
    },
    async write(next) {
      rows.set(next.recordId, { ...next });
    },
    async appendJournal(generationId, journal) {
      journals.set(generationId, [...journal]);
    },
    async readJournal(generationId) {
      return journals.get(generationId) ?? [];
    },
    snapshot() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
  };
}

function entry(
  current: VisibilitySnapshotV1,
  field: string,
  previousValue: unknown,
  newValue: unknown,
): RollbackJournalEntryV1 {
  return {
    recordKind: "workout",
    recordId: current.recordId,
    field,
    previousValue,
    newValue,
    sourceRevision: current.revision,
  };
}
