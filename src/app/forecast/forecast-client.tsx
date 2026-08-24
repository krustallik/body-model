"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
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
  qualityPresentation,
  isCurrentForecastRequest,
  planAssumptions,
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

async function forecastError(response: Response, locale: Locale): Promise<{ message: string; code: string | null; donorDayCount?: number }> {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = await response.json() as { error?: string; message?: string; details?: Array<{ message?: string }> };
    const raw = body.message ?? body.details?.[0]?.message ?? body.error?.replaceAll("_", " ") ?? fallback;
    const received = /received\s+(\d+)/i.exec(raw)?.[1];
    const messages: Record<string, string> = locale === "uk" ? {
      no_active_episode: "Немає активної моделі. Додайте історичні дані та запустіть розрахунок моделі.",
      insufficient_scenario_evidence: "Для сценарію «Останній режим» потрібно щонайменше 14 повних і надійних днів. Оберіть плановий сценарій або додайте дані.",
      recovery_required: "Спочатку потрібно відновити поточний стан після пропуску в історії.",
    } : {};
    return { message: (body.error && messages[body.error]) || raw, code: body.error ?? null, ...(received ? { donorDayCount: Number(received) } : {}) };
  } catch { return { message: fallback, code: null }; }
}

function NumberField({ label, value, onChange, min = 0, max, step = 1, unit }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  return <label className={styles.field}><span>{label}{unit ? ` (${unit})` : ""}</span><input type="number" value={value} min={min} max={max} step={step} required onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
}

