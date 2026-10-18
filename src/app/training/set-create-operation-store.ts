export type StoredSetCreateOperation = {
  operationId: string;
  sessionId: number;
  exerciseId: number;
  payload: Record<string, unknown>;
  draft: unknown;
  createdAt: number;
  terminalState?: "new-intent-required" | "replaced";
  terminalReason?: "not-committed" | "tombstoned";
  replacementOperationId?: string;
};

export type StoredStepperCreateOperation = {
  operationId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  terminalState?: "tombstoned" | "rejected";
  /** A user-authorized fresh intent supersedes this archived terminal operation. */
  replacementOperationId?: string;
};

const DATABASE_NAME = "bodycast-training-operations-v1";
const DATABASE_VERSION = 2;
const STORE_NAME = "set-create-operations";
const STEPPER_STORE_NAME = "stepper-create-operations";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable; set create is disabled."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "operationId" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STEPPER_STORE_NAME)) {
        const store = db.createObjectStore(STEPPER_STORE_NAME, { keyPath: "operationId" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked."));
  });
}

/** Persist a Stepper draft before POST; never overwrite a prior intent for this key. */
export async function storeStepperCreateOperation(operation: StoredStepperCreateOperation): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STEPPER_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STEPPER_STORE_NAME);
      const request = store.get(operation.operationId);
      request.onsuccess = () => {
        const existing = request.result as StoredStepperCreateOperation | undefined;
        if (existing === undefined) store.add(operation);
        else if (JSON.stringify(existing.payload) !== JSON.stringify(operation.payload)) transaction.abort();
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not persist the Stepper draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Stepper draft persistence was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function listStepperCreateOperations(): Promise<StoredStepperCreateOperation[]> {
  const db = await openDatabase();
  try {
    return await new Promise<StoredStepperCreateOperation[]>((resolve, reject) => {
      const request = db.transaction(STEPPER_STORE_NAME, "readonly")
        .objectStore(STEPPER_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as StoredStepperCreateOperation[])
        .sort((left, right) => left.createdAt - right.createdAt));
      request.onerror = () => reject(request.error ?? new Error("Could not read pending Stepper drafts."));
    });
  } finally {
    db.close();
  }
}

/** Preserve a server-confirmed tombstone and its exact draft for audit/recovery. */
export async function markStepperCreateOperationTombstoned(operation: StoredStepperCreateOperation): Promise<StoredStepperCreateOperation> {
  return markStepperCreateOperationTerminal(operation, "tombstoned");
}

/** Persist a definitive pre-write validation rejection while retaining its exact draft. */
export async function markStepperCreateOperationRejected(operation: StoredStepperCreateOperation): Promise<StoredStepperCreateOperation> {
  return markStepperCreateOperationTerminal(operation, "rejected");
}

async function markStepperCreateOperationTerminal(
  operation: StoredStepperCreateOperation,
  terminalState: "tombstoned" | "rejected",
): Promise<StoredStepperCreateOperation> {
  const db = await openDatabase();
  try {
    return await new Promise<StoredStepperCreateOperation>((resolve, reject) => {
      const transaction = db.transaction(STEPPER_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STEPPER_STORE_NAME);
      let updated: StoredStepperCreateOperation | null = null;
      const request = store.get(operation.operationId);
      request.onsuccess = () => {
        const current = request.result as StoredStepperCreateOperation | undefined;
        if (current && JSON.stringify(current.payload) !== JSON.stringify(operation.payload)) {
          transaction.abort();
          return;
        }
        if (current) {
          if (current.terminalState && current.terminalState !== terminalState) {
            transaction.abort();
            return;
          }
          updated = { ...current, terminalState };
          store.put(updated);
        } else {
          updated = { ...operation, terminalState };
          store.add(updated);
        }
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(updated!);
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not persist the Stepper terminal state."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Stepper terminal-state persistence was aborted."));
    });
  } finally {
    db.close();
  }
}

