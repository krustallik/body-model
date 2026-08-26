"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import type { DiagnosticGate, DiagnosticLevel, DiagnosticsDto } from "@/modules/model-diagnostics/model-diagnostics.types";
import styles from "./diagnostics.module.css";

const number = (value: number | null, digits = 0) => value === null ? "—" : value.toFixed(digits);

function levelLabel(level: DiagnosticLevel, uk: boolean) {
  return ({ good: uk ? "Готово" : "Ready", limited: uk ? "З обмеженнями" : "Limited", blocked: uk ? "Потрібна увага" : "Needs attention", informational: uk ? "Довідково" : "Information" })[level];
}

function gateLabel(gate: DiagnosticGate, uk: boolean) {
  const labels = uk ? {
    "offset-observations": "Спостереження ваги для зсуву", "offset-span": "Тривалість для зсуву",
    "full-observations": "Спостереження для двох параметрів", "full-span": "Тривалість для двох параметрів",
    "activity-standard-deviation": "Розкид активності (SD)", "activity-coefficient-of-variation": "Відносний розкид активності (CV)",
  } : {
    "offset-observations": "Weight observations for offset", "offset-span": "Span for offset",
    "full-observations": "Observations for two parameters", "full-span": "Span for two parameters",
    "activity-standard-deviation": "Activity spread (SD)", "activity-coefficient-of-variation": "Relative activity spread (CV)",
  };
  return labels[gate.id];
}

function personalizationCopy(status: DiagnosticsDto["personalization"]["status"], uk: boolean) {
  const copy = uk ? {
    "insufficient-history": ["Ще замало історії", "Модель працює з консервативними типовими параметрами."],
    "invalid-history": ["Історія не придатна", "Один або більше днів не вдалося коректно змоделювати."],
    "offset-only": ["Особистий зсув активний", "Загальний енергетичний зсув прийнято; масштаб активності лишився типовим."],
    "fully-calibrated": ["Два параметри активні", "Особистий зсув і масштаб активності пройшли перевірку."],
    "defaults-retained": ["Типові параметри збережено", "Даних досить для спроби, але персоналізація не покращила незалежну перевірку."],
  } : {
    "insufficient-history": ["More history needed", "The model is running with conservative default parameters."],
    "invalid-history": ["History is not usable", "One or more days could not be simulated safely."],
    "offset-only": ["Personal offset active", "The overall energy offset was accepted; activity scaling remains at its default."],
    "fully-calibrated": ["Two parameters active", "Personal offset and activity scaling passed validation."],
    "defaults-retained": ["Defaults retained", "There was enough evidence to try, but personalization did not improve held-out validation."],
  };
  return copy[status];
}

function limitationCopy(id: DiagnosticsDto["limitations"][number]["id"], uk: boolean) {
  const values = uk ? {
    "latent-state-not-scale-reading": "Поточна вага — прихована фізіологічна оцінка, а не передбачення наступного показу вагів.",
    "future-behavior-conditional": "Прогноз умовний: він залежить від обраного або повторюваного режиму.",
    "measurement-noise-not-modeled": "Діапазони прогнозу не включають шум майбутніх вимірювань ваги.",
    "parameter-uncertainty-not-modeled": "Діапазони ще не включають невизначеність параметрів і всі структурні помилки моделі.",
    "hold-ecf": "Позаклітинна рідина під час моделювання утримується сталою; натрій та інші швидкі зміни рідини не моделюються.",
    "long-horizon-numerical-quality": "Якість 365-денного прогнозу оцінюється під час конкретного запуску й може бути обмеженою.",
  } : {
    "latent-state-not-scale-reading": "Current weight is a latent physiological estimate, not a prediction of the next scale reading.",
    "future-behavior-conditional": "Forecasts are conditional on the selected or repeated routine.",
    "measurement-noise-not-modeled": "Forecast intervals do not include future scale-measurement noise.",
    "parameter-uncertainty-not-modeled": "Intervals do not yet include parameter uncertainty or every structural model error.",
    "hold-ecf": "Extracellular fluid is held constant; sodium and other fast fluid shifts are not modeled.",
    "long-horizon-numerical-quality": "A 365-day forecast is assessed per run and may carry limited numerical quality.",
  };
  return values[id];
}

