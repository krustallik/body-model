"use client";

import { fetchCurrentModelRead, modelReadIsPending, ModelRefreshPendingError } from "@/lib/model-refresh-read";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { HelpTip } from "@/components/help-tip";
import { ModelStateSource } from "@/components/model-state-source";
import { useI18n } from "@/i18n/i18n-provider";
import type { DiagnosticGate, DiagnosticLevel, DiagnosticsDto } from "@/modules/model-diagnostics/model-diagnostics.types";
import {
  initializationFailureMessage,
  diagnosticsRecalculateTitle,
  modelNeedsRecalculation,
  noActiveModelPresentation,
  recalculateCompletionMessage,
  recalculateModelPresentation,
  type RecalculationPublicationStatus,
} from "@/modules/model-forecast/forecast-ui";
import styles from "./diagnostics.module.css";

const EMPTY_DIAGNOSTICS: DiagnosticsDto = {
  episode: {
    id: 0,
    modelVersion: "not-created",
    timezone: "Europe/Bratislava",
    startDate: "1970-01-01",
    latestModeledDate: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  currentState: {
    level: "blocked",
    status: "unavailable",
    source: null,
    predictedWeightKg: null,
    filteredWeightKg: null,
    fatMassKg: null,
    leanTissueKg: null,
    glycogenAndExtracellularFluidMassKg: null,
    dynamicRmrKcalPerDay: null,
    modeledTdeeKcalPerDay: null,
  },
  experimentalEnergySummary: null,
  energyHistory: { latestModeledDay: null, previousCompletedDays: [] },
  dataContinuity: {
    level: "blocked",
    recentWindowDays: 28,
    windowStartDate: null,
    windowEndDate: null,
    modeledDayCount: 0,
    completeDayCount: 0,
    incompleteDayCount: 0,
    nutrition: { observedDayCount: 0, imputedDayCount: 0, unresolvedDayCount: 0 },
    weightObservationCount: 0,
    unknownIntervalCount: 0,
    unresolvedDayCount: 0,
    noWorkIntervalSemantics: "zero-occupational-work-not-missing",
  },
  personalization: {
    level: "limited",
    status: "insufficient-history",
    accepted: false,
    activeParameters: [],
    personalOffsetKcalPerDay: 0,
    activityCalibration: 1,
    initialization: {
      estimatedCorrectionKcalPerDay: 0,
      confidence: "not-initialized",
      appliedCorrectionKcalPerDay: 0,
      applied: false,
      explanation: "The production model has not been initialized yet.",
    },
    evidence: {
      completeDayCount: null,
      observationCount: null,
      observationSpanDays: null,
      activityStandardDeviationKcalPerDay: null,
      activityCoefficientOfVariation: null,
    },
    gates: [
      { id: "offset-observations", current: null, required: 20, unit: "observations", met: false },
      { id: "offset-span", current: null, required: 28, unit: "days", met: false },
      { id: "full-observations", current: null, required: 35, unit: "observations", met: false },
      { id: "full-span", current: null, required: 56, unit: "days", met: false },
      { id: "activity-standard-deviation", current: null, required: 75, unit: "kcal/day-sd", met: false },
      { id: "activity-coefficient-of-variation", current: null, required: 0.2, unit: "coefficient-of-variation", met: false },
    ],
    nextGate: null,
    warnings: [],
  },
  recovery: {
    level: "blocked",
    status: "awaiting-observations",
    usableForForecast: false,
    observationCount: null,
    validParticleFraction: null,
    normalizedEffectiveSampleSize: null,
    maximumWeight: null,
    algorithmVersion: null,
    qualityReasons: [],
    supportWarnings: [],
    gaps: [],
  },
  forecastReadiness: {
    level: "blocked",
    allowed: false,
    initialStateSource: null,
    reasons: ["current-state-unavailable"],
  },
  limitations: [
    { id: "latent-state-not-scale-reading", scope: "current-state" },
    { id: "future-behavior-conditional", scope: "forecast" },
    { id: "measurement-noise-not-modeled", scope: "forecast" },
    { id: "parameter-uncertainty-not-modeled", scope: "model" },
    { id: "hold-ecf", scope: "current-state" },
    { id: "long-horizon-numerical-quality", scope: "forecast" },
  ],
};

type DiagnosticsRequestError = Error & { code?: string };

const number = (value: number | null, digits = 0) => value === null ? "—" : value.toFixed(digits);

function levelLabel(level: DiagnosticLevel, uk: boolean) {
  return ({ good: uk ? "Готово" : "Ready", limited: uk ? "З обмеженнями" : "Limited", blocked: uk ? "Потрібна увага" : "Needs attention", informational: uk ? "Довідково" : "Information" })[level];
}

function gateLabel(gate: DiagnosticGate, uk: boolean) {
  const labels = uk ? {
    "offset-observations": "Скільки зважувань для простого підлаштування", "offset-span": "Скільки днів історії для простого підлаштування",
    "full-observations": "Скільки зважувань для повного підлаштування", "full-span": "Скільки днів історії для повного підлаштування",
    "activity-standard-deviation": "Наскільки різний рух день у день", "activity-coefficient-of-variation": "Наскільки відносний розкид руху",
  } : {
    "offset-observations": "Weigh-ins for simple tuning", "offset-span": "History span for simple tuning",
    "full-observations": "Weigh-ins for full tuning", "full-span": "History span for full tuning",
    "activity-standard-deviation": "How varied movement is day to day", "activity-coefficient-of-variation": "Relative movement spread",
  };
  return labels[gate.id];
}

function gateHelp(gate: DiagnosticGate, uk: boolean) {
  if (gate.id === "offset-span" || gate.id === "full-span") return uk
    ? "Це календарний проміжок між придатними зважуваннями для калібрування, а не кількість повних модельних днів. Покриття рахує змодельовані дні у своєму вікні; калібруванню потрібні окремі спостереження ваги."
    : "This is the calendar span between usable weigh-ins for calibration, not the number of complete modeled days. Coverage counts modeled days in its own window; calibration needs separate weight observations.";
  if (gate.id === "activity-standard-deviation") return uk
    ? "Показує, наскільки відрізнялися витрати на рух у різні дні. Щоб модель могла відокремити вплив активності від інших причин зміни ваги, потрібно щонайменше 75 ккал/день стандартного відхилення. «—» означає, що показник ще неможливо надійно порахувати."
    : "Shows how much movement expenditure differed between days. At least 75 kcal/day of standard deviation is needed to separate activity from other weight changes. A dash means it cannot yet be estimated reliably.";
  if (gate.id === "activity-coefficient-of-variation") return uk
    ? "Це розкид руху відносно вашого середнього рівня активності. Поріг 0,2 означає, що денна активність має змінюватися приблизно на 20% від середнього. «—» означає, що для розрахунку ще замало придатних днів."
    : "This is movement variation relative to your average activity. A 0.2 threshold means daily activity should vary by roughly 20% of the average. A dash means there are not enough usable days yet.";
  return null;
}

function formatDiagnosticDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function modeledDayStatusLabel(status: "complete" | "incomplete" | null, uk: boolean) {
  if (status === "complete") return uk ? "розрахунок повний" : "calculation complete";
  if (status === "incomplete") return uk ? "розрахунок неповний" : "calculation incomplete";
  return uk ? "статус недоступний" : "status unavailable";
}

function recoveryStatusLabel(status: DiagnosticsDto["recovery"]["status"], uk: boolean) {
  const labels = uk ? {
    "not-required": "Критичних пропусків немає", recovered: "Стан після пропуску відновлено", degraded: "Стан відновлено наближено",
    "awaiting-observations": "Потрібні нові спостереження", degenerate: "Надійно відновити не вдалося", stale: "Оцінку потрібно оновити",
  } : {
    "not-required": "No critical gaps", recovered: "State recovered after the gap", degraded: "State recovered roughly",
    "awaiting-observations": "More observations needed", degenerate: "Reliable recovery failed", stale: "Estimate needs an update",
  };
  return labels[status];
}

function personalizationCopy(status: DiagnosticsDto["personalization"]["status"], uk: boolean) {
  const copy = uk ? {
    "insufficient-history": ["Ще замало історії", "Модель поки працює з типовими налаштуваннями, не сильно під вас."],
    "invalid-history": ["Історію важко порахувати", "Один або кілька днів не вдалося безпечно порахувати."],
    "offset-only": ["Просте підлаштування увімкнено", "Загальний зсув калорій прийнято; рух лишився типовим."],
    "fully-calibrated": ["Повне підлаштування увімкнено", "І загальний зсув, і масштаб руху пройшли перевірку."],
    "defaults-retained": ["Залишили типові налаштування", "Даних вистачило спробувати, але підлаштування не покращило перевірку."],
  } : {
    "insufficient-history": ["More history needed", "The model is still using typical settings, not finely tuned to you."],
    "invalid-history": ["History is hard to calculate", "One or more days could not be calculated safely."],
    "offset-only": ["Simple tuning is on", "An overall calorie offset was accepted; movement scaling stays typical."],
    "fully-calibrated": ["Full tuning is on", "Both the overall offset and movement scaling passed checks."],
    "defaults-retained": ["Typical settings kept", "There was enough data to try, but tuning did not improve the check."],
  };
  return copy[status];
}

function currentStateTitle(status: DiagnosticsDto["currentState"]["status"], uk: boolean) {
  if (status === "available") return uk ? "Поточна оцінка є" : "Current estimate is ready";
  if (status === "awaiting-recovery") return uk ? "Чекаємо, поки закриється пропуск" : "Waiting for a data gap to close";
  return uk ? "Поточної оцінки ще немає" : "No current estimate yet";
}

function forecastReasonLabel(reason: string, uk: boolean) {
  const labels: Record<string, string> = uk ? {
    "current-state-unavailable": "Немає поточної оцінки ваги моделі",
    "degraded-recovery": "Оцінка після пропуску даних слабка",
  } : {
    "current-state-unavailable": "No current model weight estimate",
    "degraded-recovery": "Estimate after a data gap is weak",
  };
  if (reason.startsWith("recovery-")) {
    return uk ? "Спочатку потрібно закрити пропуск у даних" : "A data gap must be closed first";
  }
  return labels[reason] ?? reason;
}

function limitationCopy(id: DiagnosticsDto["limitations"][number]["id"], uk: boolean) {
  const values = uk ? {
    "latent-state-not-scale-reading": "Поточна вага — внутрішня оцінка моделі, а не «що покажуть ваги завтра вранці».",
    "future-behavior-conditional": "Прогноз залежить від того, який режим ви обрали далі.",
    "measurement-noise-not-modeled": "Діапазон прогнозу не включає звичайну похибку вагів.",
    "parameter-uncertainty-not-modeled": "Діапазон ще не включає всі можливі помилки налаштувань моделі.",
    "hold-ecf": "Швидкі зміни рідини в тілі (наприклад від солі) модель зараз не рахує.",
    "long-horizon-numerical-quality": "Прогноз на рік перевіряється окремо й може бути грубішим.",
  } : {
    "latent-state-not-scale-reading": "Current weight is the model’s internal estimate, not “what the scale will show tomorrow morning.”",
    "future-behavior-conditional": "The forecast depends on the routine you choose next.",
    "measurement-noise-not-modeled": "Forecast ranges do not include ordinary scale noise.",
    "parameter-uncertainty-not-modeled": "Ranges do not yet include every possible model-setting error.",
    "hold-ecf": "Fast body-fluid shifts (for example from salt) are not calculated right now.",
    "long-horizon-numerical-quality": "A one-year forecast is checked per run and may be rougher.",
  };
  return values[id];
}

export function DiagnosticsClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const recalculateCopy = recalculateModelPresentation(locale);
  const noActiveCopy = noActiveModelPresentation(locale);
  const [data, setData] = useState<DiagnosticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noActiveModel, setNoActiveModel] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [actionComplete, setActionComplete] = useState<RecalculationPublicationStatus | null>(null);
  const actionRef = useRef(false);
  const actionControllerRef = useRef<AbortController | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [refreshPending, setRefreshPending] = useState(false);

  const loadDiagnostics = useCallback(async (signal?: AbortSignal) => {
    const response = await fetchCurrentModelRead("/api/diagnostics", {
      signal, onPending: () => setRefreshPending(true),
    });
    if (!response.ok) {
      const failure = new Error(response.status === 404
        ? (uk ? "Немає активної моделі." : "No active model.")
        : (uk ? "Не вдалося завантажити діагностику." : "Could not load diagnostics."));
      if (response.status === 404) failure.name = "NoActiveModelDiagnosticsError";
      throw failure;
    }
    return response.json() as Promise<DiagnosticsDto>;
  }, [uk]);

  useEffect(() => {
    const controller = new AbortController();
    loadDiagnostics(controller.signal)
      .then((next) => { if (!controller.signal.aborted) { setData(next); setError(null); setRefreshPending(false); } })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const failure = cause as DiagnosticsRequestError;
        if (failure.name === "NoActiveModelDiagnosticsError") {
          setData(EMPTY_DIAGNOSTICS);
          setNoActiveModel(true);
        }
        setError(cause instanceof ModelRefreshPendingError
          ? (uk ? "Розрахунок ще триває. Можна повторити перевірку." : "The calculation is still updating. You can check again.")
          : cause instanceof Error ? cause.message : String(cause));
      });
    return () => { controller.abort(); actionControllerRef.current?.abort(); };
  }, [loadDiagnostics, readAttempt, uk]);

  async function runModelAction(action: "initialize" | "recalculate") {
    if (actionRef.current) return;
    actionRef.current = true;
    const controller = new AbortController();
    actionControllerRef.current = controller;
    setRecalculating(true);
    setError(null);
    setActionComplete(null);
    try {
      const response = await fetch("/api/forecast/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { reason?: string; message?: string };
        if (modelReadIsPending(body)) {
          setRefreshPending(true);
          const next = await loadDiagnostics(controller.signal);
          if (controller.signal.aborted) return;
          setData(next);
          setRefreshPending(false);
          setNoActiveModel(false);
          return;
        }
        throw new Error(action === "initialize"
          ? initializationFailureMessage(body.reason ?? body.message, locale)
          : (uk ? "Не вдалося перерахувати модель." : "Could not recalculate the model."));
      }
      const result = await response.json().catch(() => null) as { modelPublicationStatus?: unknown } | null;
      const publicationStatus: RecalculationPublicationStatus = result?.modelPublicationStatus === "current"
        ? "current"
        : result?.modelPublicationStatus === "stale" ? "stale" : "unknown";
      const next = await loadDiagnostics(controller.signal);
      if (controller.signal.aborted) return;
      setData(next);
      setRefreshPending(false);
      setNoActiveModel(false);
      setActionComplete(publicationStatus);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      const failure = cause as DiagnosticsRequestError;
      if (failure.name === "NoActiveModelDiagnosticsError") {
        setData(EMPTY_DIAGNOSTICS);
        setNoActiveModel(true);
      }
      setError(cause instanceof ModelRefreshPendingError
        ? (uk ? "Розрахунок ще триває. Можна повторити перевірку." : "The calculation is still updating. You can check again.")
        : cause instanceof Error ? cause.message : String(cause));
    } finally {
      actionRef.current = false;
      setRecalculating(false);
    }
  }

  function runRecalculate() {
    return runModelAction(noActiveModel ? "initialize" : "recalculate");
  }

  const personalization = data ? personalizationCopy(data.personalization.status, uk) : null;
  const needsRecalculation = data
    ? modelNeedsRecalculation({
      daysModeled: data.dataContinuity.modeledDayCount,
      latestModeledDate: data.episode.latestModeledDate,
      currentPredictedWeightKg: data.currentState.predictedWeightKg,
    })
    : false;
  const actionLabel = noActiveModel ? noActiveCopy.primaryAction : recalculateCopy.action;
  const actionLoadingLabel = noActiveModel ? noActiveCopy.loadingAction : recalculateCopy.loadingAction;

  return <main className={styles.page}>
    <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Прозорість моделі" : "Model transparency"}</span></Link><AppNav active="diagnostics" /></div>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>{uk ? "Діагностика · не оцінка здоров’я" : "Diagnostics · not a health score"}</p><h1>{uk ? "Що модель знає — і чого не знає." : "What the model knows—and what it does not."}</h1><p>{uk ? "Тут кілька окремих перевірок: дані, підлаштування під вас, пропуски й прогноз. Одного спільного бала немає." : "There are several separate checks: data, tuning to you, gaps, and forecast. There is no single overall score."}</p></div>
    </header>
    {!data && !error && <section className={styles.loading} aria-live="polite">{refreshPending ? (uk ? "Модель оновлюється. Перевіряємо готовність…" : "Model updating. Checking readiness…") : (uk ? "Завантажуємо стан моделі…" : "Loading model status…")}</section>}
    {error && <section className={styles.error} role="status"><strong>{refreshPending ? (uk ? "Модель оновлюється" : "Model updating") : noActiveModel ? (uk ? "Модель ще не створена" : "Model not created yet") : (uk ? "Діагностика недоступна" : "Diagnostics unavailable")}</strong><span>{error}</span><div className={styles.actions}>
      {!noActiveModel && <button type="button" disabled={recalculating} onClick={() => { setError(null); setReadAttempt((value) => value + 1); }}>{uk ? "Повторити перевірку" : "Check again"}</button>}
      <button type="button" disabled={recalculating} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? actionLoadingLabel : actionLabel}</button><Link href="/dashboard">{uk ? "Перейти до огляду" : "Go to dashboard"}</Link><Link href="/history">{uk ? "Додати дані" : "Add data"}</Link></div></section>}
    {data && <>
      {refreshPending && !error && <p role="status" aria-live="polite">{uk ? "Модель оновлюється. Перевіряємо готовність…" : "Model updating. Checking readiness…"}</p>}
      <section className={styles.recalculateBanner} aria-label={actionLabel}>
        <div><strong>{diagnosticsRecalculateTitle({ noActiveModel, needsRecalculation, daysModeled: data.dataContinuity.modeledDayCount }, locale)}<HelpTip>{uk ? "Кнопка бере записи з таблиці «Історія», заново рахує фізіологічну модель, зберігає результат і за потреби сама оцінює стан після пропуску для Діагностики, Прогнозу та Цілі. Самі записи здоров’я вона не змінює." : "This reads Health History, recalculates the physiology model, saves results, and when needed estimates state after a data gap for Diagnostics, Forecast, and Goal. It does not edit health records."}</HelpTip></strong><span>{noActiveModel ? noActiveCopy.detail : recalculateCopy.hint}</span>{error && noActiveModel && <span>{error}</span>}</div>
        <button type="button" className={needsRecalculation || noActiveModel ? styles.recalculatePrimary : styles.recalculateSecondary} disabled={recalculating || refreshPending} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? actionLoadingLabel : actionLabel}</button>
      </section>
      {recalculating ? (
        <section className={styles.actionProgress} role="status" aria-live="polite" aria-busy="true">
          <span className={styles.actionProgressMarker} aria-hidden="true" />
          <div><strong>{uk ? "Перераховуємо модель" : "Recalculating the model"}</strong><span>{uk ? "Запит ще виконується. Не запускайте його повторно." : "The request is still running. There is no need to submit it again."}</span></div>
        </section>
      ) : actionComplete ? (
        <p className={styles.actionComplete} role="status" aria-live="polite">{recalculateCompletionMessage(actionComplete, locale)}</p>
      ) : null}

      <section className={styles.overview} aria-label={uk ? "Огляд стану моделі" : "Model status overview"}>
        <article data-kind="state" data-level={data.currentState.level}>
          <div className={styles.cardTop}><span>{uk ? "Поточна оцінка" : "Current estimate"}<HelpTip>{uk ? "Внутрішня оцінка складу тіла після останнього порахованого дня. Вона може не збігатися з ранковим показом вагів через воду, їжу та шум вимірювання." : "The internal body-state estimate after the latest calculated day. It can differ from a morning weigh-in because of water, food, and measurement noise."}</HelpTip></span><b>{levelLabel(data.currentState.level, uk)}</b></div>
          <strong>{currentStateTitle(data.currentState.status, uk)}</strong>
          <p>{uk ? "Тип стартової оцінки" : "Starting estimate type"}: {data.currentState.source ? <ModelStateSource value={data.currentState.source} uk={uk} /> : "—"}</p>
          <a className={styles.modelViewAction} href="#model-estimate-details">{uk ? "Переглянути модель" : "View model"}</a>
        </article>
        <article data-kind="coverage" data-level={data.dataContinuity.level}>
          <div className={styles.cardTop}><span>{uk ? "Покриття даних · 28 днів" : "Data coverage · 28 days"}<HelpTip>{uk ? "Повні дні — це дні, які модель змогла повністю порахувати. Кількість не дорівнює кількості записів у таблиці здоров’я." : "Complete days are days the model could fully calculate. This count is not the number of entries in Health History."}</HelpTip></span><b>{levelLabel(data.dataContinuity.level, uk)}</b></div>
          <strong>{data.episode.id === 0 ? (uk ? "Історію ще не пораховано" : "History not calculated yet") : `${data.dataContinuity.completeDayCount}/${data.dataContinuity.modeledDayCount} ${uk ? "повних днів" : "complete days"}`}</strong>
          <p>{data.episode.id === 0 ? (uk ? "Записи здоров’я ще не стали модельними днями." : "Health records have not become modeled days yet.") : `${uk ? "Зважувань" : "Weigh-ins"}: ${data.dataContinuity.weightObservationCount} · ${uk ? "Неповних днів" : "Incomplete days"}: ${data.dataContinuity.incompleteDayCount}`}</p>
        </article>
        <article data-kind="personalization" data-level={data.personalization.level}>
          <div className={styles.cardTop}><span>{uk ? "Персоналізація" : "Personalization"}<HelpTip>{uk ? "Модель порівнює прогнозовану й записану вагу. За достатньої тривалості та різноманітності історії вона може обережно скоригувати енергобаланс і реакцію на активність." : "The model compares predicted and logged weight. With enough long and varied history, it can cautiously tune energy balance and activity response."}</HelpTip></span><b>{levelLabel(data.personalization.level, uk)}</b></div>
          <strong>{personalization?.[0]}</strong><p>{personalization?.[1]}</p>
        </article>
        <article data-kind="readiness" data-level={data.forecastReadiness.level}>
          <div className={styles.cardTop}><span>{uk ? "Готовність прогнозу" : "Forecast readiness"}</span><b>{levelLabel(data.forecastReadiness.level, uk)}</b></div>
          <strong>{data.forecastReadiness.allowed ? (uk ? "Можна будувати" : "Ready to run") : (uk ? "Поки заблоковано" : "Currently blocked")}</strong>
          <p>{data.forecastReadiness.initialStateSource ? <>{uk ? "Тип стартової оцінки" : "Starting estimate type"}: <ModelStateSource value={data.forecastReadiness.initialStateSource} uk={uk} /></> : data.forecastReadiness.reasons.map((reason) => forecastReasonLabel(reason, uk)).join(", ")}</p>
        </article>
      </section>

      <section className={styles.modelWorkspace} aria-label={uk ? "Стан і походження оцінки" : "State and estimate sources"}>
        <article id="model-estimate-details" tabIndex={-1} className={`${styles.panel} ${styles.modelPanel} ${styles.modelEstimateAnchor}`} data-kind="state">
          <p className={styles.eyebrow}>{uk ? "Оцінка моделі" : "Model estimate"}<HelpTip>{uk ? "Це розрахований внутрішній стан на кінець останнього обробленого дня, а не показ вагів. Вага моделі складається з окремо показаних компартментів." : "This is the calculated internal state at the end of the latest processed day, not a scale reading. Model weight is composed of the compartments shown below."}</HelpTip></p>
          <h2>{uk ? "Що модель оцінює зараз" : "What the model estimates now"}</h2>
          <div className={styles.currentWeight}><span>{uk ? "Розрахункова вага" : "Estimated weight"}</span><strong>{number(data.currentState.predictedWeightKg, 1)} kg</strong><small>{uk ? "Стан на останній змодельований день" : "State at latest modeled day"} · {modeledDayStatusLabel(data.energyHistory.latestModeledDay?.status ?? null, uk)}</small></div>
          <dl className={styles.metrics}>
            <div><dt>{uk ? "Жир" : "Fat mass"}</dt><dd>{number(data.currentState.fatMassKg, 1)} kg</dd></div>
            <div><dt>{uk ? "Нежирова тканина (без глікогену й ECF)" : "Lean tissue (excl. glycogen & ECF)"}<HelpTip>{uk ? "Компартмент leanTissueKg моделі Hall/Forbes — це не скелетний м’яз і не вся маса без жиру. Глікоген з водою та позаклітинна рідина показані окремо." : "Hall/Forbes leanTissueKg is not skeletal muscle and not all non-fat mass. Glycogen with water and extracellular fluid are shown separately."}</HelpTip></dt><dd>{number(data.currentState.leanTissueKg, 1)} kg</dd></div>
            <div><dt>{uk ? "Глікоген, вода й ECF" : "Glycogen, water & ECF"}<HelpTip>{uk ? "Залишок, що замикає рівняння ваги: розрахункова вага − жир − нежирова тканина." : "The residual that closes the weight equation: estimated weight − fat − lean tissue."}</HelpTip></dt><dd>{number(data.currentState.glycogenAndExtracellularFluidMassKg, 1)} kg</dd></div>
          </dl>
          <p className={styles.note}>{uk ? "Ранкове зважування може відрізнятися через воду, їжу в травній системі та звичайну похибку вагів." : "A morning weigh-in can differ because of water, food in the digestive system, and ordinary scale noise."}</p>
          {(data.experimentalEnergySummary || data.energyHistory.latestModeledDay || data.energyHistory.previousCompletedDays.length > 0) && <div className={styles.energySummary} aria-label={uk ? "Додаткові оцінки енерговитрат" : "Additional energy estimates"}>
            <p className={styles.subheading}>{uk ? "Енерговитрати" : "Energy use"}</p>
            <dl className={styles.energyMetrics}>
              <div><dt>{uk ? "Енерговитрати останнього змодельованого дня" : "Expenditure on latest modeled day"}<HelpTip>{uk ? "Оцінка моделі для конкретного останнього дня в історії. Це не вимір сьогоднішніх витрат." : "The model estimate for the exact latest day in history. It is not a measurement of today's expenditure."}</HelpTip></dt><dd>{data.energyHistory.latestModeledDay?.expenditureKcalPerDay === null || !data.energyHistory.latestModeledDay ? (uk ? "немає оцінки" : "estimate unavailable") : `${number(data.energyHistory.latestModeledDay.expenditureKcalPerDay)} kcal`}</dd><small>{data.energyHistory.latestModeledDay?.date ? formatDiagnosticDate(data.energyHistory.latestModeledDay.date, intlLocale) : "—"}</small></div>
              {data.experimentalEnergySummary && <>
                <div><dt>{uk ? "Типова підтримка · середнє за 28 днів" : "Typical maintenance · 28-day average"}<HelpTip>{uk ? "Середнє арифметичне доступних модельних оцінок добових енерговитрат у ковзному календарному вікні на 28 днів, що закінчується останнім днем з оцінкою. Потрібно щонайменше 14 придатних модельних днів; відсутні дні не вважаються нулем. Це довгостроковий орієнтир моделі, а не точний припис калорій. Значення останнього дня може відрізнятися: це оцінка одного дня, тоді як середнє враховує придатні дні у вікні." : "The arithmetic mean of available modeled daily expenditure estimates in a rolling 28-calendar-day window ending on the latest day with an estimate. At least 14 eligible modeled days are required; missing days are not treated as zero. This is a long-term model reference, not an exact calorie prescription. The latest-day estimate can differ: it describes one day, while the average includes eligible days in the window."}</HelpTip></dt><dd>{number(data.experimentalEnergySummary.recentTypicalMaintenanceKcalPerDay)} kcal</dd><small>{data.experimentalEnergySummary.typicalMaintenanceEligibleDays}/28 {uk ? "придатних модельних днів" : "eligible modeled days"}</small></div>
                <div><dt>{uk ? "Енерговитрати у спокої · RMR" : "Resting expenditure · RMR"}<HelpTip>{uk ? "Окремий компонент витрат у спокої; не включає повні добові витрати на рух і перетравлення їжі." : "The resting component only; it does not include total daily movement and digestion expenditure."}</HelpTip></dt><dd>{number(data.experimentalEnergySummary.restingRmrKcalPerDay)} kcal</dd></div>
              </>}
            </dl>
            <section className={styles.energyHistory} aria-label={uk ? "Оцінки енерговитрат за сім календарних днів перед останнім модельним днем" : "Expenditure estimates for the seven calendar days before the latest modeled day"}>
              <h3>{uk ? "Сім календарних днів перед останнім змодельованим днем" : "Seven calendar days before the latest modeled day"}</h3>
              {data.energyHistory.previousCompletedDays.length > 0 ? <ul>{data.energyHistory.previousCompletedDays.map((day) => <li key={day.date}><time dateTime={day.date}>{formatDiagnosticDate(day.date, intlLocale)}</time><span>{uk ? "оцінка моделі" : "model estimate"}</span><strong>{day.expenditureKcalPerDay === null ? (uk ? "немає актуальної оцінки" : "no current estimate") : `${number(day.expenditureKcalPerDay)} kcal`}</strong></li>)}</ul> : <p>{uk ? "Актуальної енерговитрати за попередні дні немає." : "No current expenditure estimates are available for previous days."}</p>}
              <p className={styles.note}>{uk ? "Показано саме сім дат безпосередньо перед останнім модельним днем. Неповні, відсутні або застарілі оцінки позначені як недоступні, а не як 0 kcal." : "These are the seven dates immediately before the latest modeled day; incomplete, missing, or stale estimates are marked unavailable, never as 0 kcal."}</p>
            </section>
          </div>}
        </article>
        <article className={`${styles.panel} ${styles.coveragePanel}`} data-kind="coverage" data-level={data.dataContinuity.level}>
          <div className={styles.sectionHead}><div><p className={styles.eyebrow}>{uk ? "Походження даних" : "Data provenance"}</p><h2>{uk ? "Харчування за 28 днів" : "Nutrition over 28 days"}</h2></div><span className={styles.statusPill} data-level={data.dataContinuity.level}>{levelLabel(data.dataContinuity.level, uk)}</span></div>
          <p className={styles.coverageSummary}>{data.episode.id === 0 ? (uk ? "Історію ще не пораховано" : "History not calculated yet") : `${data.dataContinuity.completeDayCount}/${data.dataContinuity.modeledDayCount} ${uk ? "повних порахованих днів" : "complete calculated days"}`}</p>
          <p className={styles.note}>{uk ? "Рахуються модельні дні, а не рядки в таблиці здоров’я." : "These are modeled days, not entries in Health History."}</p>
          <div className={styles.provenance} aria-label={uk ? "Походження даних про калорії" : "Nutrition data provenance"}>
            <span><i data-kind="observed" />{uk ? "Записано вами" : "Logged by you"}<b>{data.episode.id === 0 ? "—" : data.dataContinuity.nutrition.observedDayCount}</b></span>
            <span><i data-kind="imputed" />{uk ? "Заповнено із сусідніх днів" : "Filled from nearby days"}<b>{data.episode.id === 0 ? "—" : data.dataContinuity.nutrition.imputedDayCount}</b></span>
            <span><i data-kind="missing" />{uk ? "Без даних про калорії" : "Missing calories"}<b>{data.episode.id === 0 ? "—" : data.dataContinuity.nutrition.unresolvedDayCount}</b></span>
          </div>
          <dl className={styles.coverageFacts}>
            <div><dt>{uk ? "Неповні модельні дні" : "Incomplete modeled days"}</dt><dd>{data.episode.id === 0 ? "—" : data.dataContinuity.incompleteDayCount}</dd></div>
            <div><dt>{uk ? "Зважування у вікні" : "Weigh-ins in window"}</dt><dd>{data.episode.id === 0 ? "—" : data.dataContinuity.weightObservationCount}</dd></div>
            <div><dt>{uk ? "Невідомі інтервали" : "Unknown intervals"}</dt><dd>{data.episode.id === 0 ? "—" : data.dataContinuity.unknownIntervalCount}</dd></div>
            <div><dt>{uk ? "Дні, що потребують уточнення" : "Days needing clarification"}</dt><dd>{data.episode.id === 0 ? "—" : data.dataContinuity.unresolvedDayCount}</dd></div>
          </dl>
          <p className={styles.note}>{data.episode.id === 0 ? (uk ? "Після першого розрахунку тут з’явиться розподіл записів." : "The record breakdown will appear here after the first calculation.") : (uk ? "Якщо робочий інтервал не записаний, модель вважає, що додаткової активності на роботі не було. Інші записи цього дня не вважаються втраченими." : "If no work interval is logged, the model assumes no additional occupational activity. Other records for that day are not treated as missing.")}</p>
        </article>
      </section>

      <section className={`${styles.panel} ${styles.personalizationPanel}`} data-kind="personalization" data-level={data.personalization.level} aria-labelledby="diagnostics-personalization-heading">
        <div className={styles.sectionHead}><div><p className={styles.eyebrow}>{uk ? "Перевірка налаштувань" : "Calibration checks"}</p><h2 id="diagnostics-personalization-heading">{uk ? "Коли модель підлаштовується під вас" : "When the model tunes to you"}</h2></div><span className={styles.statusPill} data-level={data.personalization.level}>{personalization?.[0]}</span></div>
        <p>{personalization?.[1]}</p>
        <div className={styles.gates}>{data.personalization.gates.map((gate) => { const help = gateHelp(gate, uk); return <div key={gate.id} data-met={gate.met}><span>{gateLabel(gate, uk)}{help && <HelpTip>{help}</HelpTip>}</span><strong>{number(gate.current, gate.unit === "coefficient-of-variation" ? 2 : 0)} / {gate.required}{gate.unit === "kcal/day-sd" ? (uk ? " ккал/день" : " kcal/day SD") : gate.unit === "days" ? ` ${uk ? "днів" : "days"}` : ""}</strong><small>{gate.met ? (uk ? "достатньо" : "enough") : (uk ? "ще мало" : "not enough yet")}</small></div>; })}</div>
        <p className={styles.note}>{uk ? "Повні модельні дні рахують завершені денні стани у вікні покриття. Проміжок для підлаштування рахують за календарним часом між придатними зважуваннями. Це різні показники й різні знаменники; показані пороги — технічні, не медичні норми." : "Complete modeled days count finished daily states in the coverage window. The tuning span counts calendar time between usable weigh-ins. These are different measures with different denominators; the displayed thresholds are technical, not medical norms."}</p>
      </section>

      <section className={styles.readinessGrid} aria-label={uk ? "Пропуски та наступна дія" : "History gaps and next step"}>
        <article className={`${styles.panel} ${styles.recoveryPanel}`} data-level={data.recovery.level}>
          <p className={styles.eyebrow}>{uk ? "Безперервність розрахунку" : "Calculation continuity"}</p>
          <h2>{uk ? "Як пропуски вплинули на оцінку" : "How gaps affected the estimate"}<HelpTip>{uk ? "Критичний пропуск — це ділянка, де бракує даних, потрібних для послідовного розрахунку стану тіла. Тут показані точні дати та наслідок для поточної оцінки." : "A critical gap is a period missing data required for a sequential body-state calculation. This card shows the exact dates and the effect on the current estimate."}</HelpTip></h2>
          <p className={styles.largeStatus}>{recoveryStatusLabel(data.recovery.status, uk)}</p>
          {data.recovery.gaps.length > 0 ? <ul className={styles.gapList}>{data.recovery.gaps.map((gap) => <li key={`${gap.startDate}-${gap.endDate}`}><strong>{formatDiagnosticDate(gap.startDate, intlLocale)}{gap.endDate && gap.endDate !== gap.startDate ? ` — ${formatDiagnosticDate(gap.endDate, intlLocale)}` : ""}</strong><span>{gap.durationDays} {uk ? "дн." : "days"}</span></li>)}</ul> : <p>{data.episode.id === 0 ? (uk ? "Модель ще не має порахованої історії." : "The model has not calculated any history yet.") : (uk ? "У порахованій історії немає ділянок, які розривають розрахунок." : "There are no periods in the calculated history that break the calculation.")}</p>}
          <p>{data.currentState.source ? <>{uk ? "Тип поточної оцінки" : "Current estimate type"}: <ModelStateSource value={data.currentState.source} uk={uk} />.</> : (uk ? "Надійної поточної оцінки поки немає, тому прогноз заблоковано." : "There is no reliable current estimate yet, so forecasting is blocked.")}</p>
        </article>
        <article className={`${styles.panel} ${styles.readinessPanel}`} data-level={data.forecastReadiness.level}>
          <p className={styles.eyebrow}>{uk ? "Готовність прогнозу" : "Forecast readiness"}</p>
          <div className={styles.readinessTitle}><h2>{data.forecastReadiness.allowed ? (uk ? "Можна перевірити сценарій" : "You can explore a scenario") : (uk ? "Спершу потрібен надійний старт" : "A reliable starting point is needed first")}</h2><span className={styles.statusPill} data-level={data.forecastReadiness.level}>{levelLabel(data.forecastReadiness.level, uk)}</span></div>
          <p>{data.forecastReadiness.allowed ? (uk ? "Прогноз доступний, але його діапазон описує сценарій, а не гарантію." : "Forecasting is available, but its range describes a scenario, not a guarantee.") : noActiveModel ? noActiveCopy.detail : (uk ? "Перевірте пропуски або дочекайтеся нових зважувань. Якщо історія вже має нові дні — перерахуйте модель." : "Review the gaps or wait for new weigh-ins. If newer days are already in history, recalculate the model.")}</p>
          {!data.forecastReadiness.allowed && data.forecastReadiness.reasons.length > 0 && <ul className={styles.reasonList}>{data.forecastReadiness.reasons.map((reason) => <li key={reason}>{forecastReasonLabel(reason, uk)}</li>)}</ul>}
          <div className={styles.actions}><button type="button" disabled={recalculating || refreshPending} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? actionLoadingLabel : actionLabel}</button><Link href="/forecast">{uk ? "Відкрити прогноз" : "Open forecast"}</Link><Link href="/history">{uk ? "Перевірити історію" : "Review history"}</Link></div>
        </article>
      </section>

      <section className={`${styles.panel} ${styles.limitationsPanel}`} data-kind="limitations">
        <p className={styles.eyebrow}>{uk ? "Межі інтерпретації" : "Interpretation limits"}</p>
        <h2>{uk ? "Що не варто висновувати" : "What not to infer"}</h2>
        <ul className={styles.limitations}>{data.limitations.map((item) => <li key={item.id} data-scope={item.scope}><span>{item.scope === "current-state" ? (uk ? "Поточна оцінка" : "Current estimate") : item.scope === "forecast" ? (uk ? "Прогноз" : "Forecast") : (uk ? "Модель" : "Model")}</span>{limitationCopy(item.id, uk)}</li>)}</ul>
      </section>
      <p className={styles.technicalIntro}>{uk ? "Службова інформація про розрахунок: версія алгоритму, час оновлення та показники якості. Вона потрібна переважно для перевірки й пошуку помилок; для щоденного користування її можна не відкривати." : "Calculation metadata: algorithm version, update time, and quality metrics. It is mainly for verification and troubleshooting and can stay closed in everyday use."}</p>
      <details className={styles.technical}><summary onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const details = event.currentTarget.parentElement as HTMLDetailsElement | null;
        if (details) details.open = !details.open;
      }}>{uk ? "Технічні деталі" : "Technical details"}</summary><dl><div><dt>{uk ? "Версія моделі" : "Model version"}</dt><dd>{data.episode.id === 0 ? "—" : data.episode.modelVersion}</dd></div><div><dt>{uk ? "Оновлено" : "Updated"}</dt><dd>{data.episode.id === 0 ? "—" : new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: data.episode.timezone }).format(new Date(data.episode.updatedAt))}</dd></div><div><dt>{uk ? "Статус калібрування" : "Calibration status"}</dt><dd>{data.personalization.status}</dd></div><div><dt>{uk ? "Оцінена корекція енергобалансу" : "Estimated energy-balance correction"}</dt><dd>{number(data.personalization.initialization.estimatedCorrectionKcalPerDay)} kcal/day</dd></div><div><dt>{uk ? "Впевненість initialization" : "Initialization confidence"}</dt><dd>{data.personalization.initialization.confidence}</dd></div><div><dt>{uk ? "Застосована корекція" : "Applied correction"}</dt><dd>{number(data.personalization.initialization.appliedCorrectionKcalPerDay)} kcal/day · {data.personalization.initialization.applied ? (uk ? "застосовано" : "applied") : (uk ? "не застосовано" : "not applied")}</dd></div><div><dt>{uk ? "Пояснення" : "Explanation"}</dt><dd>{data.episode.id === 0 ? (uk ? "Модель ще не створена." : "The model has not been created yet.") : uk && !data.personalization.initialization.applied ? "Оцінку збережено для аудиту, але не застосовано без сильніших незалежних доказів." : data.personalization.initialization.explanation}</dd></div><div><dt>{uk ? "Масштаб активності" : "Activity scale"}</dt><dd>{number(data.personalization.activityCalibration, 3)}</dd></div><div><dt>Recovery ESS</dt><dd>{number(data.recovery.normalizedEffectiveSampleSize, 3)}</dd></div><div><dt>{uk ? "Макс. вага частинки" : "Maximum particle weight"}</dt><dd>{number(data.recovery.maximumWeight, 3)}</dd></div><div><dt>{uk ? "Алгоритм відновлення" : "Recovery algorithm"}</dt><dd>{data.recovery.algorithmVersion ?? "—"}</dd></div></dl></details>
    </>}
  </main>;
}
