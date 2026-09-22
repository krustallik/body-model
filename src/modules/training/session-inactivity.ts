export const TRAINING_INACTIVITY_TIMEOUT_MS = 30 * 60_000;

export type InactivityEvaluation =
  | { action: "keep-active"; lastSetAt: Date | null }
  | { action: "finish"; endAt: Date; lastSetAt: Date };

/** Pure domain rule; callers persist the returned endAt atomically. */
export function evaluateSessionInactivity(input: {
  status: string;
  lastSetAt: Date | null;
  now: Date;
  timeoutMs?: number;
}): InactivityEvaluation {
  if (input.status !== "ACTIVE" || input.lastSetAt === null) {
    return { action: "keep-active", lastSetAt: input.lastSetAt };
  }
  const elapsed = input.now.getTime() - input.lastSetAt.getTime();
  return elapsed >= (input.timeoutMs ?? TRAINING_INACTIVITY_TIMEOUT_MS)
    ? { action: "finish", endAt: input.lastSetAt, lastSetAt: input.lastSetAt }
    : { action: "keep-active", lastSetAt: input.lastSetAt };
}
