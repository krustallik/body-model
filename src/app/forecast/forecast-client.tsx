"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { HelpTip } from "@/components/help-tip";
import { useI18n, type Locale } from "@/i18n/i18n-provider";
import type { ModelStatusDto, UnknownIntervalDto } from "@/modules/model-episodes/model-episode.types";
import type { ForecastBlockedResult, ForecastResult } from "@/modules/model-forecast/forecast.types";
import { forecastChartLabels } from "@/modules/model-forecast/forecast-chart-data";
import {
  buildForecastRequest,
  beginForecastRequest,
  blockedPresentation,
  DEFAULT_PLAN,
  FORECAST_HORIZONS,
  formatDate,
  formatValue,
  forecastReadiness,
  initializationFailureMessage,
  modelNeedsRecalculation,
  qualityPresentation,
  isCurrentForecastRequest,
  withMinimumVisibleLoading,
  noActiveModelPresentation,
  planAssumptions,
  recalculateModelPresentation,
  summarizeEndpoint,
  type ForecastHorizon,
  type ForecastMetric,
  type PlanValues,
  type ScenarioMode,
} from "@/modules/model-forecast/forecast-ui";
import {
  forecastMetricSemanticsNotes,
  forecastWorkoutScenarioNotes,
  productionForecastCompartmentNotes,
  type ProvenanceChip,
} from "@/modules/provenance/provenance-presentation";
import { ForecastChart } from "./forecast-chart";
import styles from "./forecast.module.css";
import { isForecastBrowserSettings } from "@/modules/browser-settings/planning-settings";
import { FORECAST_SETTINGS_KEY, readBrowserSettings, resetBrowserSettings, writeBrowserSettings } from "@/modules/browser-settings/versioned-settings";

type HistoricalDay = {
  date: string;
  modeledWeightKg: number | null;
  filteredWeightKg?: number | null;
  fatMassKg: number | null;
  leanTissueKg: number | null;
  glycogenAssociatedMassKg: number | null;
  dataQuality: string;
  nutritionSource?: string | null;
  workoutFeedObserved?: boolean | null;
  missingFields?: string[];
};
type ContextProvenance = {
  v7Cache: ProvenanceChip;
  v7Compartments: ProvenanceChip[];
  latestDay: {
    date: string;
    dataQuality: ProvenanceChip | null;
    nutrition: ProvenanceChip | null;
    workoutFeed: ProvenanceChip | null;
  } | null;
};
type Context = {
  status: ModelStatusDto;
  history: HistoricalDay[];
  observedWeights?: Array<{ date: string; weightKg: number }>;
  unknownIntervals: UnknownIntervalDto[];
  provenance?: ContextProvenance;
};
type Outcome = ForecastResult | ForecastBlockedResult;
type SubmittedRun = { mode: ScenarioMode; horizon: ForecastHorizon; plan: PlanValues };
type ForecastAction = "recover" | "recalculate" | "initialize";

async function forecastError(response: Response, locale: Locale): Promise<{
  message: string;
  code: string | null;
  reason?: string;
  donorDayCount?: number;
}> {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = await response.json() as {
      error?: string;
      message?: string;
      reason?: string;
      details?: Array<{ message?: string }>;
    };
    const raw = body.message ?? body.details?.[0]?.message ?? body.error?.replaceAll("_", " ") ?? fallback;
    const received = /received\s+(\d+)/i.exec(raw)?.[1];
    if (body.error === "initialization_failed") {
      return {
        message: initializationFailureMessage(body.reason ?? body.message, locale),
        code: body.error,
        reason: body.reason,
      };
    }
    const messages: Record<string, string> = locale === "uk" ? {
      no_active_episode: "Активної моделі ще немає. Запустіть модель тут, якщо вага й калорії вже є в історії.",
      forecast_unavailable: body.reason === "missing-weight" ? "Додайте хоча б одне вимірювання ваги — тоді BodyCast зможе побудувати стартовий прогноз." : "Заповніть профіль, щоб BodyCast міг побудувати стартовий прогноз.",
      insufficient_scenario_evidence: "Історії мало, тому діапазон прогнозу буде ширшим. Оберіть план або додайте дані, щоб зробити його точнішим.",
      recovery_required: "Спочатку перерахуйте модель — вона сама оцінить стан після пропуску.",
    } : {
      no_active_episode: "There is no active model yet. Start the model here if weight and calories are already in your history.",
      forecast_unavailable: body.reason === "missing-weight" ? "Add at least one weight measurement so BodyCast can build a starter forecast." : "Complete your profile so BodyCast can build a starter forecast.",
      operation_in_progress: "A forecast is already being calculated. Try again in a moment.",
      recovery_required: "Recalculate the model first — it will estimate state after the data gap automatically.",
    };
    if (locale === "uk" && body.error === "operation_in_progress") {
      return { message: "Прогноз уже розраховується. Спробуйте ще раз за мить.", code: body.error };
    }
    return {
      message: (body.error && messages[body.error]) || raw,
      code: body.error ?? null,
      ...(received ? { donorDayCount: Number(received) } : {}),
    };
  } catch { return { message: fallback, code: null }; }
}

const MAX_OPERATION_RETRIES = 10;

function waitForOperationRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchForecastResponse(payload: unknown, signal: AbortSignal): Promise<Response> {
  for (let retries = 0; ; retries += 1) {
    const response = await fetch("/api/forecast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (response.status !== 429 || retries >= MAX_OPERATION_RETRIES) return response;
    const body = await response.clone().json().catch(() => null) as { error?: string } | null;
    if (body?.error !== "operation_in_progress") return response;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(5_000, Math.max(250, retryAfterSeconds * 1_000))
      : 1_000;
    await waitForOperationRetry(signal, delayMs);
  }
}

function NumberField({ label, value, onChange, min = 0, max, step = 1, unit, help }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string; help?: string;
}) {
  const inputId = useId();
  return <div className={styles.field}>
    <div className={styles.fieldLabel}>
      <label htmlFor={inputId}>{label}{unit ? ` (${unit})` : ""}</label>
      {help && <HelpTip>{help}</HelpTip>}
    </div>
    <input id={inputId} type="number" value={value} min={min} max={max} step={step} required onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
  </div>;
}

export function ForecastClient() {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const noActiveModelCopy = noActiveModelPresentation(locale);
  const recalculateCopy = recalculateModelPresentation(locale);
  const scenarios: Array<{ mode: ScenarioMode; label: string; hint: string }> = [
    { mode: "recent-behavior", label: uk ? "Як останнім часом" : "As lately", hint: uk ? "Бере ваші недавні дні з їжею й рухом і повторює схожий ритм." : "Uses your recent food-and-movement days and repeats a similar rhythm." },
    { mode: "fixed", label: uk ? "Точно за планом" : "Exact daily plan", hint: uk ? "Кожен день іде рівно за вашим планом, без відхилень." : "Every day follows your plan exactly, with no day-to-day drift." },
    { mode: "target-centered", label: uk ? "План з невеликими відхиленнями" : "Plan with small drift", hint: uk ? "В цілому за планом, але з реалістичними щоденними коливаннями." : "Mostly on plan, with realistic day-to-day ups and downs." },
  ];
  const metrics: Array<{ key: ForecastMetric; label: string }> = [
    { key: "physiologicalBodyWeightKg", label: uk ? "Вага" : "Weight" },
    { key: "fatMassKg", label: uk ? "Жир" : "Fat" },
    { key: "leanTissueKg", label: uk ? "М’язи й інше без жиру" : "Lean (non-fat) mass" },
    { key: "glycogenAssociatedMassKg", label: uk ? "Запаси вуглеводів + вода" : "Carb stores + water" },
  ];
  const [horizon, setHorizon] = useState<ForecastHorizon>(30);
  const [mode, setMode] = useState<ScenarioMode>("recent-behavior");
  const [metric, setMetric] = useState<ForecastMetric>("physiologicalBodyWeightKg");
  const [plan, setPlan] = useState<PlanValues>(DEFAULT_PLAN);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [submittedRun, setSubmittedRun] = useState<SubmittedRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<ForecastAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [scenarioEvidenceMissing, setScenarioEvidenceMissing] = useState(false);
  const [knownDonorDayCount, setKnownDonorDayCount] = useState<number | undefined>();
  const requestRef = useRef({ current: 0 });
  const controllerRef = useRef<AbortController | null>(null);
  const autoRunTimerRef = useRef<number | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const skipSettingsWrite = useRef(false);

  const runForecast = useCallback(async (selectedMode = mode, selectedHorizon = horizon, selectedPlan = plan) => {
    if (autoRunTimerRef.current !== null) {
      window.clearTimeout(autoRunTimerRef.current);
      autoRunTimerRef.current = null;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = beginForecastRequest(requestRef.current);
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setScenarioEvidenceMissing(false);
    try {
      const payload = await withMinimumVisibleLoading((async () => {
        // Forecast may persist DailyModelState first; load context afterward so diagnostics stay in sync.
        const forecastResponse = await fetchForecastResponse(
          buildForecastRequest(selectedMode, selectedHorizon, selectedPlan),
          controller.signal,
        );
        const contextResponse = await fetch("/api/forecast/context", { cache: "no-store", signal: controller.signal });
        const nextContext = contextResponse.ok ? await contextResponse.json() as Context : null;
        if (!forecastResponse.ok) {
          const issue = await forecastError(forecastResponse, locale);
          const error = new Error(issue.message) as Error & {
            forecastIssue?: typeof issue;
            nextContext?: Context | null;
          };
          error.forecastIssue = issue;
          error.nextContext = nextContext;
          throw error;
        }
        const nextOutcome = await forecastResponse.json() as Outcome;
        return { nextOutcome, nextContext };
      })());
      if (!isCurrentForecastRequest(requestRef.current, requestId)) return;
      setOutcome(payload.nextOutcome);
      setContext(payload.nextContext);
      setSubmittedRun({ mode: selectedMode, horizon: selectedHorizon, plan: { ...selectedPlan } });
      setSettingsDirty(false);
      if ("scenarioProvenance" in payload.nextOutcome) {
        setKnownDonorDayCount(payload.nextOutcome.scenarioProvenance.donorEvidence.donorDayCount);
      }
    } catch (runError) {
      if (controller.signal.aborted) return;
      if (!isCurrentForecastRequest(requestRef.current, requestId)) return;
      const issue = runError && typeof runError === "object" && "forecastIssue" in runError
        ? (runError as { forecastIssue?: Awaited<ReturnType<typeof forecastError>>; nextContext?: Context | null }).forecastIssue
        : undefined;
      const nextContext = runError && typeof runError === "object" && "nextContext" in runError
        ? (runError as { nextContext?: Context | null }).nextContext
        : undefined;
      if (nextContext) setContext(nextContext);
      if (issue) {
        setScenarioEvidenceMissing(issue.code === "insufficient_scenario_evidence");
        setErrorCode(issue.code);
        if (issue.donorDayCount !== undefined) setKnownDonorDayCount(issue.donorDayCount);
      }
      setError(runError instanceof Error ? runError.message : uk ? "Не вдалося побудувати прогноз" : "Could not run forecast");
    } finally {
      if (isCurrentForecastRequest(requestRef.current, requestId)) setLoading(false);
    }
  }, [horizon, locale, mode, plan, uk]);

  useEffect(() => {
    const persisted = readBrowserSettings(FORECAST_SETTINGS_KEY, isForecastBrowserSettings);
    const initialHorizon = persisted?.horizon ?? 30;
    const initialMode = persisted?.mode ?? "recent-behavior";
    const initialPlan = persisted?.plan ?? DEFAULT_PLAN;
    const initialRequest = window.setTimeout(() => {
      if (persisted) {
        setHorizon(initialHorizon);
        setMode(initialMode);
        setPlan(initialPlan);
      }
      setSettingsReady(true);
      void runForecast(initialMode, initialHorizon, initialPlan);
    }, 0);
    return () => {
      window.clearTimeout(initialRequest);
      if (autoRunTimerRef.current !== null) window.clearTimeout(autoRunTimerRef.current);
      controllerRef.current?.abort();
    };
  // Intentional: initial default run only; subsequent controls schedule a debounced run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    if (skipSettingsWrite.current) { skipSettingsWrite.current = false; return; }
    const settings = { horizon, mode, plan };
    if (isForecastBrowserSettings(settings)) writeBrowserSettings(FORECAST_SETTINGS_KEY, settings);
  }, [horizon, mode, plan, settingsReady]);

  function invalidateDisplayedForecast() {
    controllerRef.current?.abort();
    beginForecastRequest(requestRef.current);
    setLoading(false);
    setError(null);
    setErrorCode(null);
    setScenarioEvidenceMissing(false);
    setSettingsDirty(true);
  }
  function scheduleAutoForecast(nextMode: ScenarioMode, nextHorizon: ForecastHorizon, nextPlan: PlanValues, delayMs: number) {
    if (autoRunTimerRef.current !== null) window.clearTimeout(autoRunTimerRef.current);
    autoRunTimerRef.current = window.setTimeout(() => {
      autoRunTimerRef.current = null;
      void runForecast(nextMode, nextHorizon, nextPlan);
    }, delayMs);
  }
  function selectHorizon(next: ForecastHorizon) {
    setHorizon(next);
    invalidateDisplayedForecast();
    scheduleAutoForecast(mode, next, plan, 200);
  }
  function selectMode(next: ScenarioMode) {
    setMode(next);
    invalidateDisplayedForecast();
    scheduleAutoForecast(next, horizon, plan, 200);
  }
  function updatePlan<K extends keyof PlanValues>(key: K, value: PlanValues[K]) {
    const nextPlan = { ...plan, [key]: value };
    setPlan(nextPlan);
    invalidateDisplayedForecast();
    scheduleAutoForecast(mode, horizon, nextPlan, 650);
  }
  function resetSettings() {
    resetBrowserSettings(FORECAST_SETTINGS_KEY);
    const defaultHorizon: ForecastHorizon = 30;
    const defaultMode: ScenarioMode = "recent-behavior";
    const defaultPlan = { ...DEFAULT_PLAN };
    skipSettingsWrite.current = true;
    setHorizon(defaultHorizon);
    setMode(defaultMode);
    setPlan(defaultPlan);
    invalidateDisplayedForecast();
    scheduleAutoForecast(defaultMode, defaultHorizon, defaultPlan, 200);
  }
  async function runAction(action: ForecastAction) {
    setActionLoading(action);
    setError(null);
    setErrorCode(null);
    const response = await fetch("/api/forecast/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      const issue = await forecastError(response, locale);
      setError(issue.message);
      setErrorCode(issue.code);
      setActionLoading(null);
      return;
    }
    setActionLoading(null);
    await runForecast();
  }

  const result = outcome?.status === "ok" || outcome?.status === "degraded" || outcome?.status === "insufficient-scenario-evidence" ? outcome : null;
  const blockedOutcome = outcome?.status === "initial-state-unreliable" || outcome?.status === "initial-state-unavailable" ? outcome : null;
  const blockedCopy = blockedOutcome ? blockedPresentation(blockedOutcome, locale) : null;
  const endpoint = result ? summarizeEndpoint(result, metric) : null;
  const observedStartWeight = context?.observedWeights?.at(-1)?.weightKg ?? null;
  const startWeight = result?.experimentalCurrent?.modeledWeightKg
    ?? observedStartWeight
    ?? context?.status.currentFilteredWeightKg
    ?? context?.status.currentPredictedWeightKg
    ?? null;
  const quality = result ? qualityPresentation(result, context?.status.calibrationStatus, locale) : null;
  const metricLabel = metrics.find((item) => item.key === metric)?.label ?? "Estimate";
  const assumptions = submittedRun?.mode && submittedRun.mode !== "recent-behavior"
    ? planAssumptions(submittedRun.mode, submittedRun.plan, locale)
    : [uk ? "Беремо ваші недавні повні дні й повторюємо схожий ритм." : "We take your recent complete days and repeat a similar rhythm."];
  const workoutNotes = submittedRun
    ? forecastWorkoutScenarioNotes(submittedRun.mode, submittedRun.plan, locale)
    : [];
  const metricNotes = forecastMetricSemanticsNotes(locale);
  const productionCompartmentNotes = productionForecastCompartmentNotes(locale);
  const provenanceChips = result?.experimentalProvenance ? [] : [
    ...(context?.provenance
      ? [context.provenance.v7Cache, ...context.provenance.v7Compartments]
      : productionCompartmentNotes),
    ...(context?.provenance?.latestDay
      ? [
          context.provenance.latestDay.dataQuality,
          context.provenance.latestDay.nutrition,
          context.provenance.latestDay.workoutFeed,
        ]
      : []),
  ].filter((chip): chip is ProvenanceChip => chip !== null && chip !== undefined);
  const chartLabels = forecastChartLabels(locale, metric, result?.forecastVersion === "experimental-forecast-v1");
  const readiness = forecastReadiness({
    status: context?.status ?? null,
    locale,
    mode,
    donorDayCount: result?.scenarioProvenance.donorEvidence.donorDayCount ?? knownDonorDayCount,
    successfulForecast: Boolean(result),
    blocked: Boolean(blockedOutcome),
    scenarioEvidenceMissing,
    forecastQuality: result?.experimentalQuality,
  });
  const showStartModel = errorCode === "no_active_episode" || errorCode === "initialization_failed";
  const busy = loading || actionLoading !== null;
  const needsRecalculation = modelNeedsRecalculation(context?.status ?? null);
  const hasForecastResult = Boolean(result);
  // The forecast surface remains usable even when the persisted production
  // episode is missing or initialization is incomplete. In that case the
  // bootstrap/previous result and all controls stay visible; the error is only
  // an informational notice rather than a blocking empty state.
  const showRecalculate = true;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Прогноз фізіології" : "Physiology forecast"}</span></Link><AppNav active="forecast" /></div>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>{uk ? "Погляд уперед · не обіцянка" : "Looking ahead · not a promise"}</p><h1>{uk ? "Дивіться на діапазон, а не лише на лінію." : "See the range, not just a line."}</h1><p>{uk ? "Подивіться, як звички можуть змінити вагу й склад тіла. Смужки навколо лінії — це «можливо так», а не гарантія." : "See how habits may change weight and body composition. The bands around the line mean “maybe around here,” not a guarantee."}</p></div>
        <div className={styles.readiness}><span className={result ? styles.readyDot : styles.waitingDot} />{busy ? (actionLoading === "initialize" ? noActiveModelCopy.loadingAction : (uk ? "Рахуємо варіанти…" : "Calculating options…")) : quality?.title ?? (uk ? "Потрібна увага" : "Needs attention")}</div>
      </header>

      <section className={styles.controlPanel} aria-label={uk ? "Налаштування прогнозу" : "Forecast controls"}>
        <div className={styles.stepHeading}><span /> <button type="button" onClick={resetSettings}>{uk ? "Скинути налаштування" : "Reset settings"}</button></div>
        <section className={styles.controlStep} aria-labelledby="forecast-horizon-heading"><div className={styles.stepHeading}><span>01</span><div><h2 id="forecast-horizon-heading">{uk ? "Період прогнозу" : "Forecast horizon"}</h2><p>{uk ? "На скільки днів уперед дивимось?" : "How far ahead should we look?"}</p></div></div><div className={styles.segmented} aria-label={uk ? "Кількість днів" : "Number of days"}>{FORECAST_HORIZONS.map((days) => <button type="button" key={days} aria-pressed={horizon === days} onClick={() => selectHorizon(days)}>{days < 365 ? `${days}${uk ? "д" : "d"}` : (uk ? "1р" : "1y")}</button>)}</div><p className={styles.stepHint}>{uk ? "На довшому періоді діапазон невизначеності ширшає." : "Uncertainty grows over longer periods."}<HelpTip>{uk ? "30–90 днів зручні для практичних сценаріїв. На 180–365 днів кінцева цифра показує напрям, а не обіцянку." : "30–90 days works well for practical scenarios. At 180–365 days, the endpoint shows direction, not a promise."}</HelpTip></p></section>
        <section className={styles.controlStep} aria-labelledby="forecast-mode-heading"><div className={styles.stepHeading}><span>02</span><div><h2 id="forecast-mode-heading">{uk ? "Що відбуватиметься далі?" : "What happens next?"}</h2><p>{uk ? "Оберіть звички або задайте майбутній план." : "Use recent habits or describe a future plan."}</p></div></div><div className={styles.scenarioGrid}>{scenarios.map((scenario) => <button type="button" key={scenario.mode} aria-pressed={mode === scenario.mode} onClick={() => selectMode(scenario.mode)}><strong>{scenario.label}</strong><span>{scenario.hint}</span></button>)}</div><p className={styles.stepHint}><HelpTip>{uk ? "«Як останнім часом» використовує типові повні дні з Історії. У цьому режимі поля майбутнього плану не діють. Точний план повторює введені числа щодня; гнучкий план додає невеликі коливання." : "Recent behavior repeats typical complete days from History; future-plan fields do not apply in this mode. Exact plan repeats your entries daily; flexible plan adds small variations."}</HelpTip></p></section>

        {mode === "recent-behavior" ? <p className={styles.recentNotice} role="status">{uk ? "Прогноз повторює ваші недавні повні дні з Історії. Ручні поля харчування, руху й роботи тут не застосовуються." : "This forecast repeats your recent complete days from History. Manual food, movement, and work fields do not apply here."}</p> : <form className={styles.planForm} onSubmit={(event: FormEvent) => { event.preventDefault(); void runForecast(); }}>
          <fieldset className={styles.controlStep}><legend className={styles.visuallyHidden}>{uk ? "03 Щоденне харчування" : "03 Daily nutrition"}</legend><div className={styles.stepHeading}><span>03</span><div><h2>{uk ? "Заплановане харчування" : "Planned nutrition"}</h2><p>{uk ? "Середнє за день; змінюйте значення під ваш план." : "Daily averages; edit these to match your plan."}</p></div></div><div className={styles.formGrid}>
            <NumberField label={uk ? "Енергія" : "Energy"} unit={uk ? "ккал" : "kcal"} help={uk ? "Заплановані середні калорії на один день. Візьміть значення з вашого харчового трекера; макроси нижче мають належати цьому самому дню." : "Planned average calories per day. Use your food tracker; the macros below should describe that same day."} value={plan.caloriesKcal} max={20000} onChange={(value) => updatePlan("caloriesKcal", value)} />
            <NumberField label={uk ? "Білки" : "Protein"} unit={uk ? "г" : "g"} value={plan.proteinG} max={1000} onChange={(value) => updatePlan("proteinG", value)} />
            <NumberField label={uk ? "Жири" : "Fat"} unit={uk ? "г" : "g"} value={plan.fatG} max={1000} onChange={(value) => updatePlan("fatG", value)} />
            <NumberField label={uk ? "Вуглеводи" : "Carbs"} unit={uk ? "г" : "g"} value={plan.carbsG} max={2000} onChange={(value) => updatePlan("carbsG", value)} />
          </div></fieldset>
          <fieldset className={styles.controlStep}><legend className={styles.visuallyHidden}>{uk ? "04 Майбутня активність" : "04 Future activity"}</legend><div className={styles.stepHeading}><span>04</span><div><h2>{uk ? "Майбутня активність" : "Future activity"}</h2><p>{uk ? "Задайте рух і тренування на типовий тиждень." : "Describe movement and training in a typical week."}</p></div></div><div className={styles.formGrid}>
            <NumberField label={uk ? "Середні кроки" : "Average steps"} unit={uk ? "на день" : "per day"} help={uk ? "Кроки перетворюються на приблизну активність усередині розрахунку." : "Steps are converted to approximate activity inside the calculation."} value={plan.averageStepsPerDay} max={100000} step={100} onChange={(value) => updatePlan("averageStepsPerDay", value)} />
            <NumberField label={uk ? "Силових тренувань" : "Strength sessions"} unit={uk ? "на тиждень" : "per week"} value={plan.strengthDaysPerWeek} max={7} onChange={(value) => updatePlan("strengthDaysPerWeek", value)} />
            <NumberField label={uk ? "Силове заняття" : "Strength session"} unit={uk ? "хв" : "min"} value={plan.strengthTrainingMinutes} max={600} onChange={(value) => updatePlan("strengthTrainingMinutes", value)} />
            <NumberField label={uk ? "Інші тренування" : "Other sessions"} unit={uk ? "на тиждень" : "per week"} value={plan.otherTrainingDaysPerWeek} max={7} onChange={(value) => updatePlan("otherTrainingDaysPerWeek", value)} />
            <NumberField label={uk ? "Інше тренування" : "Other session"} unit={uk ? "хв" : "min"} value={plan.otherTrainingMinutes} max={600} onChange={(value) => updatePlan("otherTrainingMinutes", value)} />
          </div></fieldset>
          <fieldset className={styles.controlStep}><legend className={styles.visuallyHidden}>{uk ? "05 Робочий графік" : "05 Work schedule"}</legend><div className={styles.stepHeading}><span>05</span><div><h2>{uk ? "Робочий графік" : "Work schedule"}</h2><p>{uk ? "Додавайте роботу, якщо вона помітно змінює ваш рух." : "Include work if it meaningfully changes your movement."}</p></div></div><label className={styles.toggle}><input type="checkbox" checked={plan.plannedWork} onChange={(event) => updatePlan("plannedWork", event.currentTarget.checked)} /><span>{uk ? "Враховувати робочі дні" : "Include work days"}</span></label>
            {plan.plannedWork && <div className={styles.formGrid}>
              <NumberField label={uk ? "Робочих днів" : "Work days"} unit={uk ? "на тиждень" : "per week"} value={plan.workDaysPerWeek} min={1} max={7} onChange={(value) => updatePlan("workDaysPerWeek", value)} />
              <label className={styles.field}><span>{uk ? "Інтенсивність роботи" : "Work intensity"}</span><select value={plan.workCategory} onChange={(event) => updatePlan("workCategory", event.currentTarget.value as PlanValues["workCategory"])}><option value="standingLight">{uk ? "Дуже легка / переважно очікування" : "Very light / mostly waiting"}</option><option value="manualLight">{uk ? "Легке переміщення / пакування" : "Light handling / packing"}</option><option value="standingLightModerate">{uk ? "Активна легка ручна робота" : "Active light manual work"}</option><option value="manualModerate">{uk ? "Помірна ручна робота" : "Moderate handling"}</option></select></label>
              <NumberField label={uk ? "Зміна" : "Shift"} unit={uk ? "год" : "hours"} value={plan.shiftHours} min={0.1} max={24} step={0.25} onChange={(value) => updatePlan("shiftHours", value)} />
              <NumberField label={uk ? "Перерви" : "Breaks"} unit={uk ? "год" : "hours"} value={plan.breakHours} max={plan.shiftHours} step={0.25} onChange={(value) => updatePlan("breakHours", value)} />
            </div>}
          </fieldset>
        </form>}
        <div className={styles.runRow}>
          <button className={styles.runButton} type="button" aria-busy={busy} disabled={busy} onClick={() => void runForecast()}>{loading ? (uk ? "Запустити оновлений прогноз" : "Run updated forecast") : (uk ? "Побудувати прогноз" : "Run forecast")}</button><HelpTip>{uk ? "Після зміни періоду, режиму або числового поля прогноз оновиться автоматично; кнопка — для ручного повтору." : "After changing the horizon, mode, or a number, the forecast updates automatically; use this button to rerun manually."}</HelpTip>
          {showRecalculate && <button className={needsRecalculation ? styles.recalculateButtonPrimary : styles.recalculateButton} type="button" aria-busy={actionLoading === "recalculate"} disabled={busy} onClick={() => void runAction("recalculate")}>{actionLoading === "recalculate" ? recalculateCopy.loadingAction : recalculateCopy.action}</button>}
        </div>
        {showRecalculate && <p className={styles.recalculateHint}>{recalculateCopy.hint}</p>}
      </section>

      <section className={`${styles.readinessCard} ${styles[readiness.level]}`} aria-label={uk ? "Наскільки зрозумілий прогноз" : "How clear the forecast is"}>
        <div className={styles.readinessScore}><strong>{readiness.score ?? "—"}</strong><span>/ 100</span></div>
        <div><p className={styles.eyebrow}>{readiness.canForecast ? (uk ? "Прогноз можна побудувати" : "Forecast can run") : (uk ? "Чому прогнозу ще немає" : "Why there is no forecast yet")}</p><h2>{readiness.title}</h2><p>{readiness.detail}</p><ul>{readiness.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul></div>
      </section>

      {error && showStartModel && !hasForecastResult && <section className={styles.blocked} role="alert">
        <p className={styles.eyebrow}>{noActiveModelCopy.eyebrow}</p>
        <h2>{noActiveModelCopy.title}</h2>
        <p>{error}</p>
        <div className={styles.actions}>
          <button type="button" disabled={busy} aria-busy={actionLoading === "initialize"} onClick={() => void runAction("initialize")}>
            {actionLoading === "initialize" ? noActiveModelCopy.loadingAction : noActiveModelCopy.primaryAction}
          </button>
          <Link href="/history">{noActiveModelCopy.addObservations}</Link>
        </div>
      </section>}

      {error && !showStartModel && !hasForecastResult && <section className={styles.blocked} role="alert"><p className={styles.eyebrow}>{uk ? "Прогноз недоступний" : "Forecast unavailable"}</p><h2>{uk ? "Цей варіант поки неможливо порахувати." : "We can’t calculate this option yet."}</h2><p>{error}</p><div className={styles.actions}>{mode === "recent-behavior" && <button type="button" onClick={() => selectMode("target-centered")}>{uk ? "Спробувати план з відхиленнями" : "Try a plan with drift"}</button>}<Link href="/history">{uk ? "Додати дані" : "Add data"}</Link></div></section>}
      {error && hasForecastResult && <section className={styles.notice} role="status">
        <strong>{uk ? "Показано доступний прогноз" : "Showing the available forecast"}</strong>
        <span>{error}</span>
        {showStartModel && <div className={styles.actions}>
          <button type="button" disabled={busy} aria-busy={actionLoading === "initialize"} onClick={() => void runAction("initialize")}>
            {actionLoading === "initialize" ? noActiveModelCopy.loadingAction : noActiveModelCopy.primaryAction}
          </button>
          <Link href="/history">{noActiveModelCopy.addObservations}</Link>
        </div>}
      </section>}

      {!error && blockedOutcome && blockedCopy && <section className={styles.blocked}><p className={styles.eyebrow}>{uk ? "Потрібна поточна вага моделі" : "Current model weight needed"}</p><h2>{blockedCopy.title}</h2><p>{blockedCopy.detail}</p><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void runAction("recalculate")}>{recalculateCopy.action}</button><Link href="/history">{uk ? "Переглянути історію" : "Review history"}</Link></div></section>}

      {loading && !outcome && !error && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>{uk ? "Рахуємо можливі варіанти ваги" : "Calculating possible weight paths"}</strong><span>{uk ? "Кожен варіант стартує від вашої останньої зрозумілої ваги." : "Each path starts from your latest understood weight."}</span></section>}
      {loading && outcome && <div className={styles.updateOverlay} role="status">{uk ? "Оновлюємо прогноз…" : "Updating forecast…"}</div>}
      {!loading && !outcome && !error && (settingsDirty || submittedRun === null) && <section className={styles.pendingCard}><strong>{uk ? "Налаштування змінено" : "Settings changed"}</strong><span>{uk ? "Прогноз оновиться автоматично через мить." : "The forecast will update automatically in a moment."}</span></section>}

      {result && endpoint && <>
        {quality && <section className={`${styles.qualityBanner} ${styles[quality.tone]}`}><div><strong>{quality.title}</strong><span>{quality.detail}</span>{(result.experimentalQuality === "limited-history" || result.experimentalQuality === "bootstrap") && <span>{uk ? "Це provisional-оцінка: діапазон ширший, але модель не заблокована." : "This is a provisional estimate: the range is wider, but the model is not blocked."}</span>}{result.experimentalProvenance?.improvements.map((item) => <span key={item}>{item}</span>)}</div><span>{result.scenarioProvenance.donorEvidence.donorDayCount} {uk ? "днів з даними" : "days with data"}</span></section>}
        <section className={styles.summaryGrid}>
          <article><span>{uk ? `Очікувана метрика «${metricLabel.toLowerCase()}» на ${formatDate(result.dates.at(-1)!.date, undefined, locale)}` : `Expected ${metricLabel.toLowerCase()} on ${formatDate(result.dates.at(-1)!.date, undefined, locale)}`}</span><strong>{formatValue(endpoint.median, "kg", locale)}</strong><small>{uk ? "Медіанна оцінка" : "Median estimate"}</small></article>
          <article><span>{result.forecastVersion === "experimental-forecast-v1" ? (uk ? "Інженерний діапазон" : "Engineering range") : (uk ? "Імовірний діапазон" : "Likely range")}<HelpTip>{result.forecastVersion === "experimental-forecast-v1" ? (uk ? "Детерміновані межі моделі, не статистичний confidence interval." : "Deterministic model bounds, not a statistical confidence interval.") : (uk ? "Межі 25–75%: половина змодельованих траєкторій опинилася всередині. Це не гарантія і не весь можливий діапазон." : "The 25th–75th percentile range: half of modeled paths landed inside. It is not a guarantee or the full possible range.")}</HelpTip></span><strong>{formatValue(endpoint.p25, "kg", locale)}–{formatValue(endpoint.p75, "kg", locale)}</strong><small>{result.forecastVersion === "experimental-forecast-v1" ? (uk ? "Інженерні межі" : "Engineering bounds") : (uk ? "Середня половина варіантів" : "Middle half of the options")}</small></article>
          <article><span>{result.forecastVersion === "experimental-forecast-v1" ? (uk ? "Широкий інженерний діапазон" : "Wide engineering range") : (uk ? "Ширший можливий діапазон" : "Wider possible range")}</span><strong>{formatValue(endpoint.p05, "kg", locale)}–{formatValue(endpoint.p95, "kg", locale)}</strong><small>{result.forecastVersion === "experimental-forecast-v1" ? (uk ? "Не confidence interval" : "Not a confidence interval") : (uk ? "Більшість варіантів (близько 9 з 10)" : "Most options (about 9 in 10)")}</small></article>
          <article><span>{uk ? "Очікувана зміна ваги" : "Expected weight change"}</span><strong>{metric === "physiologicalBodyWeightKg" && startWeight !== null ? `${endpoint.median - startWeight >= 0 ? "+" : ""}${new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 1 }).format(endpoint.median - startWeight)} kg` : "—"}</strong><small>{metric === "physiologicalBodyWeightKg" ? (uk ? "Від поточної оцінки моделі" : "From the current model estimate") : (uk ? "Показується в режимі ваги" : "Shown for weight view")}</small></article>
        </section>
        <section className={styles.chartPanel}>
          <div className={styles.chartHeader}><div><p className={styles.eyebrow}>{uk ? "Історія → поточний стан → майбутнє" : "History → current state → future"}</p><h2>{uk ? "Як може змінюватись тіло" : "How the body may change"} <HelpTip label={uk ? "Пояснення оцінки й прогнозу" : "About model estimate and forecast"}>{uk ? "Історична оцінка моделі враховує вимірювання, доступні на той час, тому може бути близькою до ваги з вагів. Це не прогноз, зроблений до вимірювання. Майбутній прогноз моделює зміни вперед від актуальної ваги з вимірювання, якщо вона доступна." : "The historical model estimate uses measurements available at that time, so it may be close to scale weight. It is not a forecast made before the measurement. The future forecast projects forward from the latest measured weight when available."}</HelpTip></h2></div><div className={styles.metricTabs}>{metrics.map((item) => <button type="button" key={item.key} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div></div>
          <div className={styles.legend} aria-label={uk ? "Легенда графіка" : "Chart legend"}>
            {metric === "physiologicalBodyWeightKg" ? <>
              <span><i className={styles.observedKey} />{chartLabels.measuredWeight}</span>
              <span><i className={styles.historyKey} />{chartLabels.modelEstimate}</span>
            </> : <span><i className={styles.historyKey} />{chartLabels.historicalEstimate}</span>}
            <span><i className={styles.medianKey} />{uk ? "Майбутній прогноз" : "Future forecast"}</span>
            {result.forecastVersion === "experimental-forecast-v1"
              ? <span><i className={styles.outerKey} />{chartLabels.engineeringRange}</span>
              : <>
                <span><i className={styles.innerKey} />{uk ? "25–75% прогнозу" : "25–75% forecast interval"}</span>
                <span><i className={styles.outerKey} />{uk ? "5–95% прогнозу" : "5–95% forecast interval"}</span>
              </>}
          </div>
          <ForecastChart result={result} metric={metric} history={context?.history ?? []} observedWeights={context?.observedWeights ?? []} locale={locale} />
          <p className={styles.chartNote}>{result.forecastVersion === "experimental-forecast-v1"
            ? (uk ? "Інженерний діапазон показує детерміновані межі моделі, а не статистичні квантилі. Суцільна лінія — центральна оцінка майбутнього." : "The engineering range shows deterministic model bounds, not statistical quantiles. The solid line is the central future estimate.")
            : (uk ? "Межі 25–75% та 5–95% — емпіричні квантильні інтервали змодельованих траєкторій, не гарантія результату." : "The 25–75% and 5–95% bands are empirical quantile intervals across simulated paths, not a guarantee of the outcome.")}</p>
        </section>
        {result.experimentalCurrent && <section className={styles.detailGrid} aria-label={uk ? "Поточний Unified стан" : "Current Unified state"}>
          <article><h2>{uk ? "Поточний стан" : "Current state"}</h2><dl>
            <div><dt>{uk ? "Модельована вага" : "Modeled weight"}</dt><dd>{result.experimentalCurrent.modeledWeightKg === null ? "—" : formatValue(result.experimentalCurrent.modeledWeightKg, "kg", locale)}</dd></div>
            <div><dt>{uk ? "Жир" : "Fat"}</dt><dd>{result.experimentalCurrent.fatMassKg === null ? "—" : formatValue(result.experimentalCurrent.fatMassKg, "kg", locale)}</dd></div>
            <div><dt>{uk ? "Повільна безжирова тканина" : "Slow non-fat"}</dt><dd>{result.experimentalCurrent.slowNonFatKg === null ? "—" : formatValue(result.experimentalCurrent.slowNonFatKg, "kg", locale)}</dd></div>
            <div><dt>{uk ? "Глікогенова вода" : "Glycogen water"}</dt><dd>{result.experimentalCurrent.glycogenWaterKg === null ? "—" : formatValue(result.experimentalCurrent.glycogenWaterKg, "kg", locale)}</dd></div>
          </dl></article>
          <article><h2>{uk ? "Витрата та якість" : "Expenditure & quality"}</h2><dl>
            <div><dt>{uk ? "RMR / базова витрата" : "RMR / resting burn"}</dt><dd>{result.experimentalCurrent.restingRmrKcalPerDay === null ? "—" : formatValue(result.experimentalCurrent.restingRmrKcalPerDay, "kcal", locale)}</dd></div>
            <div><dt>{uk ? "Типова підтримка" : "Typical maintenance"}</dt><dd>{result.experimentalCurrent.typicalMaintenanceKcalPerDay === null ? "—" : formatValue(result.experimentalCurrent.typicalMaintenanceKcalPerDay, "kcal", locale)}</dd></div>
            <div><dt>{uk ? "Остання денна витрата" : "Latest daily expenditure"}</dt><dd>{result.experimentalCurrent.latestExpenditureKcalPerDay === null ? "—" : formatValue(result.experimentalCurrent.latestExpenditureKcalPerDay, "kcal", locale)}</dd></div>
            <div><dt>{uk ? "Покриття історії" : "History coverage"}</dt><dd>{result.experimentalCurrent.eligibleDays}/{result.experimentalCurrent.requestedWindowDays} {uk ? "днів" : "days"}</dd></div>
          </dl></article>
        </section>}
        <section className={styles.detailGrid}>
          <article><h2>{uk ? "Енергія в кінці періоду" : "Energy at the end"}</h2><dl><div><dt>{uk ? "Скільки з’їли (очікувано)" : "Expected intake"}</dt><dd>{formatValue(result.dates.at(-1)!.energyIntakeKcal.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Скільки витратили за день" : "Daily burn"}</dt><dd>{formatValue(result.dates.at(-1)!.tdeeKcalPerDay.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Базовий обмін у спокої" : "Resting burn"}</dt><dd>{formatValue(result.dates.at(-1)!.dynamicRmrKcalPerDay.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Витрати на рух" : "Movement burn"}</dt><dd>{formatValue(result.dates.at(-1)!.netActivityKcalPerDay.median, "kcal", locale)}</dd></div></dl></article>
          <article><h2>{uk ? "Що ми припустили в цьому розрахунку" : "What this run assumes"}</h2><ul>{assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}{workoutNotes.map((note) => <li key={note}>{note}</li>)}{metricNotes.map((note) => <li key={note}>{note}</li>)}<li>{uk ? "Невизначеність стартової ваги" : "Starting-weight uncertainty"}: {result.diagnostics.uncertaintySources.initialState ? (uk ? "враховано" : "included") : (uk ? "не потрібна" : "not needed")}.</li><li>{uk ? "Невизначеність майбутніх звичок" : "Future-habit uncertainty"}: {result.diagnostics.uncertaintySources.futureBehavior ? (uk ? "враховано" : "included") : (uk ? "не враховано" : "not included")}.</li><li>{uk ? "Похибку вагів і всі можливі помилки моделі поки не враховано." : "Scale noise and every possible model error are not included yet."}</li></ul></article>
        </section>
        {provenanceChips.length > 0 && (
          <section className={styles.provenancePanel} aria-label={uk ? "Якість і походження даних" : "Data quality and provenance"}>
            <h2>{uk ? "Якість і походження" : "Quality and provenance"}</h2>
            <ul className={styles.provenanceList}>
              {provenanceChips.map((chip) => (
                <li key={chip.key} className={styles.provenanceItem} data-tone={chip.tone}>
                  <strong>{chip.label}</strong>
                  <span>{chip.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <details className={styles.diagnostics}><summary>{uk ? "Технічна діагностика" : "Technical diagnostics"}</summary><dl><div><dt>{uk ? "Версія прогнозу" : "Forecast version"}</dt><dd>{result.forecastVersion}</dd></div><div><dt>{uk ? "Якість старту" : "Initial-state quality"}</dt><dd>{result.initialStateQuality}</dd></div><div><dt>{uk ? "Сценарій" : "Scenario"}</dt><dd>{result.scenarioProvenance.mode} · {result.scenarioProvenance.nutrition} · {result.scenarioProvenance.activity}</dd></div><div><dt>{uk ? "Валідні траєкторії" : "Valid paths"}</dt><dd>{result.diagnostics.validPathCount} / {result.diagnostics.generatedPathCount}</dd></div><div><dt>{uk ? "Початкові стани" : "Starting states"}</dt><dd>{result.diagnostics.startingParticleCount}</dd></div><div><dt>{uk ? "Джерело даних" : "Evidence source"}</dt><dd>{result.scenarioProvenance.donorEvidence.source}</dd></div><div><dt>{uk ? "Числова якість" : "Numerical quality"}</dt><dd>{result.diagnostics.numericalQuality.classification}</dd></div><div><dt>{uk ? "Відбиток" : "Fingerprint"}</dt><dd>{result.sourceFingerprint.slice(0, 16)}…</dd></div></dl></details>
      </>}
    </main>
  );
}
