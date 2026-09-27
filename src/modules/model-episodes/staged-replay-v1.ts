import { createHash } from "node:crypto";

export type StagedReplayDayV1 = {
  date: string;
  sourceRevision: string;
  project: () => unknown;
};

export type StagedReplayResultV1 = {
  status: "complete" | "interrupted" | "stale-source";
  completed: Array<{ date: string; fingerprint: string }>;
  resumeAt: string | null;
  staleDate: string | null;
};

export function stagedReplayFingerprintV1(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/**
 * Synthetic staged replay. It does not read or write production physiology.
 * A stale source stops the run. An exception keeps the completed prefix so a
 * later call can resume at the failed date.
 */
export function runSyntheticReplayV1(input: {
  days: readonly StagedReplayDayV1[];
  expectedSourceRevision: string;
}): StagedReplayResultV1 {
  const completed: Array<{ date: string; fingerprint: string }> = [];
  for (const day of input.days) {
    if (day.sourceRevision !== input.expectedSourceRevision) {
      return {
        status: "stale-source",
        completed,
        resumeAt: day.date,
        staleDate: day.date,
      };
    }
    try {
      completed.push({
        date: day.date,
        fingerprint: stagedReplayFingerprintV1(day.project()),
      });
    } catch {
      return {
        status: "interrupted",
        completed,
        resumeAt: day.date,
        staleDate: null,
      };
    }
  }
  return { status: "complete", completed, resumeAt: null, staleDate: null };
}