/** Atomically archive a terminal operation as replaced and persist a user-authorized fresh intent. */
export async function replaceStepperCreateOperation(
  previousOperationId: string,
  operation: StoredStepperCreateOperation,
): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STEPPER_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STEPPER_STORE_NAME);
      const request = store.get(previousOperationId);
      request.onsuccess = () => {
        const previous = request.result as StoredStepperCreateOperation | undefined;
        if (!previous || (previous.terminalState !== "tombstoned" && previous.terminalState !== "rejected") || previous.replacementOperationId
            || previousOperationId === operation.operationId) {
          transaction.abort();
          return;
        }
        const replacement = store.get(operation.operationId);
        replacement.onsuccess = () => {
          if (replacement.result !== undefined) {
            transaction.abort();
            return;
          }
          store.put({ ...previous, replacementOperationId: operation.operationId });
          store.add(operation);
        };
        replacement.onerror = () => transaction.abort();
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not replace the terminal Stepper intent."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Stepper intent replacement was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function removeStepperCreateOperation(operationId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STEPPER_STORE_NAME, "readwrite");
      transaction.objectStore(STEPPER_STORE_NAME).delete(operationId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the resolved Stepper draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Stepper draft removal was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function storeSetCreateOperation(operation: StoredSetCreateOperation): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(operation.operationId);
      request.onsuccess = () => {
        // This API is for first persistence of a freshly generated intent. Never
        // let a stale tab overwrite an existing row (especially an alias).
        if (request.result === undefined) store.add(operation);
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not persist the set draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Set draft persistence was aborted."));
    });
  } finally {
    db.close();
  }
}

/**
 * Persist a terminal outcome without overwriting a row that another tab has
 * already replaced. If the row is an alias, return its current leaf and leave
 * the alias chain untouched so callers can adopt it without posting the stale
 * operation.
 */
export async function markSetCreateOperationTerminal(
  operation: StoredSetCreateOperation,
): Promise<StoredSetCreateOperation | null> {
  if (operation.terminalState !== "new-intent-required") {
    throw new Error("Only an explicitly terminal set operation can be marked terminal.");
  }
  const db = await openDatabase();
  try {
    return await new Promise<StoredSetCreateOperation | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let selectedOperation: StoredSetCreateOperation | null = null;
      let failed = false;

      const resolveLeaf = (operationId: string, visited: Set<string>) => {
        if (visited.has(operationId) || visited.size >= 64) {
          failed = true;
          transaction.abort();
          return;
        }
        visited.add(operationId);
        const request = store.get(operationId);
        request.onsuccess = () => {
          const current = request.result as StoredSetCreateOperation | undefined;
          if (!current) {
            failed = true;
            transaction.abort();
            return;
          }
          if (current.replacementOperationId) {
            resolveLeaf(current.replacementOperationId, visited);
            return;
          }
          if (current.terminalState === "replaced") {
            failed = true;
            transaction.abort();
            return;
          }
          selectedOperation = current;
          if (operationId === operation.operationId) {
            selectedOperation = {
              ...current,
              terminalState: operation.terminalState,
              terminalReason: operation.terminalReason,
            };
            store.put(selectedOperation);
          }
        };
        request.onerror = () => {
          failed = true;
          transaction.abort();
        };
      };

      const originalRequest = store.get(operation.operationId);
      originalRequest.onsuccess = () => {
        const current = originalRequest.result as StoredSetCreateOperation | undefined;
        if (!current) {
          // A status read can outlive local cleanup. A 410/tombstone is still
          // authoritative, so restore the exact intent as an explicit terminal
          // record; a later replacement remains a user action.
          selectedOperation = operation;
          store.add(operation);
          return;
        }
        resolveLeaf(operation.operationId, new Set());
      };
      originalRequest.onerror = () => {
        failed = true;
        transaction.abort();
      };
      transaction.oncomplete = () => resolve(selectedOperation);
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not persist the set operation outcome."));
      transaction.onabort = () => reject(transaction.error ?? new Error(
        failed ? "The set operation alias chain is incomplete or cyclic." : "Set operation terminal update was aborted.",
      ));
    });
  } finally {
    db.close();
  }
}

