import type { MatchStatus, ResistanceType } from "@/modules/training/training.constants";
import { MATCH_STATUS, RESISTANCE } from "@/modules/training/training.constants";

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

export function formatDurationMinutes(
  startIso: string,
  endIso: string | null,
  intlLocale: string,
  uk: boolean,
): string {
  if (!endIso) return uk ? "триває" : "in progress";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60_000);
  return `${new Intl.NumberFormat(intlLocale).format(minutes)} ${uk ? "хв" : "min"}`;
}

export function formatClock(iso: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
