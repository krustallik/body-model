export const DEFAULT_TIME_ZONE = "Europe/Bratislava";

export class LocalTimeError extends RangeError {
  constructor(
    readonly code: "invalid-timezone" | "nonexistent-local-time" | "ambiguous-local-time",
    message: string,
  ) {
    super(message);
    this.name = "LocalTimeError";
  }
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const created = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    created.format(new Date(0));
    formatterCache.set(timeZone, created);
    return created;
  } catch {
    throw new LocalTimeError("invalid-timezone", `invalid IANA timezone: ${timeZone}`);
  }
}

function instantParts(instant: Date, timeZone: string): LocalParts & { second: number } {
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(instant)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function sameLocalMinute(left: LocalParts, right: LocalParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute;
}

function parseLocal(date: string, time: string): LocalParts {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(`${date} ${time}`);
  if (!match) throw new RangeError("date and time must use YYYY-MM-DD and HH:mm");
  const parts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() !== parts.month - 1
      || check.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59) {
    throw new RangeError("date and time must be a real local calendar minute");
  }
  return parts;
}

function offsetAt(instantMs: number, timeZone: string): number {
  const instant = new Date(instantMs);
  const parts = instantParts(instant, timeZone);
  const localAsUtc = Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
  );
  return localAsUtc - Math.floor(instantMs / 1_000) * 1_000;
}

/** Resolves a unique IANA-zone local minute to its UTC instant; DST gaps/folds are rejected. */
export function localDateTimeToInstant(date: string, time: string, timeZone: string): Date {
  const target = parseLocal(date, time);
  formatter(timeZone);
  const naiveUtc = Date.UTC(
    target.year, target.month - 1, target.day, target.hour, target.minute,
  );
  const sampleHours = [-36, -12, 0, 12, 36];
  const offsets = new Set(sampleHours.map((hours) =>
    offsetAt(naiveUtc + hours * 60 * 60 * 1_000, timeZone)));
  const candidates = [...offsets]
    .map((offset) => new Date(naiveUtc - offset))
    .filter((candidate) => sameLocalMinute(instantParts(candidate, timeZone), target));
  const unique = [...new Map(candidates.map((candidate) => [candidate.getTime(), candidate])).values()];
  if (unique.length === 0) {
    throw new LocalTimeError(
      "nonexistent-local-time",
      `${date} ${time} does not exist in ${timeZone} because of a timezone transition`,
    );
  }
  if (unique.length > 1) {
    throw new LocalTimeError(
      "ambiguous-local-time",
      `${date} ${time} occurs twice in ${timeZone}; an explicit offset is required`,
    );
  }
  return unique[0];
}

export function instantToLocalDateTime(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  if (!Number.isFinite(instant.getTime())) throw new TypeError("instant must be a valid Date");
  const parts = instantParts(instant, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}
