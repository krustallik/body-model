"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import type { StepperWorkoutDiagnosticV7 } from "@/modules/profile/stepper-workout-diagnostic";
import type { StepperHrDecisionReasonV1 } from "@/model/activity/stepper-hr-aware-active-energy-v1";
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

function hrDecisionText(reason: StepperHrDecisionReasonV1 | null, uk: boolean): string {
  if (reason === null) return uk ? "Індивідуальну калібровку застосовано." : "Individual calibration was applied.";
  const copy: Record<StepperHrDecisionReasonV1, [string, string]> = {
    "no-personal-ms100-calibration": ["Пульс не змінив ккал: немає незалежно перевіреної персональної калібровки HR–VO₂ для MS100.", "HR did not change kcal: no independently validated personal MS100 HR–VO₂ calibration is registered."],
    "hr-unavailable": ["Пульс за інтервал тренування недоступний.", "Heart-rate samples for the workout interval are unavailable."],
    "hr-no-interval-samples": ["У межах тренування немає зразків пульсу.", "There are no heart-rate samples inside the workout interval."],
    "hr-samples-invalid": ["У зразках пульсу є некоректні значення або неповне часове покриття.", "The HR series contains invalid values or does not cover the workout interval."],
    "hr-sample-times-ambiguous": ["Часові мітки пульсу неоднозначні, тому інтегрувати ряд неможливо.", "Heart-rate timestamps are ambiguous, so the series cannot be integrated."],
    "hr-source-does-not-match-calibration": ["Джерело пульсу відрізняється від джерела персональної калібровки.", "The HR source does not match the source used for personal calibration."],
    "calibration-not-valid-for-workout-date": ["Тренування поза датами чинності калібровки.", "The workout falls outside the calibration's effective dates."],
    "calibration-not-holdout-validated": ["Калібровка не пройшла незалежну перевірку на окремих тренуваннях.", "The calibration has not passed independent holdout validation."],
    "calibration-invalid": ["Калібровка має некоректні або неповні параметри.", "The calibration has invalid or incomplete parameters."],
    "missing-body-mass": ["Немає маси тіла для розрахунку.", "Body mass is unavailable for the calculation."],
    "missing-step-rate": ["Немає надійної частоти кроків для перевірки діапазону калібровки.", "No usable step rate is available to check the calibration domain."],
    "outside-calibrated-step-rate-range": ["Частота кроків поза перевіреним для калібровки діапазоном.", "Step rate is outside the validated calibration range."],
    "outside-calibrated-duration-range": ["Тривалість тренування поза перевіреним діапазоном калібровки.", "Workout duration is outside the validated calibration range."],
    "outside-calibrated-heart-rate-range": ["Є значення пульсу поза перевіреним діапазоном калібровки.", "An HR value is outside the validated calibration range."],
    "hr-edge-gap-exceeds-calibrated-limit": ["На початку або в кінці тренування є надто довга прогалина в пульсі.", "The HR series has an edge gap longer than the validated limit."],
    "hr-gap-exceeds-calibrated-limit": ["Між зразками пульсу є прогалина довша за перевірений ліміт.", "An inter-sample HR gap exceeds the validated limit."],
    "missing-mechanical-and-device-energy": ["Немає ні механічної оцінки BodyCast, ні енергії пристрою.", "Neither a BodyCast mechanical estimate nor device energy is available."],
  };
  return copy[reason][uk ? 0 : 1];
}

function selectedEnergyText(source: StepperWorkoutDiagnosticV7["activeEnergyResolution"]["selected"]["source"], uk: boolean): string {
  if (source === "hr-calibrated-ms100") return uk ? "Персональну оцінку HR застосовано" : "Personal HR estimate applied";
  if (source === "mechanical-ms100") return uk ? "Механічну оцінку BodyCast використано" : "BodyCast mechanical estimate used";
  if (source === "device-active-energy-fallback") return uk ? "Немає оцінки BodyCast · fallback пристрою" : "BodyCast estimate unavailable · device fallback";
  return uk ? "Оцінка енергії недоступна" : "Energy estimate unavailable";
}