export function ForecastClient() {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const scenarios: Array<{ mode: ScenarioMode; label: string; hint: string }> = [
    { mode: "recent-behavior", label: uk ? "Останній режим" : "Recent routine", hint: uk ? "Використовує надійні блоки з останніх спостережених днів." : "Resamples reliable blocks from recent observed days." },
    { mode: "fixed", label: uk ? "Точний денний план" : "Exact daily plan", hint: uk ? "Повторює план без варіації майбутньої поведінки." : "Repeats the plan exactly; future-behavior variation is intentionally off." },
    { mode: "target-centered", label: uk ? "Гнучкий план" : "Flexible plan", hint: uk ? "Зберігає реалістичні щоденні відхилення навколо вашого плану." : "Centers on your plan while preserving realistic day-to-day variation." },
  ];
  const metrics: Array<{ key: ForecastMetric; label: string }> = [
    { key: "physiologicalBodyWeightKg", label: uk ? "Вага" : "Weight" },
    { key: "fatMassKg", label: uk ? "Жирова маса" : "Fat" },
    { key: "leanTissueKg", label: uk ? "Безжирова тканина" : "Lean tissue estimate" },
    { key: "glycogenAssociatedMassKg", label: uk ? "Глікоген + вода" : "Glycogen + water" },
  ];
  const [horizon, setHorizon] = useState<ForecastHorizon>(30);
  const [mode, setMode] = useState<ScenarioMode>("recent-behavior");
  const [metric, setMetric] = useState<ForecastMetric>("physiologicalBodyWeightKg");
  const [plan, setPlan] = useState<PlanValues>(DEFAULT_PLAN);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [submittedRun, setSubmittedRun] = useState<SubmittedRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    setScenarioEvidenceMissing(false);
    setOutcome(null);
    try {
      const [forecastResponse, contextResponse] = await Promise.all([
        fetch("/api/forecast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildForecastRequest(selectedMode, selectedHorizon, selectedPlan)), signal: controller.signal }),
        fetch("/api/forecast/context", { cache: "no-store", signal: controller.signal }),
      ]);
      const nextContext = contextResponse.ok ? await contextResponse.json() as Context : null;
      if (isCurrentForecastRequest(requestRef.current, requestId)) setContext(nextContext);
      if (!forecastResponse.ok) {
        const issue = await forecastError(forecastResponse, locale);
        if (isCurrentForecastRequest(requestRef.current, requestId)) {
          setScenarioEvidenceMissing(issue.code === "insufficient_scenario_evidence");
          if (issue.donorDayCount !== undefined) setKnownDonorDayCount(issue.donorDayCount);
        }
        throw new Error(issue.message);
      }
      const nextOutcome = await forecastResponse.json() as Outcome;
      if (isCurrentForecastRequest(requestRef.current, requestId)) {
        setOutcome(nextOutcome);
        setContext(nextContext);
        setSubmittedRun({ mode: selectedMode, horizon: selectedHorizon, plan: { ...selectedPlan } });
        if ("scenarioProvenance" in nextOutcome) setKnownDonorDayCount(nextOutcome.scenarioProvenance.donorEvidence.donorDayCount);
      }
    } catch (runError) {
      if (controller.signal.aborted) return;
      if (isCurrentForecastRequest(requestRef.current, requestId)) setError(runError instanceof Error ? runError.message : uk ? "Не вдалося побудувати прогноз" : "Could not run forecast");
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
    setScenarioEvidenceMissing(false);
    setSubmittedRun(null);
  }
  function selectHorizon(next: ForecastHorizon) { setHorizon(next); invalidateDisplayedForecast(); }
  function selectMode(next: ScenarioMode) { setMode(next); invalidateDisplayedForecast(); }
  function updatePlan<K extends keyof PlanValues>(key: K, value: PlanValues[K]) {
    setPlan((current) => ({ ...current, [key]: value }));
    invalidateDisplayedForecast();
  }
  async function runAction(action: "recover" | "recalculate") {
    setLoading(true); setError(null);
    const response = await fetch("/api/forecast/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!response.ok) { setError((await forecastError(response, locale)).message); setLoading(false); return; }
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
    : [uk ? "Надійні останні дні повторно вибираються зв’язаними блоками." : "Reliable recent days are resampled in connected blocks."];
  const readiness = forecastReadiness({
    status: context?.status ?? null,
    locale,
    mode,
    donorDayCount: result?.scenarioProvenance.donorEvidence.donorDayCount ?? knownDonorDayCount,
    successfulForecast: Boolean(result),
    blocked: Boolean(blockedOutcome),
    scenarioEvidenceMissing,
  });

  return (
    <main className={styles.page}>
      <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Прогноз фізіології" : "Physiology forecast"}</span></Link><AppNav active="forecast" /></div>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>{uk ? "Модель майбутнього · не обіцянка" : "Forward model · not a promise"}</p><h1>{uk ? "Дивіться на діапазон, а не лише на лінію." : "See the range, not just a line."}</h1><p>{uk ? "Досліджуйте, як режим може змінити вагу й склад тіла. Діапазони показують невизначеність моделі, а не гарантований результат." : "Explore how routine choices may change weight and body composition. Bands show model uncertainty, not guaranteed outcomes."}</p></div>
        <div className={styles.readiness}><span className={result ? styles.readyDot : styles.waitingDot} />{loading ? (uk ? "Розраховуємо траєкторії…" : "Calculating paths…") : quality?.title ?? (uk ? "Потрібна увага" : "Needs attention")}</div>
      </header>

      <section className={styles.controlPanel} aria-label={uk ? "Налаштування прогнозу" : "Forecast controls"}>
        <div className={styles.controlGroup}><div><strong>{uk ? "Горизонт прогнозу" : "Time horizon"}</strong><span>{uk ? "Що довший прогноз, то ширший природний діапазон." : "Longer forecasts naturally spread out."}</span></div><div className={styles.segmented}>{FORECAST_HORIZONS.map((days) => <button type="button" key={days} aria-pressed={horizon === days} onClick={() => selectHorizon(days)}>{days < 365 ? `${days}${uk ? "д" : "d"}` : (uk ? "1р" : "1y")}</button>)}</div></div>
        <div className={styles.controlGroup}><div><strong>{uk ? "Майбутній режим" : "Future routine"}</strong><span>{scenarios.find((item) => item.mode === mode)?.hint}</span></div><div className={styles.scenarioGrid}>{scenarios.map((scenario) => <button type="button" key={scenario.mode} aria-pressed={mode === scenario.mode} onClick={() => selectMode(scenario.mode)}><strong>{scenario.label}</strong><span>{scenario.mode === "fixed" ? (uk ? "Без відхилень від плану" : "No adherence variation") : scenario.mode === "recent-behavior" ? (uk ? "На основі ваших даних" : "Uses your evidence") : (uk ? "З урахуванням реальних відхилень" : "Includes adherence")}</span></button>)}</div></div>

        {mode !== "recent-behavior" && <form className={styles.planForm} onSubmit={(event: FormEvent) => { event.preventDefault(); void runForecast(); }}>
          <fieldset><legend>{uk ? "Щоденне харчування" : "Daily nutrition"}</legend><div className={styles.formGrid}>
            <NumberField label={uk ? "Енергія" : "Energy"} unit={uk ? "ккал" : "kcal"} value={plan.caloriesKcal} max={20000} onChange={(value) => updatePlan("caloriesKcal", value)} />
            <NumberField label={uk ? "Білки" : "Protein"} unit={uk ? "г" : "g"} value={plan.proteinG} max={1000} onChange={(value) => updatePlan("proteinG", value)} />
            <NumberField label={uk ? "Жири" : "Fat"} unit={uk ? "г" : "g"} value={plan.fatG} max={1000} onChange={(value) => updatePlan("fatG", value)} />
            <NumberField label={uk ? "Вуглеводи" : "Carbs"} unit={uk ? "г" : "g"} value={plan.carbsG} max={2000} onChange={(value) => updatePlan("carbsG", value)} />
          </div></fieldset>
          <fieldset><legend>{uk ? "Рух і тренування" : "Movement & training"}</legend><div className={styles.formGrid}>
            <NumberField label={uk ? "Ходьба поза роботою" : "Walking outside work"} unit={uk ? "км" : "km"} value={plan.outsideWorkWalkingDistanceKm} max={100} step={0.1} onChange={(value) => updatePlan("outsideWorkWalkingDistanceKm", value)} />
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
        <button className={styles.runButton} type="button" aria-busy={loading} onClick={() => void runForecast()}>{loading ? (uk ? "Запустити оновлений прогноз" : "Run updated forecast") : (uk ? "Побудувати прогноз" : "Run forecast")}</button>
      </section>

      <section className={`${styles.readinessCard} ${styles[readiness.level]}`} aria-label={uk ? "Оцінка якості прогнозу" : "Forecast quality assessment"}>
        <div className={styles.readinessScore}><strong>{readiness.score}</strong><span>/ 100</span></div>
        <div><p className={styles.eyebrow}>{readiness.canForecast ? (uk ? "Прогноз доступний" : "Forecast available") : (uk ? "Чому прогноз недоступний" : "Why forecasting is unavailable")}</p><h2>{readiness.title}</h2><p>{readiness.detail}</p><ul>{readiness.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul></div>
      </section>

      {error && <section className={styles.blocked} role="alert"><p className={styles.eyebrow}>{uk ? "Прогноз недоступний" : "Forecast unavailable"}</p><h2>{uk ? "Цей сценарій поки неможливо розрахувати." : "We can’t calculate this scenario yet."}</h2><p>{error}</p><div className={styles.actions}>{mode === "recent-behavior" && <button type="button" onClick={() => selectMode("target-centered")}>{uk ? "Спробувати гнучкий план" : "Use a flexible plan"}</button>}<Link href="/history">{uk ? "Додати спостереження" : "Add observations"}</Link></div></section>}

      {!error && blockedOutcome && blockedCopy && <section className={styles.blocked}><p className={styles.eyebrow}>{uk ? "Потрібен поточний стан" : "Current state required"}</p><h2>{blockedCopy.title}</h2><p>{blockedCopy.detail}</p><div className={styles.actions}><button type="button" disabled={loading} onClick={() => void runAction("recover")}>{uk ? "Відновити поточний стан" : "Recover current state"}</button><button type="button" disabled={loading} onClick={() => void runAction("recalculate")}>{uk ? "Оновити модель" : "Update model"}</button><Link href="/history">{uk ? "Переглянути історію" : "Review history"}</Link></div></section>}

      {loading && !outcome && !error && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>{uk ? "Будуємо розподіл можливих траєкторій" : "Building a distribution of possible paths"}</strong><span>{uk ? "Кожна траєкторія починається з останнього фізіологічного стану." : "Each path starts from the latest physiological state."}</span></section>}
      {!loading && !outcome && !error && <section className={styles.pendingCard}><strong>{uk ? "Налаштування змінено" : "Settings changed"}</strong><span>{uk ? "Запустіть прогноз, щоб оновити траєкторію та підсумок." : "Run the forecast to update the trajectory and endpoint summary."}</span></section>}

      {result && endpoint && <>
        {quality && <section className={`${styles.qualityBanner} ${styles[quality.tone]}`}><div><strong>{quality.title}</strong><span>{quality.detail}</span></div><span>{result.scenarioProvenance.donorEvidence.donorDayCount} {uk ? "днів даних" : "evidence days"}</span></section>}
        <section className={styles.summaryGrid}>
          <article><span>{uk ? `Очікувана метрика «${metricLabel.toLowerCase()}» на ${formatDate(result.dates.at(-1)!.date, undefined, locale)}` : `Expected ${metricLabel.toLowerCase()} on ${formatDate(result.dates.at(-1)!.date, undefined, locale)}`}</span><strong>{formatValue(endpoint.median, "kg", locale)}</strong><small>{uk ? "Медіанна оцінка" : "Median estimate"}</small></article>
          <article><span>{uk ? "Імовірний діапазон" : "Likely range"}</span><strong>{formatValue(endpoint.p25, "kg", locale)}–{formatValue(endpoint.p75, "kg", locale)}</strong><small>{uk ? "Середні 50% траєкторій моделі" : "Middle 50% of model paths"}</small></article>
          <article><span>{uk ? "Ширший можливий діапазон" : "Wider possible range"}</span><strong>{formatValue(endpoint.p05, "kg", locale)}–{formatValue(endpoint.p95, "kg", locale)}</strong><small>{uk ? "Середні 90% траєкторій моделі" : "Middle 90% of model paths"}</small></article>
          <article><span>{uk ? "Очікувана зміна ваги" : "Expected weight change"}</span><strong>{metric === "physiologicalBodyWeightKg" && startWeight !== null ? `${endpoint.median - startWeight >= 0 ? "+" : ""}${new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 1 }).format(endpoint.median - startWeight)} kg` : "—"}</strong><small>{metric === "physiologicalBodyWeightKg" ? (uk ? "Від поточного змодельованого стану" : "From current modeled state") : (uk ? "Показується в режимі ваги" : "Shown for weight view")}</small></article>
        </section>
        <section className={styles.chartPanel}>
          <div className={styles.chartHeader}><div><p className={styles.eyebrow}>{uk ? "Змодельована історія → прогноз" : "Modeled history → forecast"}</p><h2>{uk ? "Траєкторія тіла" : "Body trajectory"}</h2></div><div className={styles.metricTabs}>{metrics.map((item) => <button type="button" key={item.key} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div></div>
          <div className={styles.legend}><span><i className={styles.historyKey} />{uk ? "Змодельована історія" : "Modeled history"}</span><span><i className={styles.medianKey} />{uk ? "Очікувана оцінка" : "Expected estimate"}</span><span><i className={styles.innerKey} />{uk ? "Імовірно 25–75%" : "Likely 25–75%"}</span><span><i className={styles.outerKey} />{uk ? "Можливо 5–95%" : "Possible 5–95%"}</span></div>
          <ForecastChart result={result} metric={metric} history={context?.history ?? []} locale={locale} />
          <p className={styles.chartNote}>{uk ? "Суцільна лінія — медіанна прихована фізіологічна оцінка. Заштриховані діапазони описують змодельовані траєкторії; вони не охоплюють шум вимірювань і всі можливі помилки моделі." : "The solid line is the median latent physiological estimate. Shaded intervals describe simulated model paths; they do not include measurement noise or every possible model error."}</p>
        </section>
        <section className={styles.detailGrid}>
          <article><h2>{uk ? "Енергія в кінцевій точці" : "Energy at the endpoint"}</h2><dl><div><dt>{uk ? "Очікуване споживання" : "Expected intake"}</dt><dd>{formatValue(result.dates.at(-1)!.energyIntakeKcal.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Очікуваний TDEE" : "Expected TDEE"}</dt><dd>{formatValue(result.dates.at(-1)!.tdeeKcalPerDay.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Очікуваний RMR" : "Expected RMR"}</dt><dd>{formatValue(result.dates.at(-1)!.dynamicRmrKcalPerDay.median, "kcal", locale)}</dd></div><div><dt>{uk ? "Чиста активність" : "Net activity"}</dt><dd>{formatValue(result.dates.at(-1)!.netActivityKcalPerDay.median, "kcal", locale)}</dd></div></dl></article>
          <article><h2>{uk ? "Припущення цього розрахунку" : "What this run assumes"}</h2><ul>{assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}<li>{uk ? "Невизначеність початкового стану" : "Initial-state uncertainty"}: {result.diagnostics.uncertaintySources.initialState ? (uk ? "включено" : "included") : (uk ? "не потрібна" : "not required")}.</li><li>{uk ? "Невизначеність майбутньої поведінки" : "Future-behavior uncertainty"}: {result.diagnostics.uncertaintySources.futureBehavior ? (uk ? "включено" : "included") : (uk ? "не включено" : "not included")}.</li><li>{uk ? "Невизначеність вимірювань і параметрів поки не включена." : "Measurement and parameter uncertainty are not yet included."}</li></ul></article>
        </section>
        <details className={styles.diagnostics}><summary>{uk ? "Технічна діагностика" : "Technical diagnostics"}</summary><dl><div><dt>{uk ? "Версія прогнозу" : "Forecast version"}</dt><dd>{result.forecastVersion}</dd></div><div><dt>{uk ? "Валідні траєкторії" : "Valid paths"}</dt><dd>{result.diagnostics.validPathCount} / {result.diagnostics.generatedPathCount}</dd></div><div><dt>{uk ? "Початкові стани" : "Starting states"}</dt><dd>{result.diagnostics.startingParticleCount}</dd></div><div><dt>{uk ? "Джерело даних" : "Evidence source"}</dt><dd>{result.scenarioProvenance.donorEvidence.source}</dd></div><div><dt>{uk ? "Числова якість" : "Numerical quality"}</dt><dd>{result.diagnostics.numericalQuality.classification}</dd></div><div><dt>{uk ? "Відбиток" : "Fingerprint"}</dt><dd>{result.sourceFingerprint.slice(0, 16)}…</dd></div></dl></details>
      </>}
    </main>
  );
}
