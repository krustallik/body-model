"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import type { ModelStatusDto, UnknownIntervalDto } from "@/modules/model-episodes/model-episode.types";
import type { ForecastBlockedResult, ForecastResult } from "@/modules/model-forecast/forecast.types";
import {
  buildForecastRequest,
  blockedPresentation,
  DEFAULT_PLAN,
  FORECAST_HORIZONS,
  formatDate,
  formatValue,
  qualityPresentation,
  summarizeEndpoint,
  type ForecastHorizon,
  type ForecastMetric,
  type PlanValues,
  type ScenarioMode,
} from "@/modules/model-forecast/forecast-ui";
import { ForecastChart } from "./forecast-chart";
import styles from "./forecast.module.css";

type HistoricalDay = { date: string; modeledWeightKg: number | null; fatMassKg: number | null; leanTissueKg: number | null; glycogenKg: number | null; dataQuality: string };
type Context = { status: ModelStatusDto; history: HistoricalDay[]; unknownIntervals: UnknownIntervalDto[] };
type Outcome = ForecastResult | ForecastBlockedResult;

const scenarios: Array<{ mode: ScenarioMode; label: string; hint: string }> = [
  { mode: "recent-behavior", label: "Recent routine", hint: "Resamples reliable blocks from recent observed days." },
  { mode: "fixed", label: "Exact daily plan", hint: "Repeats the plan exactly; future-behavior variation is intentionally off." },
  { mode: "target-centered", label: "Flexible plan", hint: "Centers on your plan while preserving realistic day-to-day variation." },
];
const metrics: Array<{ key: ForecastMetric; label: string }> = [
  { key: "physiologicalBodyWeightKg", label: "Weight" },
  { key: "fatMassKg", label: "Fat" },
  { key: "leanTissueKg", label: "Lean tissue" },
  { key: "glycogenAssociatedMassKg", label: "Glycogen + water" },
];

async function errorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = await response.json() as { error?: string; message?: string; details?: Array<{ message?: string }> };
    return body.message ?? body.details?.[0]?.message ?? body.error?.replaceAll("_", " ") ?? fallback;
  } catch { return fallback; }
}

function NumberField({ label, value, onChange, min = 0, max, step = 1, unit }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  return <label className={styles.field}><span>{label}{unit ? ` (${unit})` : ""}</span><input type="number" value={value} min={min} max={max} step={step} required onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
}

