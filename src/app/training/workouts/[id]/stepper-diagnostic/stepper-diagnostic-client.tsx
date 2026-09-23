"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import type { StepperWorkoutDiagnosticV7 } from "@/modules/profile/stepper-workout-diagnostic";
import { useI18n } from "@/i18n/i18n-provider";
import styles from "./stepper-diagnostic.module.css";

type DiagnosticResponse = { diagnostic?: StepperWorkoutDiagnosticV7; error?: string };
const GAP_PAGE_SIZE = 50;

function displayReason(value: string, uk: boolean): string {
  const labels: Record<string, [string, string]> = {
    "no-before-snapshot": ["Немає знімка кроків перед тренуванням", "No step snapshot before the workout"],
    "no-after-snapshot": ["Немає знімка кроків після тренування", "No step snapshot after the workout"],
    "missing-step-counter": ["У знімку відсутній лічильник кроків", "A snapshot has no step counter"],
    "counter-decrease": ["Лічильник кроків зменшився між знімками", "The step counter decreased between snapshots"],
    "incomplete-step-interval-coverage": ["Інтервали кроків не покривають усе тренування", "Step intervals do not cover the whole workout"],
    "not-stair-workout": ["Це не тренування Stair Climbing", "This is not a Stair Climbing workout"],
    "no-device-active-energy": ["Немає active energy з пристрою", "No device active energy was recorded"],
  };
  return labels[value]?.[uk ? 0 : 1] ?? value;
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
  return <span className={styles.technicalValue}><time dateTime={value}>{formatInstant(value, intlLocale)}</time><code>{value}</code></span>;
}

function NumberValue({ value, intlLocale }: { value: number; intlLocale: string }) {
  return <span className={styles.technicalValue}><span>{new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 3 }).format(value)}</span><code>{String(value)}</code></span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.field}><dt>{label}</dt><dd>{children}</dd></div>;
}

function CodeMeaning({ value, uk }: { value: string; uk?: string }) {
  return <span className={styles.codeMeaning}>{uk && <span>{uk}</span>}<code>{value}</code></span>;
}

