"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n/i18n-provider";
import type { DailyMetricDto } from "@/modules/days/day.types";
import { displayWorkoutType } from "@/modules/days/day-workout-presentation";
import { formatDateTime, formatMetric } from "@/modules/days/metric-format";
import {
  workoutEnergyProvenanceChip,
  workoutFeedProvenanceChip,
} from "@/modules/provenance/provenance-presentation";
import styles from "./history.module.css";

const EMPTY_HEART_RATE = { sampleCount: 0, minBpm: null, maxBpm: null, avgBpm: null, latestBpm: null, latestTimestamp: null, samples: [] };

function formatClock(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function formatLongDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function WorkoutDetailsDialog({
  day,
  onClose,
}: {
  day: DailyMetricDto;
  onClose: () => void;
}) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const titleDate = formatLongDate(day.date, intlLocale);
  const feedChip = workoutFeedProvenanceChip(day.workoutFeedObserved, locale);

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={styles.dialogHeader}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Деталі дня" : "Day details"}</p>
          <h2>{uk ? `Тренування за ${titleDate}` : `Workouts on ${titleDate}`}</h2>
        </div>
        <button className={styles.closeButton} type="button" aria-label={uk ? "Закрити" : "Close"} onClick={onClose}>×</button>
      </div>

      {feedChip && (
        <p className={styles.provenanceChip} data-tone={feedChip.tone} title={feedChip.detail}>
          <span>{feedChip.label}</span>
          <small>{feedChip.detail}</small>
        </p>
      )}

      {day.workoutSource === "legacy-strength" ? (
        <div className={styles.workoutDetailList}>
          <article className={styles.workoutDetailCard}>
            <strong>{uk ? "Силове тренування" : "Strength training"}</strong>
            <p>{uk
              ? `${formatMetric(day.totalWorkoutMinutes, intlLocale)} хв · legacy day field`
              : `${formatMetric(day.totalWorkoutMinutes, intlLocale)} min · legacy day field`}</p>
            <small>{uk
              ? "Окремі workout events відсутні. Показано денне поле силового тренування."
              : "No explicit workout events. Showing the legacy day strength field."}</small>
          </article>
        </div>
      ) : (
        <div className={styles.workoutDetailList}>
          {day.workouts.map((workout) => {
            const energy = workoutEnergyProvenanceChip(workout.activeEnergyKcal, locale);
            const isStrength = workout.classification === "traditional-strength-training";
            const cardHref = isStrength
              ? (workout.linkedTrainingSessionId != null
                ? `/training/sessions/${workout.linkedTrainingSessionId}`
                : workout.id != null
                  ? `/training/backfill/from/${workout.id}`
                  : null)
              : null;
            return (
            <article
              className={
                cardHref
                  ? `${styles.workoutDetailCard} ${styles.workoutDetailCardInteractive}`
                  : styles.workoutDetailCard
              }
              key={`${workout.startAt}-${workout.type}`}
            >
              {cardHref ? (
                <Link
                  className={styles.workoutCardHit}
                  href={cardHref}
                  aria-label={displayWorkoutType(workout)}
                >
                  <span aria-hidden="true" />
                </Link>
              ) : null}
              <strong>{displayWorkoutType(workout)}</strong>
              <p>
                {formatClock(workout.startAt, intlLocale)}
                –
                {formatClock(workout.endAt, intlLocale)}
              </p>
              <dl className={styles.workoutDetailMeta}>
                <div>
                  <dt>{uk ? "Тривалість" : "Duration"}</dt>
                  <dd>{workout.durationMinutes === null
                    ? "—"
                    : `${formatMetric(workout.durationMinutes, intlLocale)} ${uk ? "хв" : "min"}`}</dd>
                </div>
                <div>
                  <dt>{uk ? "Активні ккал" : "Active kcal"}</dt>
                  <dd>{energy.tone === "unavailable"
                    ? "—"
                    : `${formatMetric(workout.activeEnergyKcal, intlLocale)} ${uk ? "активних ккал" : "active kcal"}`}</dd>
                </div>
              </dl>
              <p className={styles.provenanceChip} data-tone={energy.tone} title={energy.detail}>
                <span>{energy.label}</span>
                <small>{energy.detail}</small>
              </p>
              {workout.classification === "traditional-strength-training" && (
                <p>
                  {workout.linkedTrainingSessionId != null ? (
                    <Link
                      className={styles.workoutLink}
                      href={`/training/sessions/${workout.linkedTrainingSessionId}/edit`}
                    >
                      {uk ? "Редагувати запис тренування" : "Edit training diary entry"}
                      {workout.linkedTrainingProgramName ? ` · ${workout.linkedTrainingProgramName}` : ""}
                    </Link>
                  ) : workout.id != null ? (
                    <Link
                      className={styles.workoutLink}
                      href={`/training/backfill/from/${workout.id}`}
                    >
                      {uk ? "Додати запис тренування" : "Add training diary entry"}
                    </Link>
                  ) : null}
                </p>
              )}
              {workout.classification !== "traditional-strength-training"
                && workout.linkedTrainingSessionId != null && (
                <p>
                  <Link className={styles.workoutLink} href={`/training/sessions/${workout.linkedTrainingSessionId}`}>
                    {uk ? "Запис тренування" : "Training diary entry"}
                    {workout.linkedTrainingProgramName ? ` · ${workout.linkedTrainingProgramName}` : ""}
                  </Link>
                </p>
              )}
              {workout.classification === "stair-climbing" && workout.id != null && (
                <p><Link className={styles.workoutLink} href={`/api/v1/workouts/${workout.id}/stepper-diagnostic`}>
                  {uk ? "Відкрити діагностику степера" : "Open stepper diagnostic"}
                </Link></p>
              )}
            </article>
            );
          })}
        </div>
      )}

      <section className={styles.heartRateDetails}>
        <HeartRateSummary title={uk ? "Пульс" : "Heart rate"} data={day.heartRate ?? EMPTY_HEART_RATE} uk={uk} intlLocale={intlLocale} />
        {(day.heartRate ?? EMPTY_HEART_RATE).sampleCount === 0 ? <p className={styles.heartRateEmpty}>{uk ? "Немає даних пульсу" : "No heart rate data"}</p> : (
          <div className={styles.heartRateChart}><ResponsiveContainer width="100%" height="100%"><LineChart data={(day.heartRate ?? EMPTY_HEART_RATE).samples}><XAxis dataKey="timestamp" tickFormatter={(value) => formatClock(String(value), intlLocale)} /><YAxis domain={["auto", "auto"]} /><Tooltip labelFormatter={(value) => formatClock(String(value), intlLocale)} formatter={(value) => [`${value} bpm`, uk ? "Пульс" : "Heart rate"]} /><Line type="monotone" dataKey="bpm" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
        )}
        <HeartRateSummary title={uk ? "Пульс у спокої" : "Resting heart rate"} data={day.restingHeartRate ?? EMPTY_HEART_RATE} uk={uk} intlLocale={intlLocale} />
      </section>

      <p className={styles.updatedMeta}>
        {uk ? "Оновлено" : "Updated"}: {formatDateTime(day.updatedAt, intlLocale)}
      </p>

      <div className={styles.dialogActions}>
        <button className={styles.secondaryButton} type="button" onClick={onClose}>{uk ? "Закрити" : "Close"}</button>
      </div>
    </dialog>
  );
}

function HeartRateSummary({ title, data, uk, intlLocale }: { title: string; data: NonNullable<DailyMetricDto["heartRate"]>; uk: boolean; intlLocale: string }) {
  return <article className={styles.heartRateSummary}><strong>{title}</strong>{data.sampleCount === 0 ? <p>{uk ? "Немає даних" : "No data"}</p> : <><p>{uk ? `Зразків: ${data.sampleCount}` : `Samples: ${data.sampleCount}`} · {data.latestTimestamp ? formatClock(data.latestTimestamp, intlLocale) : "—"}</p><dl className={styles.workoutDetailMeta}><div><dt>{uk ? "Останній" : "Latest"}</dt><dd>{formatMetric(data.latestBpm, intlLocale)} bpm</dd></div><div><dt>Min / Max / Avg</dt><dd>{formatMetric(data.minBpm, intlLocale)} / {formatMetric(data.maxBpm, intlLocale)} / {formatMetric(data.avgBpm, intlLocale)}</dd></div></dl></>}</article>;
}