export function ForecastClient() {
  const [horizon, setHorizon] = useState<ForecastHorizon>(30);
  const [mode, setMode] = useState<ScenarioMode>("recent-behavior");
  const [metric, setMetric] = useState<ForecastMetric>("physiologicalBodyWeightKg");
  const [plan, setPlan] = useState<PlanValues>(DEFAULT_PLAN);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const runForecast = useCallback(async (selectedMode = mode, selectedHorizon = horizon, selectedPlan = plan) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    setOutcome(null);
    try {
      const [forecastResponse, contextResponse] = await Promise.all([
        fetch("/api/forecast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildForecastRequest(selectedMode, selectedHorizon, selectedPlan)), signal: controller.signal }),
        fetch("/api/forecast/context", { cache: "no-store", signal: controller.signal }),
      ]);
      if (!forecastResponse.ok) throw new Error(await errorMessage(forecastResponse));
      const nextOutcome = await forecastResponse.json() as Outcome;
      const nextContext = contextResponse.ok ? await contextResponse.json() as Context : null;
      if (requestId === requestRef.current) { setOutcome(nextOutcome); setContext(nextContext); }
    } catch (runError) {
      if (controller.signal.aborted) return;
      if (requestId === requestRef.current) setError(runError instanceof Error ? runError.message : "Could not run forecast");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [horizon, mode, plan]);

  useEffect(() => {
    const initialRequest = window.setTimeout(() => void runForecast("recent-behavior", 30, DEFAULT_PLAN), 0);
    return () => {
      window.clearTimeout(initialRequest);
      controllerRef.current?.abort();
    };
  // Intentional: initial default run only. Later changes require the explicit button.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updatePlan<K extends keyof PlanValues>(key: K, value: PlanValues[K]) { setPlan((current) => ({ ...current, [key]: value })); }
  async function runAction(action: "recover" | "recalculate") {
    setLoading(true); setError(null);
    const response = await fetch("/api/forecast/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!response.ok) { setError(await errorMessage(response)); setLoading(false); return; }
    await runForecast();
  }

  const result = outcome?.status === "ok" || outcome?.status === "degraded" || outcome?.status === "insufficient-scenario-evidence" ? outcome : null;
  const blockedOutcome = outcome?.status === "initial-state-unreliable" || outcome?.status === "initial-state-unavailable" ? outcome : null;
  const blockedCopy = blockedOutcome ? blockedPresentation(blockedOutcome) : null;
  const endpoint = result ? summarizeEndpoint(result, metric) : null;
  const startWeight = context?.status.currentPredictedWeightKg ?? context?.status.currentFilteredWeightKg ?? null;
  const quality = result ? qualityPresentation(result) : null;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>Physiology forecast</span></Link><AppNav active="forecast" /></div>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>Forward model · not a promise</p><h1>See the range, not just a line.</h1><p>Explore how routine choices may change weight and body composition. Bands show model uncertainty, not guaranteed outcomes.</p></div>
        <div className={styles.readiness}><span className={result ? styles.readyDot : styles.waitingDot} />{loading ? "Calculating paths…" : quality?.title ?? "Needs attention"}</div>
      </header>

      <section className={styles.controlPanel} aria-label="Forecast controls">
        <div className={styles.controlGroup}><div><strong>Time horizon</strong><span>Longer forecasts naturally spread out.</span></div><div className={styles.segmented}>{FORECAST_HORIZONS.map((days) => <button type="button" key={days} aria-pressed={horizon === days} onClick={() => setHorizon(days)}>{days < 365 ? `${days}d` : "1y"}</button>)}</div></div>
        <div className={styles.controlGroup}><div><strong>Future routine</strong><span>{scenarios.find((item) => item.mode === mode)?.hint}</span></div><div className={styles.scenarioGrid}>{scenarios.map((scenario) => <button type="button" key={scenario.mode} aria-pressed={mode === scenario.mode} onClick={() => setMode(scenario.mode)}><strong>{scenario.label}</strong><span>{scenario.mode === "fixed" ? "No adherence variation" : scenario.mode === "recent-behavior" ? "Uses your evidence" : "Includes adherence"}</span></button>)}</div></div>

        {mode !== "recent-behavior" && <form className={styles.planForm} onSubmit={(event: FormEvent) => { event.preventDefault(); void runForecast(); }}>
          <fieldset><legend>Daily nutrition</legend><div className={styles.formGrid}>
            <NumberField label="Energy" unit="kcal" value={plan.caloriesKcal} max={20000} onChange={(value) => updatePlan("caloriesKcal", value)} />
            <NumberField label="Protein" unit="g" value={plan.proteinG} max={1000} onChange={(value) => updatePlan("proteinG", value)} />
            <NumberField label="Fat" unit="g" value={plan.fatG} max={1000} onChange={(value) => updatePlan("fatG", value)} />
            <NumberField label="Carbs" unit="g" value={plan.carbsG} max={2000} onChange={(value) => updatePlan("carbsG", value)} />
          </div></fieldset>
          <fieldset><legend>Movement & training</legend><div className={styles.formGrid}>
            <NumberField label="Walking outside work" unit="km" value={plan.outsideWorkWalkingDistanceKm} max={100} step={0.1} onChange={(value) => updatePlan("outsideWorkWalkingDistanceKm", value)} />
            <NumberField label="Walking speed" unit="km/h" value={plan.averageWalkingSpeedKmh} min={0.1} max={15} step={0.1} onChange={(value) => updatePlan("averageWalkingSpeedKmh", value)} />
            <NumberField label="Strength days" unit="per week" value={plan.strengthDaysPerWeek} max={7} onChange={(value) => updatePlan("strengthDaysPerWeek", value)} />
            <NumberField label="Strength session" unit="min" value={plan.strengthTrainingMinutes} max={600} onChange={(value) => updatePlan("strengthTrainingMinutes", value)} />
          </div></fieldset>
          <fieldset><legend>Planned work</legend><label className={styles.toggle}><input type="checkbox" checked={plan.plannedWork} onChange={(event) => updatePlan("plannedWork", event.currentTarget.checked)} /><span>Include this shift Monday–Friday</span></label>
            {plan.plannedWork && <div className={styles.formGrid}>
              <label className={styles.field}><span>Work intensity</span><select value={plan.workCategory} onChange={(event) => updatePlan("workCategory", event.currentTarget.value as PlanValues["workCategory"])}><option value="standingLight">Very light / mostly waiting</option><option value="manualLight">Light handling / packing</option><option value="standingLightModerate">Active light manual work</option><option value="manualModerate">Moderate handling</option></select></label>
              <NumberField label="Shift" unit="hours" value={plan.shiftHours} min={0.1} max={24} step={0.25} onChange={(value) => updatePlan("shiftHours", value)} />
              <NumberField label="Breaks" unit="hours" value={plan.breakHours} max={plan.shiftHours} step={0.25} onChange={(value) => updatePlan("breakHours", value)} />
              <NumberField label="Walking at work" unit="km" value={plan.workWalkingDistanceKm} max={100} step={0.1} onChange={(value) => updatePlan("workWalkingDistanceKm", value)} />
              <NumberField label="Work walking speed" unit="km/h" value={plan.workWalkingSpeedKmh} min={0.1} max={15} step={0.1} onChange={(value) => updatePlan("workWalkingSpeedKmh", value)} />
            </div>}
          </fieldset>
        </form>}
        <button className={styles.runButton} type="button" disabled={loading} onClick={() => void runForecast()}>{loading ? "Simulating 512 paths…" : "Run forecast"}</button>
      </section>

      {error && <section className={styles.blocked} role="alert"><p className={styles.eyebrow}>Forecast unavailable</p><h2>We can’t calculate this scenario yet.</h2><p>{error}</p><div className={styles.actions}>{mode === "recent-behavior" && <button type="button" onClick={() => setMode("target-centered")}>Use a flexible plan</button>}<Link href="/history">Add observations</Link></div></section>}

      {!error && blockedOutcome && blockedCopy && <section className={styles.blocked}><p className={styles.eyebrow}>Current state required</p><h2>{blockedCopy.title}</h2><p>{blockedCopy.detail}</p><div className={styles.actions}><button type="button" disabled={loading} onClick={() => void runAction("recover")}>Recover current state</button><button type="button" disabled={loading} onClick={() => void runAction("recalculate")}>Update model</button><Link href="/history">Review history</Link></div></section>}

      {loading && !outcome && !error && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>Building a distribution of possible paths</strong><span>Each path starts from the latest physiological state.</span></section>}

      {result && endpoint && <>
        {quality && <section className={`${styles.qualityBanner} ${styles[quality.tone]}`}><div><strong>{quality.title}</strong><span>{quality.detail}</span></div><span>{result.scenarioProvenance.donorEvidence.donorDayCount} evidence days</span></section>}
        <section className={styles.summaryGrid}>
          <article><span>Expected on {formatDate(result.dates.at(-1)!.date)}</span><strong>{formatValue(endpoint.median)}</strong><small>Median estimate</small></article>
          <article><span>Likely range</span><strong>{formatValue(endpoint.p25)}–{formatValue(endpoint.p75)}</strong><small>Middle 50% of model paths</small></article>
          <article><span>Wider possible range</span><strong>{formatValue(endpoint.p05)}–{formatValue(endpoint.p95)}</strong><small>Middle 90% of model paths</small></article>
          <article><span>Expected weight change</span><strong>{metric === "physiologicalBodyWeightKg" && startWeight !== null ? `${endpoint.median - startWeight >= 0 ? "+" : ""}${(endpoint.median - startWeight).toFixed(1)} kg` : "—"}</strong><small>{metric === "physiologicalBodyWeightKg" ? "From current modeled state" : "Shown for weight view"}</small></article>
        </section>
        <section className={styles.chartPanel}>
          <div className={styles.chartHeader}><div><p className={styles.eyebrow}>Modeled history → forecast</p><h2>Body trajectory</h2></div><div className={styles.metricTabs}>{metrics.map((item) => <button type="button" key={item.key} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div></div>
          <div className={styles.legend}><span><i className={styles.historyKey} />Modeled history</span><span><i className={styles.medianKey} />Expected estimate</span><span><i className={styles.innerKey} />Likely 25–75%</span><span><i className={styles.outerKey} />Possible 5–95%</span></div>
          <ForecastChart result={result} metric={metric} history={context?.history ?? []} />
          <p className={styles.chartNote}>The solid line is the median latent physiological estimate. Shaded intervals describe simulated model paths; they do not include measurement noise or every possible model error.</p>
        </section>
        <section className={styles.detailGrid}>
          <article><h2>Energy at the endpoint</h2><dl><div><dt>Expected intake</dt><dd>{formatValue(result.dates.at(-1)!.energyIntakeKcal.median, "kcal")}</dd></div><div><dt>Expected TDEE</dt><dd>{formatValue(result.dates.at(-1)!.tdeeKcalPerDay.median, "kcal")}</dd></div><div><dt>Expected RMR</dt><dd>{formatValue(result.dates.at(-1)!.dynamicRmrKcalPerDay.median, "kcal")}</dd></div><div><dt>Net activity</dt><dd>{formatValue(result.dates.at(-1)!.netActivityKcalPerDay.median, "kcal")}</dd></div></dl></article>
          <article><h2>What this run assumes</h2><ul><li>{result.scenarioProvenance.mode === "fixed" ? "The entered daily plan is followed exactly." : result.scenarioProvenance.mode === "recent-behavior" ? "Reliable recent days are resampled in connected blocks." : "Daily behavior varies around your targets."}</li><li>Initial-state uncertainty: {result.diagnostics.uncertaintySources.initialState ? "included" : "not required"}.</li><li>Future-behavior uncertainty: {result.diagnostics.uncertaintySources.futureBehavior ? "included" : "not included"}.</li><li>Measurement and parameter uncertainty are not yet included.</li></ul></article>
        </section>
        <details className={styles.diagnostics}><summary>Technical diagnostics</summary><dl><div><dt>Forecast version</dt><dd>{result.forecastVersion}</dd></div><div><dt>Valid paths</dt><dd>{result.diagnostics.validPathCount} / {result.diagnostics.generatedPathCount}</dd></div><div><dt>Starting states</dt><dd>{result.diagnostics.startingParticleCount}</dd></div><div><dt>Evidence source</dt><dd>{result.scenarioProvenance.donorEvidence.source}</dd></div><div><dt>Numerical quality</dt><dd>{result.diagnostics.numericalQuality.classification}</dd></div><div><dt>Fingerprint</dt><dd>{result.sourceFingerprint.slice(0, 16)}…</dd></div></dl></details>
      </>}
    </main>
  );
}
