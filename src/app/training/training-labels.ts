import type { MatchStatus, ResistanceType } from "@/modules/training/training.constants";
import { DIARY_COMPLETENESS, MATCH_STATUS, RESISTANCE } from "@/modules/training/training.constants";

export function resistanceLabel(type: ResistanceType, uk: boolean): string {
  if (type === RESISTANCE.EXTERNAL_WEIGHT) return uk ? "Зовнішня вага" : "External weight";
  if (type === RESISTANCE.RESISTANCE_BAND) return uk ? "Резинки" : "Resistance bands";
  return uk ? "Власна вага" : "Bodyweight";
}

export function matchStatusLabel(status: MatchStatus, uk: boolean): string {
  switch (status) {
    case MATCH_STATUS.PENDING:
      return uk ? "Очікує Garmin" : "Pending Garmin";
    case MATCH_STATUS.MATCHED:
      return uk ? "Зіставлено" : "Matched";
    case MATCH_STATUS.AMBIGUOUS:
      return uk ? "Неоднозначно" : "Ambiguous";
    case MATCH_STATUS.UNMATCHED:
      return uk ? "Без зіставлення" : "Unmatched";
    default:
      return status;
  }
}

/** CSS module class key for match-status badges (BodyCast secondary chips). */
export function matchStatusBadgeTone(
  status: MatchStatus,
): "ok" | "warn" | "muted" | "neutral" | "info" | "danger" {
  switch (status) {
    case MATCH_STATUS.MATCHED:
      return "ok";
    case MATCH_STATUS.AMBIGUOUS:
      return "warn";
    case MATCH_STATUS.PENDING:
      return "info";
    case MATCH_STATUS.UNMATCHED:
      return "warn";
    default:
      return "muted";
  }
}

export function diaryCompletenessBadgeTone(
  value: (typeof DIARY_COMPLETENESS)[keyof typeof DIARY_COMPLETENESS],
): "neutral" | "muted" | "warn" | "ok" {
  switch (value) {
    case DIARY_COMPLETENESS.NO_DIARY:
      return "warn";
    case DIARY_COMPLETENESS.DIARY_EMPTY:
      return "neutral";
    case DIARY_COMPLETENESS.DIARY_PARTIAL:
      return "warn";
    case DIARY_COMPLETENESS.DIARY_WITH_SETS:
      return "ok";
    default:
      return "muted";
  }
}

export async function readApiError(response: Response, uk: boolean): Promise<string> {
  try {
    const body = await response.json() as { error?: string; message?: string };
    if (typeof body.message === "string" && body.message.trim()) return body.message;
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // ignore parse failures
  }
  return uk ? `Помилка ${response.status}` : `Error ${response.status}`;
}

/** Null start means a RETROSPECTIVE session that never had live web times. */
export function formatDurationMinutes(
  startIso: string | null,
  endIso: string | null,
  intlLocale: string,
  uk: boolean,
): string {
  if (!startIso) return "—";
  if (!endIso) return uk ? "триває" : "in progress";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60_000);
  return `${new Intl.NumberFormat(intlLocale).format(minutes)} ${uk ? "хв" : "min"}`;
}

export function formatElapsedClock(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = totalSec % 60;
  const minutes = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatClock(iso: string | null, intlLocale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function planCompletionTone(percent: number): "complete" | "good" | "low" {
  if (percent >= 100) return "complete";
  if (percent >= 70) return "good";
  return "low";
}

export function planCompletionPillClass(
  percent: number,
  styles: Readonly<Record<string, string>>,
): string {
  const tone = planCompletionTone(percent);
  const toneClass = tone === "complete"
    ? styles.planCompletionComplete
    : tone === "good"
      ? styles.planCompletionGood
      : styles.planCompletionLow;
  return `${styles.planCompletionPill} ${toneClass}`;
}

export function formatDateTime(iso: string | null, intlLocale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