function selectedEnergyNote(source: StepperWorkoutDiagnosticV7["activeEnergyResolution"]["selected"]["source"], uk: boolean): string {
  if (source === "hr-calibrated-ms100") return uk
    ? "Використано часово зважений HR–VO₂ розрахунок із персональної MS100 калібровки; він замінює механічну оцінку, Garmin до нього не додається."
    : "A time-weighted HR–VO₂ calculation from personal MS100 calibration replaced the mechanical estimate; Garmin kcal are not added.";
  if (source === "mechanical-ms100") return uk
    ? "У TDEE передано механічну оцінку за кроками, масою тіла та припущеннями MS100. Пульс не коригує її без незалежно перевіреної персональної калібровки; Garmin показано окремо."
    : "TDEE uses the mechanical estimate from steps, body mass, and MS100 assumptions. HR does not adjust it without independently validated personal calibration; Garmin is shown separately.";
  if (source === "device-active-energy-fallback") return uk
    ? "BodyCast не зміг оцінити енергію за кроками й масою тіла, тому production використав активні ккал пристрою як fallback."
    : "BodyCast could not estimate energy from steps and body mass, so production used device active kcal as a fallback.";
  return uk ? "Немає даних для оцінки BodyCast або енергії пристрою." : "Neither a BodyCast estimate nor device energy is available.";
}

function hrQualityText(quality: StepperWorkoutDiagnosticV7["activeEnergyResolution"]["heartRate"]["quality"], uk: boolean): string {
  const copy = {
    unavailable: ["Недоступний", "Unavailable"],
    "context-only": ["Контекст · без калібровки", "Context only · uncalibrated"],
    "data-rejected": ["Часовий ряд непридатний", "Series is invalid"],
    "calibration-accepted": ["Калібровку застосовано", "Calibration applied"],
    "calibration-rejected": ["Поза доменом калібровки", "Outside calibration domain"],
  } as const;
  return copy[quality][uk ? 0 : 1];
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

function CalorieValue({ value, intlLocale }: { value: number; intlLocale: string }) {
  return <span>{new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 }).format(value)}</span>;
}

