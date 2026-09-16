"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { HelpTip } from "@/components/help-tip";
import { useI18n, type Locale } from "@/i18n/i18n-provider";
import type { ModelStatusDto, UnknownIntervalDto } from "@/modules/model-episodes/model-episode.types";
import type { ForecastBlockedResult, ForecastResult } from "@/modules/model-forecast/forecast.types";
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
import { ForecastChart } from "./forecast-chart";
import styles from "./forecast.module.css";

type HistoricalDay = { date: string; modeledWeightKg: number | null; fatMassKg: number | null; leanTissueKg: number | null; glycogenAssociatedMassKg: number | null; dataQuality: string };
type Context = { status: ModelStatusDto; history: HistoricalDay[]; unknownIntervals: UnknownIntervalDto[] };
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
      insufficient_scenario_evidence: "Для сценарію «Як останнім часом» потрібно щонайменше 14 повних днів з вашими звичками. Оберіть план або додайте дані.",
      recovery_required: "Спочатку потрібно закрити пропуск у даних і зрозуміти поточну вагу.",
    } : {
      no_active_episode: "There is no active model yet. Start the model here if weight and calories are already in your history.",
    };
    return {
      message: (body.error && messages[body.error]) || raw,
      code: body.error ?? null,
      ...(received ? { donorDayCount: Number(received) } : {}),
    };
  } catch { return { message: fallback, code: null }; }
}

