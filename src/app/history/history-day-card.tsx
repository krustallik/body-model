import type { DailyMetricDto } from "@/modules/days/day.types";
import { formatDurationClock, formatMetric } from "@/modules/days/metric-format";
import { historyWorkoutSummary } from "@/modules/days/history-card-presentation";
import styles from "./history.module.css";

type Props = {
  day: DailyMetricDto;
  intlLocale: string;
  uk: boolean;
  workActivityPresent: boolean | null;
  onDetails: () => void;
  onWork: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function display(value: number | null | undefined, unit: string, locale: string): string {
  const formatted = formatMetric(value ?? null, locale);
  if (formatted === "—" || unit.length === 0) return formatted;
  return unit === "%" ? `${formatted}${unit}` : `${formatted} ${unit}`;
}

function localizedUnit(unit: string, uk: boolean): string {
  if (!uk) return unit;
  return ({
    kg: "кг",
    kcal: "ккал",
    g: "г",
    km: "км",
    "km/h": "км/год",
    bpm: "уд/хв",
    "%": "%",
  } satisfies Record<string, string>)[unit] ?? unit;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function HistoryDayCard({
  day,
  intlLocale,
  uk,
  workActivityPresent,
  onDetails,
  onWork,
  onEdit,
  onDelete,
}: Props) {
  const workStatus = workActivityPresent === null
    ? (uk ? "Статус роботи недоступний" : "Work status unavailable")
    : workActivityPresent
      ? (uk ? "Робочу активність записано" : "Work activity recorded")
      : (uk ? "Робочу активність не записано" : "No work activity recorded");

  return (
    <article className={styles.dayCard} data-testid="mobile-day-card" aria-labelledby={`history-day-${day.date}`}>
      <header className={styles.dayCardHeader}>
        <h3 id={`history-day-${day.date}`}><time dateTime={day.date}>{day.date}</time></h3>
        <span className={styles.dayWorkStatus}>{workStatus}</span>
      </header>

      <dl className={styles.daySummary}>
        <Metric label={uk ? "Вага" : "Weight"} value={display(day.weightKg, localizedUnit("kg", uk), intlLocale)} />
        <Metric label={uk ? "Калорії" : "Calories"} value={display(day.caloriesKcal, localizedUnit("kcal", uk), intlLocale)} />
        <Metric label={uk ? "Кроки" : "Steps"} value={display(day.steps, "", intlLocale)} />
        <Metric label={uk ? "Тренування" : "Training"} value={historyWorkoutSummary(day, uk)} />
      </dl>

      <details className={styles.daySecondary}>
        <summary>{uk ? "Інші показники" : "Other measurements"}</summary>
        <dl>
          <Metric label={uk ? "Жирова маса" : "Body fat"} value={display(day.bodyFatPercent, localizedUnit("%", uk), intlLocale)} />
          <Metric label={uk ? "Білки" : "Protein"} value={display(day.proteinG, localizedUnit("g", uk), intlLocale)} />
          <Metric label={uk ? "Жири" : "Fat"} value={display(day.fatG, localizedUnit("g", uk), intlLocale)} />
          <Metric label={uk ? "Вуглеводи" : "Carbs"} value={display(day.carbsG, localizedUnit("g", uk), intlLocale)} />
          <Metric label={uk ? "Активна енергія" : "Active energy"} value={display(day.activeEnergyKcal, localizedUnit("kcal", uk), intlLocale)} />
          <Metric label={uk ? "Дистанція ходьби" : "Walking distance"} value={display(day.walkingDistanceKm, localizedUnit("km", uk), intlLocale)} />
          <Metric label={uk ? "Швидкість ходьби" : "Walking speed"} value={display(day.averageWalkingSpeedKmh, localizedUnit("km/h", uk), intlLocale)} />
          <Metric label={uk ? "Тривалість сну" : "Sleep duration"} value={formatDurationClock(day.sleepMinutes)} />
          <Metric label={uk ? "Пульс у спокої" : "Resting heart rate"} value={display(day.restingHeartRateBpm, localizedUnit("bpm", uk), intlLocale)} />
        </dl>
      </details>

      <div className={`${styles.actions} ${styles.dayActions}`}>
        <button type="button" aria-label={uk ? `Деталі тренування за ${day.date}` : `Workout details for ${day.date}`} onClick={onDetails}>{uk ? "Деталі" : "Details"}</button>
        <button type="button" aria-label={uk ? `Робоча активність за ${day.date}` : `Work activity for ${day.date}`} onClick={onWork}>{uk ? "Робота" : "Work"}</button>
        <button type="button" aria-label={uk ? `Редагувати ${day.date}` : `Edit ${day.date}`} onClick={onEdit}>{uk ? "Редагувати" : "Edit"}</button>
        <button type="button" className={styles.deleteButton} aria-label={uk ? `Видалити ${day.date}` : `Delete ${day.date}`} onClick={onDelete}>{uk ? "Видалити" : "Delete"}</button>
      </div>
    </article>
  );
}