function Field({ label, children, featured }: { label: string; children: ReactNode; featured?: boolean }) {
  return <div className={featured ? `${styles.field} ${styles.fieldFeatured}` : styles.field}><dt>{label}</dt><dd>{children}</dd></div>;
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

          <Section title={uk ? "Активна енергія" : "Active energy"} subtitle={uk ? "HR оцінка застосовується лише з персональною калібровкою MS100; Garmin наведений окремо" : "HR affects the estimate only with personal MS100 calibration; Garmin is shown separately"}>
            <div className={styles.statusRow}>
              <span className={diagnostic.activeEnergyResolution.selected.source === "hr-calibrated-ms100" ? styles.badgeSuccess : diagnostic.activeEnergyResolution.selected.source === "none" ? styles.badgeMuted : styles.badgeWarning}>
                {selectedEnergyText(diagnostic.activeEnergyResolution.selected.source, uk)}
              </span>
            </div>
            <dl className={styles.fieldGrid}>
              <Field featured label={uk ? "Використано в розрахунку · активні ккал" : "Used in model · active kcal"}>
                {diagnostic.activeEnergyResolution.selected.availability === "available"
                  ? <CalorieValue value={diagnostic.activeEnergyResolution.selected.valueKcal} intlLocale={intlLocale} />
                  : <span className={styles.muted}>{uk ? "Недоступно" : "Unavailable"}</span>}
              </Field>
              <Field label={uk ? "Механічна оцінка · активні ккал" : "Mechanical estimate · active kcal"}>
                {diagnostic.programEnergy.availability === "available" && diagnostic.programEnergy.estimatedActiveKcal !== null
                  ? <CalorieValue value={diagnostic.programEnergy.estimatedActiveKcal} intlLocale={intlLocale} />
                  : <span className={styles.muted}>{uk ? "Недоступно" : "Unavailable"}</span>}
              </Field>
              <Field label={uk ? "Межі механічної оцінки · ккал" : "Mechanical estimate range · kcal"}>
                {diagnostic.programEnergy.lowerBoundKcal !== null && diagnostic.programEnergy.upperBoundKcal !== null
                  ? <><CalorieValue value={diagnostic.programEnergy.lowerBoundKcal} intlLocale={intlLocale} />–<CalorieValue value={diagnostic.programEnergy.upperBoundKcal} intlLocale={intlLocale} /></>
                  : "—"}
              </Field>
              <Field label={uk ? "Оцінка HR після калібровки · ккал" : "Calibrated HR estimate · kcal"}>
                {diagnostic.activeEnergyResolution.hrAwareEstimate.availability === "available"
                  ? <CalorieValue value={diagnostic.activeEnergyResolution.hrAwareEstimate.activeKcal} intlLocale={intlLocale} />
                  : <span className={styles.muted}>{uk ? "Не застосовано" : "Not applied"}</span>}
              </Field>
              <Field label={uk ? "Вплив пульсу на результат" : "HR impact on selected kcal"}>
                {diagnostic.activeEnergyResolution.selected.source === "hr-calibrated-ms100"
                  && diagnostic.activeEnergyResolution.selected.impactVsMechanicalKcal !== null
                  ? <><NumberValue value={diagnostic.activeEnergyResolution.selected.impactVsMechanicalKcal} intlLocale={intlLocale} /> {uk ? "ккал проти механічної оцінки" : "kcal vs mechanical estimate"}</>
                  : <span className={styles.muted}>{uk ? "Не вплинув" : "No impact"}</span>}
              </Field>
              <Field label={uk ? "Охоплений HR-зразками інтервал · % тренування" : "Span between HR samples · % workout"}>
                {diagnostic.activeEnergyResolution.heartRate.sampledCoveragePercent === null
                  ? "—"
                  : `${new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(diagnostic.activeEnergyResolution.heartRate.sampledCoveragePercent)}%`}
              </Field>
              <Field label={uk ? "Кількість HR зразків" : "HR sample count"}>
                <NumberValue value={diagnostic.activeEnergyResolution.heartRate.sampleCount} intlLocale={intlLocale} />
              </Field>
              <Field label={uk ? "Якість для енергетичної оцінки" : "Quality for energy estimation"}>
                {hrQualityText(diagnostic.activeEnergyResolution.heartRate.quality, uk)}
              </Field>
              <Field label={uk ? "Оцінка пристрою · активні ккал" : "Device estimate · active kcal"}>
                {diagnostic.deviceEnergy.availability === "available"
                  ? <CalorieValue value={diagnostic.deviceEnergy.valueKcal} intlLocale={intlLocale} />
                  : <span className={styles.muted}>{uk ? "Недоступно" : "Unavailable"}</span>}
              </Field>
              <Field label={uk ? "Тип енергії пристрою" : "Device energy semantics"}>
                {diagnostic.deviceEnergy.availability === "available"
                  ? <CodeMeaning value={diagnostic.deviceEnergy.semantics} uk={diagnostic.deviceEnergy.semantics === "active" ? (uk ? "Активна енергія" : "Active energy") : (uk ? "Загальна енергія" : "Gross energy")} />
                  : "—"}
              </Field>
            </dl>
            <p className={styles.muted}>
              {selectedEnergyNote(diagnostic.activeEnergyResolution.selected.source, uk)} {diagnostic.activeEnergyResolution.selected.source === "hr-calibrated-ms100" ? "" : hrDecisionText(diagnostic.activeEnergyResolution.heartRate.decisionReason, uk)}
            </p>
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