export function DiagnosticsClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const [data, setData] = useState<DiagnosticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/diagnostics", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? (uk ? "Немає активної моделі." : "No active model.") : (uk ? "Не вдалося завантажити діагностику." : "Could not load diagnostics."));
        return response.json() as Promise<DiagnosticsDto>;
      })
      .then(setData).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [uk]);

  const personalization = data ? personalizationCopy(data.personalization.status, uk) : null;
  return <main className={styles.page}>
    <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Прозорість моделі" : "Model transparency"}</span></Link><AppNav active="diagnostics" /></div>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>{uk ? "Діагностика · не оцінка здоров’я" : "Diagnostics · not a health score"}</p><h1>{uk ? "Що модель знає — і чого не знає." : "What the model knows—and what it does not."}</h1><p>{uk ? "Надійність має кілька вимірів. Тут немає універсального бала: дані, персоналізація, відновлення і прогноз оцінюються окремо." : "Reliability has several dimensions. There is no universal score: data, personalization, recovery, and forecasting are assessed separately."}</p></div>
    </header>
    {!data && !error && <section className={styles.loading} aria-live="polite">{uk ? "Завантажуємо стан моделі…" : "Loading model status…"}</section>}
    {error && <section className={styles.error} role="alert"><strong>{uk ? "Діагностика недоступна" : "Diagnostics unavailable"}</strong><span>{error}</span><Link href="/dashboard">{uk ? "Перейти до огляду" : "Go to dashboard"}</Link></section>}
    {data && <>
      <section className={styles.overview} aria-label={uk ? "Огляд стану моделі" : "Model status overview"}>
        <article data-level={data.currentState.level}><div className={styles.cardTop}><span>{uk ? "Поточний стан" : "Current state"}</span><b>{levelLabel(data.currentState.level, uk)}</b></div><strong>{data.currentState.status === "available" ? (uk ? "Стан доступний" : "State available") : (uk ? "Стан очікує відновлення" : "State awaits recovery")}</strong><p>{uk ? "Джерело" : "Source"}: {data.currentState.source ?? "—"}</p></article>
        <article data-level={data.dataContinuity.level}><div className={styles.cardTop}><span>{uk ? "Дані · до 28 днів" : "Data · up to 28 days"}</span><b>{levelLabel(data.dataContinuity.level, uk)}</b></div><strong>{data.dataContinuity.completeDayCount}/{data.dataContinuity.modeledDayCount} {uk ? "повних днів" : "complete days"}</strong><p>{uk ? "Вага" : "Weight"}: {data.dataContinuity.weightObservationCount} · {uk ? "непокрито харчування" : "unresolved nutrition"}: {data.dataContinuity.nutrition.unresolvedDayCount}</p></article>
        <article data-level={data.personalization.level}><div className={styles.cardTop}><span>{uk ? "Персоналізація" : "Personalization"}</span><b>{levelLabel(data.personalization.level, uk)}</b></div><strong>{personalization?.[0]}</strong><p>{personalization?.[1]}</p></article>
        <article data-level={data.forecastReadiness.level}><div className={styles.cardTop}><span>{uk ? "Прогноз" : "Forecast"}</span><b>{levelLabel(data.forecastReadiness.level, uk)}</b></div><strong>{data.forecastReadiness.allowed ? (uk ? "Можна будувати" : "Ready to run") : (uk ? "Поки заблоковано" : "Currently blocked")}</strong><p>{data.forecastReadiness.initialStateSource ? `${uk ? "Початковий стан" : "Initial state"}: ${data.forecastReadiness.initialStateSource}` : data.forecastReadiness.reasons.join(", ")}</p></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Поточна оцінка" : "Current estimate"}</p><h2>{uk ? "Фізіологічний стан" : "Physiological state"}</h2><dl className={styles.metrics}><div><dt>{uk ? "Модельна вага" : "Modeled weight"}</dt><dd>{number(data.currentState.predictedWeightKg, 1)} kg</dd></div><div><dt>{uk ? "Жирова маса" : "Fat mass"}</dt><dd>{number(data.currentState.fatMassKg, 1)} kg</dd></div><div><dt>{uk ? "Безжирова тканина" : "Lean tissue"}</dt><dd>{number(data.currentState.leanTissueKg, 1)} kg</dd></div><div><dt>TDEE</dt><dd>{number(data.currentState.modeledTdeeKcalPerDay)} kcal</dd></div></dl><p className={styles.note}>{limitationCopy("latent-state-not-scale-reading", uk)}</p></article>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Походження даних" : "Data provenance"}</p><h2>{uk ? "Безперервність" : "Continuity"}</h2><div className={styles.provenance}><span><i data-kind="observed" />{uk ? "Спостережено" : "Observed"}<b>{data.dataContinuity.nutrition.observedDayCount}</b></span><span><i data-kind="imputed" />{uk ? "Відновлено локально" : "Locally imputed"}<b>{data.dataContinuity.nutrition.imputedDayCount}</b></span><span><i data-kind="missing" />{uk ? "Не визначено" : "Unresolved"}<b>{data.dataContinuity.nutrition.unresolvedDayCount}</b></span></div><p className={styles.note}>{uk ? "День без робочого інтервалу означає 0 робочої активності, а не пропущені дані." : "A day without a work interval means zero occupational work, not missing data."}</p></article>
      </section>

      <section className={styles.panel}><div className={styles.sectionHead}><div><p className={styles.eyebrow}>{uk ? "Прийняті параметри" : "Accepted parameters"}</p><h2>{uk ? "Межі персоналізації" : "Personalization gates"}</h2></div><span className={styles.statusPill} data-level={data.personalization.level}>{personalization?.[0]}</span></div><p>{personalization?.[1]}</p><div className={styles.gates}>{data.personalization.gates.map((gate) => <div key={gate.id} data-met={gate.met}><span>{gateLabel(gate, uk)}</span><strong>{number(gate.current, gate.unit === "coefficient-of-variation" ? 2 : 0)} / {gate.required}{gate.unit === "kcal/day-sd" ? " kcal/day SD" : gate.unit === "days" ? ` ${uk ? "днів" : "days"}` : ""}</strong><small>{gate.met ? (uk ? "поріг пройдено" : "threshold met") : (uk ? "ще не пройдено" : "not met yet")}</small></div>)}</div><p className={styles.note}>{uk ? "Ці пороги — консервативні інженерні запобіжники, не біологічні норми. Навіть після проходження порогів параметри приймаються лише за умови покращення відкладеної перевірки." : "These thresholds are conservative engineering safeguards, not biological norms. Parameters are accepted only when held-out validation also improves."}</p></section>

      <section className={styles.grid}>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Пропуски в історії" : "Historical gaps"}</p><h2>{uk ? "Відновлення траєкторії" : "Trajectory recovery"}</h2><p className={styles.largeStatus}>{data.recovery.status}</p><p>{data.recovery.status === "not-required" ? (uk ? "Невідомих переходів немає; використовується детермінований стан." : "There are no unknown transitions; the deterministic state is used.") : data.recovery.usableForForecast ? (uk ? "Відновлений стан можна використати з відповідною позначкою якості." : "The recovered state is usable with its quality label.") : (uk ? "Прогноз не запускається, доки початковий стан ненадійний." : "Forecasting stays blocked while the initial state is unreliable.")}</p></article>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Наступна дія" : "Next action"}</p><h2>{data.forecastReadiness.allowed ? (uk ? "Дослідити сценарій" : "Explore a scenario") : (uk ? "Поліпшити вихідний стан" : "Improve the starting state")}</h2><p>{data.forecastReadiness.allowed ? (uk ? "Прогноз доступний, але його діапазони залишаються умовними." : "Forecasting is available, but its intervals remain conditional.") : (uk ? "Перевірте пропуски даних або дочекайтеся нових спостережень ваги." : "Review data gaps or wait for new weight observations.")}</p><div className={styles.actions}><Link href="/forecast">{uk ? "Відкрити прогноз" : "Open forecast"}</Link><Link href="/history">{uk ? "Перевірити історію" : "Review history"}</Link></div></article>
      </section>

      <section className={styles.panel}><p className={styles.eyebrow}>{uk ? "Межі інтерпретації" : "Interpretation limits"}</p><h2>{uk ? "Що не слід висновувати" : "What not to infer"}</h2><ul className={styles.limitations}>{data.limitations.map((item) => <li key={item.id}>{limitationCopy(item.id, uk)}</li>)}</ul></section>
      <details className={styles.technical}><summary>{uk ? "Технічні деталі" : "Technical details"}</summary><dl><div><dt>{uk ? "Версія моделі" : "Model version"}</dt><dd>{data.episode.modelVersion}</dd></div><div><dt>{uk ? "Оновлено" : "Updated"}</dt><dd>{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: data.episode.timezone }).format(new Date(data.episode.updatedAt))}</dd></div><div><dt>{uk ? "Статус калібрування" : "Calibration status"}</dt><dd>{data.personalization.status}</dd></div><div><dt>{uk ? "Особистий зсув" : "Personal offset"}</dt><dd>{number(data.personalization.personalOffsetKcalPerDay)} kcal/day</dd></div><div><dt>{uk ? "Масштаб активності" : "Activity scale"}</dt><dd>{number(data.personalization.activityCalibration, 3)}</dd></div><div><dt>Recovery ESS</dt><dd>{number(data.recovery.normalizedEffectiveSampleSize, 3)}</dd></div><div><dt>{uk ? "Макс. вага частинки" : "Maximum particle weight"}</dt><dd>{number(data.recovery.maximumWeight, 3)}</dd></div><div><dt>{uk ? "Алгоритм відновлення" : "Recovery algorithm"}</dt><dd>{data.recovery.algorithmVersion ?? "—"}</dd></div></dl></details>
    </>}
  </main>;
}
