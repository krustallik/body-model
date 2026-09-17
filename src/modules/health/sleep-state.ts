export const SLEEP_STATES = [
  "awake",
  "inBed",
  "core",
  "deep",
  "rem",
  "asleepUnspecified",
  "unknown",
] as const;

export type SleepState = (typeof SLEEP_STATES)[number];

export const ASLEEP_STATES = ["core", "deep", "rem", "asleepUnspecified"] as const;
export type AsleepState = (typeof ASLEEP_STATES)[number];

const LOCALIZED_STATE_MAP: Record<string, SleepState> = {
  "без сну": "awake",
  "у ліжку": "inBed",
  "повільний": "core",
  "глибокий": "deep",
  "швидкий": "rem",
  awake: "awake",
  inbed: "inBed",
  "in bed": "inBed",
  core: "core",
  deep: "deep",
  rem: "rem",
  asleep: "asleepUnspecified",
  "asleep unspecified": "asleepUnspecified",
  asleepunspecified: "asleepUnspecified",
  unknown: "unknown",
};

export function canonicalizeSleepState(rawState: string): SleepState {
  const key = rawState.trim().toLowerCase();
  return LOCALIZED_STATE_MAP[key] ?? "unknown";
}

export function isAsleepState(state: SleepState): state is AsleepState {
  return (ASLEEP_STATES as readonly string[]).includes(state);
}
