import type { TrainingDayFact } from "./training-day-fact";

/** Empty facts are explicit zeros for event occurrence, not biometric measurements. */
export function emptyTrainingDayFact(date: string): TrainingDayFact {
  return {
    date,
    eventCount: 0,
    durationMinutes: 0,
    hiddenEventCount: 0,
    events: [],
  };
}
