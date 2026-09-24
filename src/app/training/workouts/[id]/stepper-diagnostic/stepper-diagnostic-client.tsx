"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import type { StepperWorkoutDiagnosticV7 } from "@/modules/profile/stepper-workout-diagnostic";
import { useI18n } from "@/i18n/i18n-provider";
import styles from "./stepper-diagnostic.module.css";

type DiagnosticResponse = { diagnostic?: StepperWorkoutDiagnosticV7; error?: string };
type IntervalStepEvidence = Extract<StepperWorkoutDiagnosticV7["bracketedSteps"], { availability: "available" }> & {
  intervalCoveragePercent: number;
  observedIntervalStepCount: number;
};

function hasIntervalEvidence(value: StepperWorkoutDiagnosticV7["bracketedSteps"] | undefined): value is IntervalStepEvidence {
  return value?.availability === "available"
    && typeof value.intervalCoveragePercent === "number"
    && typeof value.observedIntervalStepCount === "number";
}

function formatInstant(value: string, intlLocale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone: DEFAULT_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function Instant({ value, intlLocale }: { value: string; intlLocale: string }) {
  return <time dateTime={value}>{formatInstant(value, intlLocale)}</time>;
}

function NumberValue({ value, intlLocale }: { value: number; intlLocale: string }) {
  return <span>{new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 3 }).format(value)}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.field}><dt>{label}</dt><dd>{children}</dd></div>;
}

function CodeMeaning({ value, uk }: { value: string; uk?: string }) {
  return <span className={styles.codeMeaning}>{uk ?? value}</span>;
}

function Interval({ value, intlLocale, uk }: {
  value: { startAt: string; endAt: string } | null;
  intlLocale: string;
  uk: boolean;
}) {
  return value === null ? <span className={styles.muted}>—</span> : (
    <span className={styles.interval}>
      <span>{uk ? "Від" : "From"}: <Instant value={value.startAt} intlLocale={intlLocale} /></span>
      <span>{uk ? "До" : "To"}: <Instant value={value.endAt} intlLocale={intlLocale} /></span>
    </span>
  );
}