function Snapshot({ value, name, intlLocale, uk }: {
  value: StepperWorkoutDiagnosticV7["bracketedSteps"]["before"];
  name: string;
  intlLocale: string;
  uk: boolean;
}) {
  return (
    <section className={styles.subpanel} aria-label={name}>
      <h3>{name}</h3>
      {value === null ? <p className={styles.muted}>{uk ? "Немає знімка" : "No snapshot"}</p> : (
        <dl className={styles.fieldGrid}>
          <Field label={uk ? "ID знімка" : "Snapshot ID"}>{value.snapshotId}</Field>
          <Field label={uk ? "Час" : "Timestamp"}><Instant value={value.timestamp} intlLocale={intlLocale} /></Field>
          <Field label={uk ? "Основа часу" : "Timestamp basis"}>
            <CodeMeaning value={value.timestampBasis} uk={value.timestampBasis === "synced-at" ? (uk ? "Час синхронізації" : "Sync time") : (uk ? "Час отримання" : "Receive time")} />
          </Field>
          <Field label={uk ? "Лічильник кроків" : "Step counter"}>{value.stepCount === null ? "—" : <NumberValue value={value.stepCount} intlLocale={intlLocale} />}</Field>
        </dl>
      )}
    </section>
  );
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

function GapList({ gaps, intlLocale, uk }: {
  gaps: readonly { startAt: string; endAt: string }[];
  intlLocale: string;
  uk: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(GAP_PAGE_SIZE);
  const visible = gaps.slice(0, visibleCount);
  return (
    <div className={styles.gapList}>
      {visible.length === 0 ? <p className={styles.muted}>{uk ? "Проміжків немає" : "No gaps"}</p> : (
        <ol>
          {visible.map((gap, index) => <li key={`${gap.startAt}:${gap.endAt}:${index}`}>
            <span className={styles.gapIndex}>#{index + 1}</span>
            <Interval value={gap} intlLocale={intlLocale} uk={uk} />
          </li>)}
        </ol>
      )}
      {visibleCount < gaps.length && (
        <button className={styles.secondaryButton} type="button" onClick={() => setVisibleCount((count) => Math.min(count + GAP_PAGE_SIZE, gaps.length))}>
          {uk ? `Показати ще ${Math.min(GAP_PAGE_SIZE, gaps.length - visibleCount)} · ${gaps.length - visibleCount} залишилося` : `Show ${Math.min(GAP_PAGE_SIZE, gaps.length - visibleCount)} more · ${gaps.length - visibleCount} remaining`}
        </button>
      )}
      <p className={styles.muted}>{uk ? `Проміжків: ${gaps.length}` : `Gaps: ${gaps.length}`}</p>
    </div>
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
  const hr = diagnostic?.heartRate;
  const topology = hr?.samplingTopology;

  return (
    <main className={styles.page}>
      <div className={styles.navRow}><strong>BodyCast</strong><AppNav active="training" /></div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Тренування · фактичні джерела" : "Workout · observed sources"}</p>
          <h1>{uk ? "Діагностика степера" : "Stepper diagnostics"}</h1>
          <p className={styles.intro}>{uk ? "Факти тренування, знімки кроків, енергія пристрою та структура зразків пульсу." : "Workout facts, step snapshots, device energy, and heart-rate sampling."}</p>
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
              <Field label={uk ? "Workout ID" : "Workout ID"}>{diagnostic.workout.workoutId}</Field>
              <Field label={uk ? "Канонічний тип" : "Canonical workout type"}><CodeMeaning value={diagnostic.workout.canonicalWorkoutType ?? "null"} uk={uk && diagnostic.workout.canonicalWorkoutType === "Stair Climbing" ? "Підйом сходами / степер" : undefined} /></Field>
              <Field label={uk ? "Початок" : "Start"}><Instant value={diagnostic.workout.startAt} intlLocale={intlLocale} /></Field>
              <Field label={uk ? "Завершення" : "End"}><Instant value={diagnostic.workout.endAt} intlLocale={intlLocale} /></Field>
              <Field label={uk ? "Тривалість · хв" : "Duration · min"}>{diagnostic.workout.durationMinutes === null ? "—" : <NumberValue value={diagnostic.workout.durationMinutes} intlLocale={intlLocale} />}</Field>
            </dl>
          </Section>

          <Section title={uk ? "Кроки навколо тренування" : "Steps around the workout"} subtitle={uk ? "Лічильник Apple Health між знімками або покриття інтервалами" : "Apple Health counter snapshots or interval coverage"}>
            <div className={styles.statusRow}>
              <span className={steps?.availability === "available" ? styles.badgeSuccess : styles.badgeWarning}>
                {steps?.availability === "available" ? (uk ? "Доступно" : "Available") : (uk ? "Недоступно" : "Unavailable")}
              </span>
              {steps?.availability === "unavailable" && <CodeMeaning value={steps.availabilityReason} uk={displayReason(steps.availabilityReason, uk)} />}
            </div>
            <div className={styles.snapshotGrid}>
              <Snapshot value={steps?.before ?? null} name={uk ? "До тренування" : "Before workout"} intlLocale={intlLocale} uk={uk} />
              <Snapshot value={steps?.after ?? null} name={uk ? "Після тренування" : "After workout"} intlLocale={intlLocale} uk={uk} />
            </div>
            <dl className={styles.fieldGrid}>
              <Field label={uk ? "Проміжок перед стартом · с" : "Gap before start · s"}>{steps?.preGapSeconds === null || steps?.preGapSeconds === undefined ? "—" : <NumberValue value={steps.preGapSeconds} intlLocale={intlLocale} />}</Field>
              <Field label={uk ? "Проміжок після завершення · с" : "Gap after end · s"}>{steps?.postGapSeconds === null || steps?.postGapSeconds === undefined ? "—" : <NumberValue value={steps.postGapSeconds} intlLocale={intlLocale} />}</Field>
              <Field label={uk ? "Похідна зміна кроків" : "Derived step delta"}>{steps?.derivedStepDelta === null || steps?.derivedStepDelta === undefined ? "—" : <><NumberValue value={steps.derivedStepDelta.value} intlLocale={intlLocale} /><CodeMeaning value={steps.derivedStepDelta.provenance} uk={diagnostic.labels.derivedStepDelta === "derived Apple Health interval attribution" ? (uk ? "Розподіл за інтервалами Apple Health" : "Apple Health interval allocation") : (uk ? "Різниця між знімками Health" : "Health snapshot difference")} /></>}</Field>
              <Field label={uk ? "Похідний темп · кроків/хв" : "Derived rate · steps/min"}>{steps?.derivedStepRatePerMinute === null || steps?.derivedStepRatePerMinute === undefined ? "—" : <><NumberValue value={steps.derivedStepRatePerMinute.value} intlLocale={intlLocale} /><CodeMeaning value={steps.derivedStepRatePerMinute.provenance} /></>}</Field>
            </dl>
          </Section>

          <Section title={uk ? "Енергія пристрою" : "Device energy"} subtitle={uk ? "Значення пристрою — оцінка, не вимірювання калориметром" : "A device estimate, not calorimetry"}>
            <dl className={styles.fieldGrid}>
              <Field label={uk ? "Доступність" : "Availability"}><CodeMeaning value={diagnostic.deviceEnergy.availability} uk={diagnostic.deviceEnergy.availability === "available" ? (uk ? "Доступно" : "Available") : (uk ? "Недоступно" : "Unavailable")} /></Field>
              {diagnostic.deviceEnergy.availability === "available" ? <>
                <Field label={uk ? "Значення · ккал" : "Value · kcal"}><NumberValue value={diagnostic.deviceEnergy.valueKcal} intlLocale={intlLocale} /></Field>
                <Field label={uk ? "Статус джерела" : "Source value status"}><CodeMeaning value={diagnostic.deviceEnergy.sourceValueStatus} uk={uk ? "Спостережене значення" : "Observed value"} /></Field>
                <Field label={uk ? "Семантика" : "Semantics"}><CodeMeaning value={diagnostic.deviceEnergy.semantics} uk={diagnostic.deviceEnergy.semantics === "active" ? (uk ? "Активна енергія" : "Active energy") : (uk ? "Загальна енергія" : "Gross energy")} /></Field>
                <Field label={uk ? "Походження" : "Provenance"}><CodeMeaning value={diagnostic.deviceEnergy.provenance} uk={uk ? "Оцінка пристрою" : "Device estimate"} /></Field>
              </> : <Field label={uk ? "Причина" : "Reason"}><CodeMeaning value={diagnostic.deviceEnergy.availabilityReason} uk={displayReason(diagnostic.deviceEnergy.availabilityReason, uk)} /></Field>}
              <Field label={uk ? "Мітка діагностики" : "Diagnostic label"}><CodeMeaning value={diagnostic.labels.garminActiveEnergy} uk={uk ? "Оцінка пристрою" : "Device estimate"} /></Field>
            </dl>
          </Section>

          <Section title={uk ? "Пульс" : "Heart rate"} subtitle={uk ? "Статистика описує лише наявні зразки; це не середній пульс за часом" : "Statistics describe observed samples only; this is not a time-weighted mean"}>
            <div className={styles.statusRow}><span className={hr?.availability === "loaded" ? styles.badgeInfo : styles.badgeMuted}>{hr?.availability === "loaded" ? (uk ? "Завантажено" : "Loaded") : (uk ? "Недоступно" : "Unavailable")}</span></div>
            <dl className={styles.fieldGrid}>
              <Field label={uk ? "Статус" : "Status"}><CodeMeaning value={hr?.availability ?? "null"} /></Field>
              <Field label={uk ? "Середнє спостережених зразків · bpm" : "Observed sample mean · bpm"}>{hr?.summary === null || hr?.summary === undefined ? "—" : <NumberValue value={hr.summary.sampleMeanBpm} intlLocale={intlLocale} />}</Field>
              <Field label={uk ? "Максимум серед зразків · bpm" : "Maximum observed · bpm"}>{hr?.summary === null || hr?.summary === undefined ? "—" : <NumberValue value={hr.summary.maxObservedBpm} intlLocale={intlLocale} />}</Field>
              <Field label={uk ? "Основа підсумку" : "Summary basis"}>{hr?.summary === null || hr?.summary === undefined ? "—" : <CodeMeaning value={hr.summary.basis} uk={uk ? "Лише спостережені зразки" : "Observed samples only"} />}</Field>
            </dl>
            {topology === null || topology === undefined ? (
              <p className={styles.muted}>{uk ? "Топологія зразків недоступна." : "Sampling topology is unavailable."}</p>
            ) : (
              <div className={styles.topology}>
                <div className={styles.topologyRow}><strong>{uk ? "Охоплений зразками проміжок" : "Sampled span"}</strong><Interval value={topology.sampledSpan} intlLocale={intlLocale} uk={uk} /></div>
                <div className={styles.topologyRow}><strong>{uk ? "Проміжок перед першим зразком" : "Leading gap"}</strong><Interval value={topology.leadingGap} intlLocale={intlLocale} uk={uk} /></div>
                <div className={styles.topologyRow}><strong>{uk ? "Проміжок після останнього зразка" : "Trailing gap"}</strong><Interval value={topology.trailingGap} intlLocale={intlLocale} uk={uk} /></div>
                <details className={styles.details}>
                  <summary>{uk ? `Проміжки між зразками · ${topology.interSampleGaps.length}` : `Inter-sample gaps · ${topology.interSampleGaps.length}`}</summary>
                  <GapList gaps={topology.interSampleGaps} intlLocale={intlLocale} uk={uk} />
                </details>
              </div>
            )}
          </Section>

          <Section title={uk ? "Обладнання" : "Equipment assignment"} subtitle={uk ? "Історичне призначення на момент початку тренування" : "Equipment assignment applicable at workout start"}>
            {diagnostic.equipmentAssignment === null ? <p className={styles.muted}>{uk ? "Призначення степера на цей час відсутнє." : "No stepper assignment was active at this time."}</p> : (
              <dl className={styles.fieldGrid}>
                <Field label="ID">{diagnostic.equipmentAssignment.id}</Field>
                <Field label={uk ? "Родина обладнання" : "Machine family"}><CodeMeaning value={diagnostic.equipmentAssignment.machineFamily} uk="DOMYOS MS100" /></Field>
                <Field label={uk ? "Конфігурація" : "Configuration"}><CodeMeaning value={diagnostic.equipmentAssignment.configuration} uk={uk ? "Фіксована" : "Fixed"} /></Field>
                <Field label={uk ? "Початок дії" : "Effective from"}><Instant value={diagnostic.equipmentAssignment.effectiveFrom} intlLocale={intlLocale} /></Field>
                <Field label={uk ? "Завершення дії · виключно" : "Effective to · exclusive"}>{diagnostic.equipmentAssignment.effectiveTo === null ? "—" : <Instant value={diagnostic.equipmentAssignment.effectiveTo} intlLocale={intlLocale} />}</Field>
                <Field label={uk ? "Створено" : "Created"}><Instant value={diagnostic.equipmentAssignment.createdAt} intlLocale={intlLocale} /></Field>
              </dl>
            )}
          </Section>
        </div>
      )}
    </main>
  );
}