function NumberField({ label, value, onChange, min = 0, max, step = 1, unit, help }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string; help?: string;
}) {
  return <label className={styles.field}><span>{label}{unit ? ` (${unit})` : ""}{help && <HelpTip>{help}</HelpTip>}</span><input type="number" value={value} min={min} max={max} step={step} required onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
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

  const runForecast = useCallback(async (selectedMode = mode, selectedHorizon = horizon, selectedPlan = plan) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = beginForecastRequest(requestRef.current);
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setScenarioEvidenceMissing(false);
    setOutcome(null);
    try {
      const payload = await withMinimumVisibleLoading((async () => {
        // Forecast may persist DailyModelState first; load context afterward so diagnostics stay in sync.
        const forecastResponse = await fetch("/api/forecast", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildForecastRequest(selectedMode, selectedHorizon, selectedPlan)),
          signal: controller.signal,
        });
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
    const initialRequest = window.setTimeout(() => void runForecast("recent-behavior", 30, DEFAULT_PLAN), 0);
    return () => {
      window.clearTimeout(initialRequest);
      controllerRef.current?.abort();
    };
  // Intentional: initial default run only. Later changes require the explicit button.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function invalidateDisplayedForecast() {
    controllerRef.current?.abort();
    beginForecastRequest(requestRef.current);
    setLoading(false);
    setOutcome(null);
    setError(null);
    setErrorCode(null);
    setScenarioEvidenceMissing(false);
    setSubmittedRun(null);
  }
  function selectHorizon(next: ForecastHorizon) { setHorizon(next); invalidateDisplayedForecast(); }
  function selectMode(next: ScenarioMode) { setMode(next); invalidateDisplayedForecast(); }
  function updatePlan<K extends keyof PlanValues>(key: K, value: PlanValues[K]) {
    setPlan((current) => ({ ...current, [key]: value }));
    invalidateDisplayedForecast();
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
  const startWeight = context?.status.currentPredictedWeightKg ?? context?.status.currentFilteredWeightKg ?? null;
  const quality = result ? qualityPresentation(result, context?.status.calibrationStatus, locale) : null;
  const metricLabel = metrics.find((item) => item.key === metric)?.label ?? "Estimate";
  const assumptions = submittedRun?.mode && submittedRun.mode !== "recent-behavior"
    ? planAssumptions(submittedRun.mode, submittedRun.plan, locale)
    : [uk ? "Беремо ваші недавні повні дні й повторюємо схожий ритм." : "We take your recent complete days and repeat a similar rhythm."];
  const readiness = forecastReadiness({
    status: context?.status ?? null,
    locale,
    mode,
    donorDayCount: result?.scenarioProvenance.donorEvidence.donorDayCount ?? knownDonorDayCount,
    successfulForecast: Boolean(result),
    blocked: Boolean(blockedOutcome),
    scenarioEvidenceMissing,
  });
  const showStartModel = errorCode === "no_active_episode" || errorCode === "initialization_failed";
  const busy = loading || actionLoading !== null;
  const needsRecalculation = modelNeedsRecalculation(context?.status ?? null);
  const showRecalculate = !showStartModel;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Прогноз фізіології" : "Physiology forecast"}</span></Link><AppNav active="forecast" /></div>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>{uk ? "Погляд уперед · не обіцянка" : "Looking ahead · not a promise"}</p><h1>{uk ? "Дивіться на діапазон, а не лише на лінію." : "See the range, not just a line."}</h1><p>{uk ? "Подивіться, як звички можуть змінити вагу й склад тіла. Смужки навколо лінії — це «можливо так», а не гарантія." : "See how habits may change weight and body composition. The bands around the line mean “maybe around here,” not a guarantee."}</p></div>
        <div className={styles.readiness}><span className={result ? styles.readyDot : styles.waitingDot} />{busy ? (actionLoading === "initialize" ? noActiveModelCopy.loadingAction : (uk ? "Рахуємо варіанти…" : "Calculating options…")) : quality?.title ?? (uk ? "Потрібна увага" : "Needs attention")}</div>
      </header>

      <section className={styles.controlPanel} aria-label={uk ? "Налаштування прогнозу" : "Forecast controls"}>
        <div className={styles.controlGroup}><div><strong>{uk ? "На скільки днів уперед" : "How far ahead"}<HelpTip>{uk ? "30–90 днів зручні для практичних сценаріїв. На 180–365 днів невизначеність накопичується, тому кінцева цифра показує напрям, а не обіцянку." : "30–90 days works well for practical scenarios. At 180–365 days uncertainty accumulates, so the endpoint shows direction, not a promise."}</HelpTip></strong><span>{uk ? "Чим довше — тим ширший діапазон «можливо»." : "The farther out, the wider the “maybe” range."}</span></div><div className={styles.segmented}>{FORECAST_HORIZONS.map((days) => <button type="button" key={days} aria-pressed={horizon === days} onClick={() => selectHorizon(days)}>{days < 365 ? `${days}${uk ? "д" : "d"}` : (uk ? "1р" : "1y")}</button>)}</div></div>
        <div className={styles.controlGroup}><div><strong>{uk ? "Який режим далі" : "What happens next"}<HelpTip>{uk ? "«Як останнім часом» бере типові дні з Історії. «Точний план» повторює введені числа. «План з відхиленнями» додає реалістичну мінливість навколо плану." : "Recent behavior uses typical History days. Exact plan repeats your entries. Plan with drift adds realistic variation around them."}</HelpTip></strong><span>{scenarios.find((item) => item.mode === mode)?.hint}</span></div><div className={styles.scenarioGrid}>{scenarios.map((scenario) => <button type="button" key={scenario.mode} aria-pressed={mode === scenario.mode} onClick={() => selectMode(scenario.mode)}><strong>{scenario.label}</strong><span>{scenario.mode === "fixed" ? (uk ? "Без відхилень від плану" : "No drift from the plan") : scenario.mode === "recent-behavior" ? (uk ? "На основі ваших даних" : "Based on your data") : (uk ? "З невеликими реальними відхиленнями" : "With small real-life drift")}</span></button>)}</div></div>

        {mode !== "recent-behavior" && <form className={styles.planForm} onSubmit={(event: FormEvent) => { event.preventDefault(); void runForecast(); }}>
          <fieldset><legend>{uk ? "Щоденне харчування" : "Daily nutrition"}</legend><div className={styles.formGrid}>
            <NumberField label={uk ? "Енергія" : "Energy"} unit={uk ? "ккал" : "kcal"} help={uk ? "Заплановані середні калорії на один день. Візьміть значення з вашого харчового трекера; макроси нижче мають належати цьому самому дню." : "Planned average calories per day. Use your food tracker; the macros below should describe that same day."} value={plan.caloriesKcal} max={20000} onChange={(value) => updatePlan("caloriesKcal", value)} />
            <NumberField label={uk ? "Білки" : "Protein"} unit={uk ? "г" : "g"} value={plan.proteinG} max={1000} onChange={(value) => updatePlan("proteinG", value)} />
            <NumberField label={uk ? "Жири" : "Fat"} unit={uk ? "г" : "g"} value={plan.fatG} max={1000} onChange={(value) => updatePlan("fatG", value)} />
            <NumberField label={uk ? "Вуглеводи" : "Carbs"} unit={uk ? "г" : "g"} value={plan.carbsG} max={2000} onChange={(value) => updatePlan("carbsG", value)} />
          </div></fieldset>
          <fieldset><legend>{uk ? "Рух і тренування" : "Movement & training"}</legend><div className={styles.formGrid}>
            <NumberField label={uk ? "Ходьба поза роботою" : "Walking outside work"} unit={uk ? "км" : "km"} help={uk ? "Середня відстань за день без ходьби під час робочої зміни. Подивіться типовий день в Apple Health або Історії." : "Average daily distance excluding walking during a work shift. Check a typical day in Apple Health or History."} value={plan.outsideWorkWalkingDistanceKm} max={100} step={0.1} onChange={(value) => updatePlan("outsideWorkWalkingDistanceKm", value)} />
            <NumberField label={uk ? "Швидкість ходьби" : "Walking speed"} unit={uk ? "км/год" : "km/h"} value={plan.averageWalkingSpeedKmh} min={0.1} max={15} step={0.1} onChange={(value) => updatePlan("averageWalkingSpeedKmh", value)} />
            <NumberField label={uk ? "Силові дні" : "Strength days"} unit={uk ? "на тиждень" : "per week"} value={plan.strengthDaysPerWeek} max={7} onChange={(value) => updatePlan("strengthDaysPerWeek", value)} />
            <NumberField label={uk ? "Силове заняття" : "Strength session"} unit={uk ? "хв" : "min"} value={plan.strengthTrainingMinutes} max={600} onChange={(value) => updatePlan("strengthTrainingMinutes", value)} />
          </div></fieldset>
          <fieldset><legend>{uk ? "Запланована робота" : "Planned work"}</legend><label className={styles.toggle}><input type="checkbox" checked={plan.plannedWork} onChange={(event) => updatePlan("plannedWork", event.currentTarget.checked)} /><span>{uk ? "Додати цю зміну з понеділка по п’ятницю" : "Include this shift Monday–Friday"}</span></label>
            {plan.plannedWork && <div className={styles.formGrid}>
              <label className={styles.field}><span>{uk ? "Інтенсивність роботи" : "Work intensity"}</span><select value={plan.workCategory} onChange={(event) => updatePlan("workCategory", event.currentTarget.value as PlanValues["workCategory"])}><option value="standingLight">{uk ? "Дуже легка / переважно очікування" : "Very light / mostly waiting"}</option><option value="manualLight">{uk ? "Легке переміщення / пакування" : "Light handling / packing"}</option><option value="standingLightModerate">{uk ? "Активна легка ручна робота" : "Active light manual work"}</option><option value="manualModerate">{uk ? "Помірна ручна робота" : "Moderate handling"}</option></select></label>
              <NumberField label={uk ? "Зміна" : "Shift"} unit={uk ? "год" : "hours"} value={plan.shiftHours} min={0.1} max={24} step={0.25} onChange={(value) => updatePlan("shiftHours", value)} />
              <NumberField label={uk ? "Перерви" : "Breaks"} unit={uk ? "год" : "hours"} value={plan.breakHours} max={plan.shiftHours} step={0.25} onChange={(value) => updatePlan("breakHours", value)} />
              <NumberField label={uk ? "Ходьба на роботі" : "Walking at work"} unit={uk ? "км" : "km"} value={plan.workWalkingDistanceKm} max={100} step={0.1} onChange={(value) => updatePlan("workWalkingDistanceKm", value)} />
              <NumberField label={uk ? "Швидкість ходьби на роботі" : "Work walking speed"} unit={uk ? "км/год" : "km/h"} value={plan.workWalkingSpeedKmh} min={0.1} max={15} step={0.1} onChange={(value) => updatePlan("workWalkingSpeedKmh", value)} />
            </div>}
          </fieldset>
        </form>}
        <div className={styles.runRow}>
          <button className={styles.runButton} type="button" aria-busy={busy} disabled={busy} onClick={() => void runForecast()}>{loading ? (uk ? "Запустити оновлений прогноз" : "Run updated forecast") : (uk ? "Побудувати прогноз" : "Run forecast")}</button><HelpTip>{uk ? "Оберіть період і режим, заповніть поля плану за потреби, а потім натисніть кнопку. Після зміни налаштувань графік треба запустити знову." : "Choose a horizon and mode, fill plan fields if needed, then press the button. Run it again after changing settings."}</HelpTip>
          {showRecalculate && <button className={needsRecalculation ? styles.recalculateButtonPrimary : styles.recalculateButton} type="button" aria-busy={actionLoading === "recalculate"} disabled={busy} onClick={() => void runAction("recalculate")}>{actionLoading === "recalculate" ? recalculateCopy.loadingAction : recalculateCopy.action}</button>}
        </div>
        {showRecalculate && <p className={styles.recalculateHint}>{recalculateCopy.hint}</p>}
      </section>

      <section className={`${styles.readinessCard} ${styles[readiness.level]}`} aria-label={uk ? "Наскільки зрозумілий прогноз" : "How clear the forecast is"}>
        <div className={styles.readinessScore}><strong>{readiness.score ?? "—"}</strong><span>/ 100</span></div>
        <div><p className={styles.eyebrow}>{readiness.canForecast ? (uk ? "Прогноз можна побудувати" : "Forecast can run") : (uk ? "Чому прогнозу ще немає" : "Why there is no forecast yet")}</p><h2>{readiness.title}</h2><p>{readiness.detail}</p><ul>{readiness.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul></div>
      </section>

      {error && showStartModel && <section className={styles.blocked} role="alert">
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

      {error && !showStartModel && <section className={styles.blocked} role="alert"><p className={styles.eyebrow}>{uk ? "Прогноз недоступний" : "Forecast unavailable"}</p><h2>{uk ? "Цей варіант поки неможливо порахувати." : "We can’t calculate this option yet."}</h2><p>{error}</p><div className={styles.actions}>{mode === "recent-behavior" && <button type="button" onClick={() => selectMode("target-centered")}>{uk ? "Спробувати план з відхиленнями" : "Try a plan with drift"}</button>}<Link href="/history">{uk ? "Додати дані" : "Add data"}</Link></div></section>}

      {!error && blockedOutcome && blockedCopy && <section className={styles.blocked}><p className={styles.eyebrow}>{uk ? "Потрібна поточна вага моделі" : "Current model weight needed"}</p><h2>{blockedCopy.title}</h2><p>{blockedCopy.detail}</p><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void runAction("recover")}>{uk ? "Закрити пропуск у даних" : "Close the data gap"}</button><button type="button" disabled={busy} onClick={() => void runAction("recalculate")}>{recalculateCopy.action}</button><Link href="/history">{uk ? "Переглянути історію" : "Review history"}</Link></div></section>}

      {loading && !outcome && !error && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>{uk ? "Рахуємо можливі варіанти ваги" : "Calculating possible weight paths"}</strong><span>{uk ? "Кожен варіант стартує від вашої останньої зрозумілої ваги." : "Each path starts from your latest understood weight."}</span></section>}
      {!loading && !outcome && !error && <section className={styles.pendingCard}><strong>{uk ? "Налаштування змінено" : "Settings changed"}</strong><span>{uk ? "Натисніть «Побудувати прогноз», щоб оновити картинку." : "Tap “Run forecast” to refresh the chart."}</span></section>}

      {result && endpoint && <>
        {quality && <section className={`${styles.qualityBanner} ${styles[quality.tone]}`}><div><strong>{quality.title}</strong><span>{quality.detail}</span></div><span>{result.scenarioProvenance.donorEvidence.donorDayCount} {uk ? "днів з даними" : "days with data"}</span></section>}
        <section className={styles.summaryGrid}>
          <article><span>{uk ? `Очікувана метрика «${metricLabel.toLowerCase()}» на ${formatDate(result.dates.at(-1)!.date, undefined, locale)}` : `Expected ${metricLabel.toLowerCase()} on ${formatDate(result.dates.at(-1)!.date, undefined, locale)}`}</span><strong>{formatValue(endpoint.median, "kg", locale)}</strong><small>{uk ? "Медіанна оцінка" : "Median estimate"}</small></article>
          <article><span>{uk ? "Імовірний діапазон" : "Likely range"}<HelpTip>{uk ? "Межі 25–75%: половина змодельованих траєкторій опинилася всередині. Це не гарантія і не весь можливий діапазон." : "The 25th–75th percentile range: half of modeled paths landed inside. It is not a guarantee or the full possible range."}</HelpTip></span><strong>{formatValue(endpoint.p25, "kg", locale)}–{formatValue(endpoint.p75, "kg", locale)}</strong><small>{uk ? "Середня половина варіантів" : "Middle half of the options"}</small></article>
          <article><span>{uk ? "Ширший можливий діапазон" : "Wider possible range"}</span><strong>{formatValue(endpoint.p05, "kg", locale)}–{formatValue(endpoint.p95, "kg", locale)}</strong><small>{uk ? "Більшість варіантів (близько 9 з 10)" : "Most options (about 9 in 10)"}</small></article>
          <article><span>{uk ? "Очікувана зміна ваги" : "Expected weight change"}</span><strong>{metric === "physiologicalBodyWeightKg" && startWeight !== null ? `${endpoint.median - startWeight >= 0 ? "+" : ""}${new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 1 }).format(endpoint.median - startWeight)} kg` : "—"}</strong><small>{metric === "physiologicalBodyWeightKg" ? (uk ? "Від поточної оцінки моделі" : "From the current model estimate") : (uk ? "Показується в режимі ваги" : "Shown for weight view")}</small></article>
        </section>
        <section className={styles.chartPanel}>
          <div className={styles.chartHeader}><div><p className={styles.eyebrow}>{uk ? "Минуле (пораховано) → майбутнє" : "Past (calculated) → future"}</p><h2>{uk ? "Як може змінюватись тіло" : "How the body may change"}</h2></div><div className={styles.metricTabs}>{metrics.map((item) => <button type="button" key={item.key} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div></div>
          <div className={styles.legend}><span><i className={styles.historyKey} />{uk ? "Пораховане минуле" : "Calculated past"}</span><span><i className={styles.medianKey} />{uk ? "Найімовірніше" : "Most likely"}</span><span><i className={styles.innerKey} />{uk ? "Імовірно 25–75%" : "Likely 25–75%"}</span><span><i className={styles.outerKey} />{uk ? "Можливо 5–95%" : "Possible 5–95%"}</span></div>
          <ForecastChart result={result} metric={metric} history={context?.history ?? []} locale={locale} />
          <p className={styles.chartNote}>{uk ? "Суцільна лінія — найімовірніша оцінка ваги всередині. Смужки — діапазон «можливо так»; вони не враховують похибку вагів і всі можливі помилки моделі." : "The solid line is the most likely internal weight estimate. The bands are a “maybe around here” range; they do not include scale noise or every possible model error."}</p>
        </section>
        <section className={styles.detailGrid}>
          <article><h2>{uk ? "Енергія в кінці періоду" : "Energy at the end"}</h2><dl><div><dt>{uk ? "Скільки з’їли (очікувано)" : "Expected intake"}</dt><dd>{formatValue(result.dates.at(-1)!.energyIntakeKcal.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Скільки витратили за день" : "Daily burn"}</dt><dd>{formatValue(result.dates.at(-1)!.tdeeKcalPerDay.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Базовий обмін у спокої" : "Resting burn"}</dt><dd>{formatValue(result.dates.at(-1)!.dynamicRmrKcalPerDay.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Витрати на рух" : "Movement burn"}</dt><dd>{formatValue(result.dates.at(-1)!.netActivityKcalPerDay.median, "kcal", locale)}</dd></div></dl></article>
          <article><h2>{uk ? "Що ми припустили в цьому розрахунку" : "What this run assumes"}</h2><ul>{assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}<li>{uk ? "Невизначеність стартової ваги" : "Starting-weight uncertainty"}: {result.diagnostics.uncertaintySources.initialState ? (uk ? "враховано" : "included") : (uk ? "не потрібна" : "not needed")}.</li><li>{uk ? "Невизначеність майбутніх звичок" : "Future-habit uncertainty"}: {result.diagnostics.uncertaintySources.futureBehavior ? (uk ? "враховано" : "included") : (uk ? "не враховано" : "not included")}.</li><li>{uk ? "Похибку вагів і всі можливі помилки моделі поки не враховано." : "Scale noise and every possible model error are not included yet."}</li></ul></article>
        </section>
        <details className={styles.diagnostics}><summary>{uk ? "Технічна діагностика" : "Technical diagnostics"}</summary><dl><div><dt>{uk ? "Версія прогнозу" : "Forecast version"}</dt><dd>{result.forecastVersion}</dd></div><div><dt>{uk ? "Валідні траєкторії" : "Valid paths"}</dt><dd>{result.diagnostics.validPathCount} / {result.diagnostics.generatedPathCount}</dd></div><div><dt>{uk ? "Початкові стани" : "Starting states"}</dt><dd>{result.diagnostics.startingParticleCount}</dd></div><div><dt>{uk ? "Джерело даних" : "Evidence source"}</dt><dd>{result.scenarioProvenance.donorEvidence.source}</dd></div><div><dt>{uk ? "Числова якість" : "Numerical quality"}</dt><dd>{result.diagnostics.numericalQuality.classification}</dd></div><div><dt>{uk ? "Відбиток" : "Fingerprint"}</dt><dd>{result.sourceFingerprint.slice(0, 16)}…</dd></div></dl></details>
      </>}
    </main>
  );
}