export async function replaceSetCreateOperation(
  previousOperationId: string,
  operation: StoredSetCreateOperation,
): Promise<StoredSetCreateOperation | null> {
  const db = await openDatabase();
  try {
    return await new Promise<StoredSetCreateOperation | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let selectedOperation: StoredSetCreateOperation | null = null;
      let failed = false;
      const resolveLeaf = (operationId: string, visited: Set<string>) => {
        if (visited.has(operationId) || visited.size >= 64) {
          failed = true;
          transaction.abort();
          return;
        }
        visited.add(operationId);
        const request = store.get(operationId);
        request.onsuccess = () => {
          const previous = request.result as StoredSetCreateOperation | undefined;
          if (!previous) {
            failed = true;
            transaction.abort();
            return;
          }
          if (previous.replacementOperationId) {
            resolveLeaf(previous.replacementOperationId, visited);
            return;
          }
          if (previous.terminalState === "replaced") {
            failed = true;
            transaction.abort();
            return;
          }
          selectedOperation = previous;
          // A caller holding an old alias may learn the canonical leaf, but it
          // cannot replace that leaf as a side effect of the stale click.
          if (operationId !== previousOperationId) return;
          if (previous.terminalState !== "new-intent-required") {
            if (previous.terminalState === "replaced") {
              failed = true;
              transaction.abort();
            }
            return;
          }

          const replacement: StoredSetCreateOperation = {
            operationId: operation.operationId,
            sessionId: previous.sessionId,
            exerciseId: previous.exerciseId,
            payload: previous.payload,
            draft: previous.draft,
            createdAt: operation.createdAt,
          };
          selectedOperation = replacement;
          store.put({
            ...previous,
            terminalState: "replaced",
            terminalReason: undefined,
            replacementOperationId: replacement.operationId,
          });
          store.add(replacement);
        };
        request.onerror = () => {
          failed = true;
          transaction.abort();
        };
      };
      const previousRequest = store.get(previousOperationId);
      previousRequest.onsuccess = () => {
        if (!previousRequest.result) return;
        resolveLeaf(previousOperationId, new Set());
      };
      previousRequest.onerror = () => {
        failed = true;
        transaction.abort();
      };
      transaction.oncomplete = () => resolve(selectedOperation);
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not replace the resolved set draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error(
        failed ? "The set operation alias chain is incomplete or cyclic." : "Set draft replacement was aborted.",
      ));
    });
  } finally {
    db.close();
  }
}

export async function listSetCreateOperations(sessionId: number): Promise<StoredSetCreateOperation[]> {
  const db = await openDatabase();
  try {
    return await new Promise<StoredSetCreateOperation[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME).index("sessionId").getAll(IDBKeyRange.only(sessionId));
      request.onsuccess = () => resolve((request.result as StoredSetCreateOperation[])
        .filter((operation) => operation.replacementOperationId === undefined));
      request.onerror = () => reject(request.error ?? new Error("Could not read pending set drafts."));
    });
  } finally {
    db.close();
  }
}

export async function removeSetCreateOperation(operationId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const rows: StoredSetCreateOperation[] = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          rows.push(cursor.value as StoredSetCreateOperation);
          cursor.continue();
          return;
        }
        const removedIds = new Set([operationId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const row of rows) {
            if (row.replacementOperationId && removedIds.has(row.replacementOperationId)
                && !removedIds.has(row.operationId)) {
              removedIds.add(row.operationId);
              changed = true;
            }
          }
        }
        for (const removedId of removedIds) store.delete(removedId);
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear the resolved set draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Set draft removal was aborted."));
    });
  } finally {
    db.close();
  }
}