function Section({ title, subtitle, children, tone }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  tone?: "info" | "neutral";
}) {
  return (
    <section className={`${styles.panel} ${tone === "info" ? styles.panelInfo : ""}`}>
      <header className={styles.panelHeader}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function StepperDiagnosticClient({ workoutId }: { workoutId: string }) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const [diagnostic, setDiagnostic] = useState<StepperWorkoutDiagnosticV7 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/workouts/${encodeURIComponent(workoutId)}/stepper-diagnostic`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as DiagnosticResponse;
        if (!response.ok || !body.diagnostic) throw new Error(body.error ?? "internal_error");
        if (active) setDiagnostic(body.diagnostic);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        const code = reason instanceof Error ? reason.message : "internal_error";
        setError(code === "not_found" ? (uk ? "Тренування не знайдено." : "Workout not found.")
          : code === "not_stair_workout" ? (uk ? "Це тренування не належить до Stair Climbing." : "This workout is not a Stair Climbing event.")
            : (uk ? "Не вдалося завантажити діагностику." : "Could not load diagnostics."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uk, workoutId]);

  const steps = diagnostic?.bracketedSteps;
  const intervalEvidence = hasIntervalEvidence(steps) ? steps : null;
  const intervalEvidenceAvailable = intervalEvidence !== null;
  const hr = diagnostic?.heartRate;
  const topology = hr?.samplingTopology;

  return (
    <main className={styles.page}>
      <div className={styles.navRow}><strong>BodyCast</strong><AppNav active="training" /></div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Тренування · фактичні джерела" : "Workout · observed sources"}</p>
          <h1>{uk ? "Діагностика степера" : "Stepper diagnostics"}</h1>
          <p className={styles.intro}>{uk ? "Факти тренування, кроки за інтервалами активності, енергія пристрою та структура зразків пульсу." : "Workout facts, steps from activity intervals, device energy, and heart-rate sampling."}</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href="/history">{uk ? "Історія" : "History"}</Link>
          <Link className={styles.secondaryButton} href="/training">{uk ? "Тренування" : "Training"}</Link>
        </div>
      </header>

      {loading && <p className={styles.loading} role="status">{uk ? "Завантаження діагностики…" : "Loading diagnostics…"}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {diagnostic && (
        <div className={styles.stack}>
          <Section title={uk ? "Тренування" : "Workout"} subtitle={uk ? "Канонічний тип і записаний інтервал" : "Canonical type and recorded interval"} tone="info">
            <dl className={styles.fieldGrid}>
              <Field label={uk ? "Тип тренування" : "Workout type"}><CodeMeaning value={diagnostic.workout.canonicalWorkoutType ?? "null"} uk={uk && diagnostic.workout.canonicalWorkoutType === "Stair Climbing" ? "Степер" : undefined} /></Field>
              <Field label={uk ? "Початок" : "Start"}><Instant value={diagnostic.workout.startAt} intlLocale={intlLocale} /></Field>
              <Field label={uk ? "Завершення" : "End"}><Instant value={diagnostic.workout.endAt} intlLocale={intlLocale} /></Field>
              <Field label={uk ? "Тривалість · хв" : "Duration · min"}>{diagnostic.workout.durationMinutes === null ? "—" : <NumberValue value={diagnostic.workout.durationMinutes} intlLocale={intlLocale} />}</Field>
            </dl>
          </Section>

          <Section title={uk ? "Кроки за інтервалами" : "Steps from intervals"} subtitle={uk ? "Кроки з інтервалів активності, що збігаються з тренуванням" : "Steps from activity intervals overlapping the workout"}>
            <div className={styles.statusRow}>
              <span className={intervalEvidenceAvailable ? styles.badgeSuccess : styles.badgeWarning}>
                {intervalEvidenceAvailable ? (uk ? "Доступно" : "Available") : (uk ? "Недоступно" : "Unavailable")}
              </span>
              {!intervalEvidenceAvailable && <span>{uk ? "Немає інтервалів кроків у межах тренування" : "No step intervals overlap the workout"}</span>}
            </div>
            <dl className={styles.fieldGrid}>
              <Field label={uk ? "Покриття інтервалами кроків" : "Step interval coverage"}>{intervalEvidence ? new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(intervalEvidence.intervalCoveragePercent) + "%" : "—"}</Field>
              <Field label={uk ? "Кроки у виміряних частинах" : "Steps in observed portions"}>{intervalEvidence ? <NumberValue value={intervalEvidence.observedIntervalStepCount} intlLocale={intlLocale} /> : "—"}</Field>
              <Field label={uk ? "Оцінка кроків за тренування" : "Estimated workout steps"}>{intervalEvidence?.derivedStepDelta ? <NumberValue value={intervalEvidence.derivedStepDelta.value} intlLocale={intlLocale} /> : "—"}</Field>
              <Field label={uk ? "Темп · кроків/хв" : "Rate · steps/min"}>{intervalEvidence?.derivedStepRatePerMinute ? <NumberValue value={intervalEvidence.derivedStepRatePerMinute.value} intlLocale={intlLocale} /> : "—"}</Field>
            </dl>
          </Section>

          <Section title={uk ? "Енергія пристрою" : "Device energy"} subtitle={uk ? "Значення пристрою — оцінка, не вимірювання калориметром" : "A device estimate, not calorimetry"}>
            <dl className={styles.fieldGrid}>
              <Field label={uk ? "Доступність" : "Availability"}><CodeMeaning value={diagnostic.deviceEnergy.availability} uk={diagnostic.deviceEnergy.availability === "available" ? (uk ? "Доступно" : "Available") : (uk ? "Недоступно" : "Unavailable")} /></Field>
              {diagnostic.deviceEnergy.availability === "available" ? <>
                <Field label={uk ? "Значення · ккал" : "Value · kcal"}><NumberValue value={diagnostic.deviceEnergy.valueKcal} intlLocale={intlLocale} /></Field>
                <Field label={uk ? "Тип енергії" : "Energy type"}><CodeMeaning value={diagnostic.deviceEnergy.semantics} uk={diagnostic.deviceEnergy.semantics === "active" ? (uk ? "Активна енергія" : "Active energy") : (uk ? "Загальна енергія" : "Gross energy")} /></Field>
              </> : null}
            </dl>
          </Section>

          <Section title={uk ? "Пульс" : "Heart rate"} subtitle={uk ? "Статистика описує лише наявні зразки; це не середній пульс за часом" : "Statistics describe observed samples only; this is not a time-weighted mean"}>
            <div className={styles.statusRow}><span className={hr?.availability === "loaded" ? styles.badgeInfo : styles.badgeMuted}>{hr?.availability === "loaded" ? (uk ? "Завантажено" : "Loaded") : (uk ? "Недоступно" : "Unavailable")}</span></div>
            <dl className={styles.fieldGrid}>
              <Field label={uk ? "Середнє спостережених зразків · bpm" : "Observed sample mean · bpm"}>{hr?.summary === null || hr?.summary === undefined ? "—" : <NumberValue value={hr.summary.sampleMeanBpm} intlLocale={intlLocale} />}</Field>
              <Field label={uk ? "Максимум серед зразків · bpm" : "Maximum observed · bpm"}>{hr?.summary === null || hr?.summary === undefined ? "—" : <NumberValue value={hr.summary.maxObservedBpm} intlLocale={intlLocale} />}</Field>
            </dl>
            {topology === null || topology === undefined ? (
              <p className={styles.muted}>{uk ? "Топологія зразків недоступна." : "Sampling topology is unavailable."}</p>
            ) : (
              <div className={styles.topology}>
                <div className={styles.topologyRow}><strong>{uk ? "Охоплений зразками проміжок" : "Sampled span"}</strong><Interval value={topology.sampledSpan} intlLocale={intlLocale} uk={uk} /></div>
              </div>
            )}
          </Section>

          <Section title={uk ? "Обладнання" : "Equipment"}><p>DOMYOS MS100 · {uk ? "фіксована конфігурація" : "fixed configuration"}</p></Section>
        </div>
      )}
    </main>
  );
}
