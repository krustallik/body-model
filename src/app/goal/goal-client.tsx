"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n, type Locale } from "@/i18n/i18n-provider";
import { ForecastChart } from "@/app/forecast/forecast-chart";
import { beginForecastRequest, formatDate, formatValue, isCurrentForecastRequest, type PlanValues } from "@/modules/model-forecast/forecast-ui";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import {
  buildGoalPlanningRequest,
  defaultGoalForm,
  goalStatusPresentation,
  probabilityDefinition,
  roundedPlanCalories,
  type GoalFormErrors,
  type GoalFormValues,
} from "@/modules/model-goal-planning/goal-planning-ui";
import type { GoalPlanningResponse } from "@/modules/model-goal-planning/goal-planning.types";
import styles from "./goal.module.css";

type HistoricalDay = { date: string; modeledWeightKg: number | null; fatMassKg: number | null; leanTissueKg: number | null; glycogenAssociatedMassKg: number | null; dataQuality: string };
type Context = { status: ModelStatusDto; history: HistoricalDay[] };

async function responseError(response: Response, locale: Locale): Promise<string> {
  const uk = locale === "uk";
  try {
    const body = await response.json() as { error?: string; message?: string; details?: Array<{ path?: Array<string | number>; message?: string }> };
    if (body.error === "no_active_episode") return uk ? "Немає активної моделі. Спочатку додайте історичні дані й розрахуйте модель." : "There is no active model. Add history and calculate the model first.";
    if (body.error === "invalid_goal_date") return uk ? "Дата цілі має бути пізнішою за останню змодельовану дату." : "The goal date must be after the latest modeled date.";
    if (body.error === "validation_error") return body.details?.map((issue) => `${issue.path?.join(".") || "request"}: ${issue.message}`).join("; ") || (uk ? "Перевірте введені значення." : "Check the submitted values.");
    return body.message ?? (uk ? "Не вдалося розрахувати сценарій цілі." : "Could not calculate the goal scenario.");
  } catch {
    return uk ? `Запит завершився помилкою (${response.status}).` : `Request failed (${response.status}).`;
  }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <small id={id} className={styles.fieldError}>{message}</small> : null;
}

function TextNumberField({ id, label, value, onChange, error, unit, min, max, step = "any", optional = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; error?: string; unit?: string;
  min?: number; max?: number; step?: number | "any"; optional?: boolean;
}) {
  const errorId = `${id}-error`;
  return <label className={styles.field} htmlFor={id}><span>{label}{unit ? ` (${unit})` : ""}{optional ? " · optional" : ""}</span><input id={id} name={id} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} required={!optional} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => onChange(event.currentTarget.value)} /><FieldError id={errorId} message={error} /></label>;
}

function PlanNumberField({ id, label, value, onChange, unit, min = 0, max, step = 1 }: {
  id: string; label: string; value: number; onChange: (value: number) => void; unit?: string; min?: number; max?: number; step?: number;
}) {
  return <label className={styles.field} htmlFor={id}><span>{label}{unit ? ` (${unit})` : ""}</span><input id={id} type="number" inputMode="decimal" value={Number.isNaN(value) ? "" : value} min={min} max={max} step={step} required onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
}

function percent(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(value);
}

export function GoalClient() {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const [context, setContext] = useState<Context | null>(null);
  const [form, setForm] = useState<GoalFormValues>(() => defaultGoalForm());
  const [initialized, setInitialized] = useState(false);
  const [formErrors, setFormErrors] = useState<GoalFormErrors>({});
  const [result, setResult] = useState<GoalPlanningResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef({ current: 0 });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/forecast/context", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response, locale));
      const next = await response.json() as Context;
      setContext(next);
      setForm(defaultGoalForm(next.status.latestModeledDate, next.status.currentPredictedWeightKg ?? next.status.currentFilteredWeightKg));
      setInitialized(true);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : uk ? "Не вдалося завантажити модель." : "Could not load the model.");
    }).finally(() => { if (!controller.signal.aborted) setLoadingContext(false); });
    return () => { controller.abort(); controllerRef.current?.abort(); };
  }, [locale, uk]);

  function updateForm<K extends keyof GoalFormValues>(key: K, value: GoalFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null); setError(null); setFormErrors({});
  }
  function updatePlan<K extends keyof PlanValues>(key: K, value: PlanValues[K]) {
    setForm((current) => ({ ...current, plan: { ...current.plan, [key]: value } }));
    setResult(null); setError(null); setFormErrors({});
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!context?.status.latestModeledDate) { setError(uk ? "Останній змодельований стан недоступний." : "The latest modeled state is unavailable."); return; }
    const built = buildGoalPlanningRequest(form, context.status.latestModeledDate);
    setFormErrors(built.errors);
    if (!built.request) { setError(uk ? "Перевірте виділені поля." : "Check the highlighted fields."); return; }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = beginForecastRequest(requestRef.current);
    setSolving(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/goal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(built.request), signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response, locale));
      const next = await response.json() as GoalPlanningResponse;
      if (isCurrentForecastRequest(requestRef.current, requestId)) setResult(next);
    } catch (reason) {
      if (!controller.signal.aborted && isCurrentForecastRequest(requestRef.current, requestId)) setError(reason instanceof Error ? reason.message : uk ? "Не вдалося розрахувати ціль." : "Could not calculate the goal.");
    } finally {
      if (isCurrentForecastRequest(requestRef.current, requestId)) setSolving(false);
    }
  }

  const statusCopy = result ? goalStatusPresentation(result.status, locale) : null;
  const displayCalories = result?.control.solvedCaloriesKcal !== null && result?.numerical.practicalResolutionKcal
    ? roundedPlanCalories(result.control.solvedCaloriesKcal, result.numerical.practicalResolutionKcal) : null;
  const showPlanCenter = result && ["solved", "solved-at-boundary", "numerically-limited"].includes(result.status) && displayCalories !== null;
  const probabilityCopy = result ? probabilityDefinition(result, locale) : null;
  const interval = result?.terminal?.attainment.probabilityMonteCarloInterval;

  return <main className={styles.page}>
    <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Планувальник цілі" : "Goal planner"}</span></Link><AppNav active="goal" /></div>
    <header className={styles.hero}><div><p className={styles.eyebrow}>{uk ? "Сценарій · не припис" : "Scenario · not a prescription"}</p><h1>{uk ? "Побудуйте шлях до цілі — разом із невизначеністю." : "Plan toward a target—with uncertainty visible."}</h1><p>{uk ? "BodyCast шукає такий центр харчування, за якого медіанна траєкторія моделі наближається до вашої цілі за введених умов." : "BodyCast searches for a nutrition center whose modeled median trajectory approaches your target under the assumptions you enter."}</p></div><div className={styles.statePill}><span className={solving ? styles.pulse : undefined} />{solving ? (uk ? "Розраховуємо…" : "Solving…") : (uk ? "Гіпотетичний план" : "Hypothetical plan")}</div></header>

    {loadingContext && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>{uk ? "Завантажуємо поточний стан моделі" : "Loading current model state"}</strong></section>}
    {!loadingContext && initialized && <form className={styles.planner} onSubmit={(event) => void submit(event)} noValidate>
      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>01</span><h2>{uk ? "Ціль і дата" : "Target and date"}</h2></div><p>{uk ? `Останній змодельований день: ${formatDate(context!.status.latestModeledDate!, { year: "numeric" }, locale)}` : `Latest modeled day: ${formatDate(context!.status.latestModeledDate!, { year: "numeric" }, locale)}`}</p></div><div className={styles.formGrid}>
        <TextNumberField id="targetWeightKg" label={uk ? "Цільова вага" : "Target weight"} unit={uk ? "кг" : "kg"} value={form.targetWeightKg} min={0.1} max={1000} step={0.1} error={formErrors.targetWeightKg} onChange={(value) => updateForm("targetWeightKg", value)} />
        <label className={styles.field} htmlFor="goalDate"><span>{uk ? "Дата цілі" : "Goal date"}</span><input id="goalDate" name="goalDate" type="date" value={form.goalDate} required aria-invalid={Boolean(formErrors.goalDate)} aria-describedby={formErrors.goalDate ? "goalDate-error" : undefined} onChange={(event) => updateForm("goalDate", event.currentTarget.value)} /><FieldError id="goalDate-error" message={formErrors.goalDate} /></label>
      </div></section>

      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>02</span><h2>{uk ? "Межі планування" : "Planning bounds"}</h2></div><p>{uk ? "Початкові значення — редаговані інженерні зручності, не медичні межі." : "Initial values are editable engineering conveniences, not medical limits."}</p></div><div className={styles.formGrid}>
        <TextNumberField id="minCaloriesKcal" label={uk ? "Мінімум енергії" : "Minimum energy"} unit={uk ? "ккал" : "kcal"} value={form.minCaloriesKcal} min={0.1} error={formErrors.minCaloriesKcal} onChange={(value) => updateForm("minCaloriesKcal", value)} />
        <TextNumberField id="maxCaloriesKcal" label={uk ? "Максимум енергії" : "Maximum energy"} unit={uk ? "ккал" : "kcal"} value={form.maxCaloriesKcal} min={0.1} error={formErrors.maxCaloriesKcal} onChange={(value) => updateForm("maxCaloriesKcal", value)} />
      </div><details className={styles.optional}><summary>{uk ? "Додаткові межі макронутрієнтів" : "Optional macronutrient bounds"}</summary><p>{uk ? "Порожнє поле означає «межу не задано». Явний нуль залишається нулем." : "Blank means no bound was supplied. An explicit zero remains zero."}</p><div className={styles.formGrid}>
        {(["Protein", "Fat", "Carbs"] as const).flatMap((macro) => {
          const prefix = macro === "Carbs" ? "Carbs" : macro;
          const minKey = `min${prefix}G` as keyof Pick<GoalFormValues, "minProteinG" | "minFatG" | "minCarbsG">;
          const maxKey = `max${prefix}G` as keyof Pick<GoalFormValues, "maxProteinG" | "maxFatG" | "maxCarbsG">;
          const label = macro === "Carbs" ? (uk ? "вуглеводів" : "carbohydrate") : macro === "Protein" ? (uk ? "білків" : "protein") : (uk ? "жирів" : "fat");
          return [<TextNumberField key={minKey} id={minKey} label={`${uk ? "Мінімум" : "Minimum"} ${label}`} unit={uk ? "г" : "g"} value={form[minKey]} min={0} optional error={formErrors[minKey]} onChange={(value) => updateForm(minKey, value)} />, <TextNumberField key={maxKey} id={maxKey} label={`${uk ? "Максимум" : "Maximum"} ${label}`} unit={uk ? "г" : "g"} value={form[maxKey]} min={0} optional error={formErrors[maxKey]} onChange={(value) => updateForm(maxKey, value)} />];
        })}
      </div></details></section>

      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>03</span><h2>{uk ? "Шаблон харчування" : "Nutrition template"}</h2></div><p>{uk ? "Макроси масштабуються пропорційно; солвер не перебалансовує їх мовчки." : "Macros scale proportionally; the solver never silently rebalances them."}</p></div><div className={styles.formGrid}>
        <PlanNumberField id="templateCalories" label={uk ? "Енергія шаблону" : "Template energy"} unit={uk ? "ккал" : "kcal"} value={form.plan.caloriesKcal} max={20000} onChange={(value) => updatePlan("caloriesKcal", value)} />
        <PlanNumberField id="templateProtein" label={uk ? "Білки" : "Protein"} unit={uk ? "г" : "g"} value={form.plan.proteinG} max={1000} onChange={(value) => updatePlan("proteinG", value)} />
        <PlanNumberField id="templateFat" label={uk ? "Жири" : "Fat"} unit={uk ? "г" : "g"} value={form.plan.fatG} max={1000} onChange={(value) => updatePlan("fatG", value)} />
        <PlanNumberField id="templateCarbs" label={uk ? "Вуглеводи" : "Carbohydrate"} unit={uk ? "г" : "g"} value={form.plan.carbsG} max={2000} onChange={(value) => updatePlan("carbsG", value)} />
      </div></section>

      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>04</span><h2>{uk ? "Майбутня активність" : "Future activity"}</h2></div><p>{uk ? "Активність фіксується вашим сценарієм і не оптимізується разом із калоріями." : "Activity is fixed by your scenario and is not optimized together with calories."}</p></div><div className={styles.modeGrid}><button type="button" aria-pressed={form.mode === "target-centered"} onClick={() => updateForm("mode", "target-centered")}><strong>{uk ? "Гнучкий сценарій" : "Flexible scenario"}</strong><span>{uk ? "Майбутня поведінка варіюється навколо плану." : "Future behavior varies around the plan."}</span></button><button type="button" aria-pressed={form.mode === "fixed"} onClick={() => updateForm("mode", "fixed")}><strong>{uk ? "Точний сценарій" : "Exact scenario"}</strong><span>{uk ? "План повторюється без варіації дотримання." : "The plan repeats without adherence variation."}</span></button></div><div className={styles.formGrid}>
        <PlanNumberField id="walkingDistance" label={uk ? "Ходьба поза роботою" : "Walking outside work"} unit={uk ? "км/день" : "km/day"} value={form.plan.outsideWorkWalkingDistanceKm} max={100} step={0.1} onChange={(value) => updatePlan("outsideWorkWalkingDistanceKm", value)} />
        <PlanNumberField id="walkingSpeed" label={uk ? "Швидкість ходьби" : "Walking speed"} unit={uk ? "км/год" : "km/h"} value={form.plan.averageWalkingSpeedKmh} min={0.1} max={15} step={0.1} onChange={(value) => updatePlan("averageWalkingSpeedKmh", value)} />
        <PlanNumberField id="strengthDays" label={uk ? "Силові дні" : "Strength days"} unit={uk ? "на тиждень" : "per week"} value={form.plan.strengthDaysPerWeek} max={7} onChange={(value) => updatePlan("strengthDaysPerWeek", value)} />
        <PlanNumberField id="strengthMinutes" label={uk ? "Тривалість заняття" : "Session duration"} unit={uk ? "хв" : "min"} value={form.plan.strengthTrainingMinutes} max={600} onChange={(value) => updatePlan("strengthTrainingMinutes", value)} />
      </div><label className={styles.toggle}><input type="checkbox" checked={form.plan.plannedWork} onChange={(event) => updatePlan("plannedWork", event.currentTarget.checked)} /><span>{uk ? "Додати робочу зміну з понеділка по п’ятницю" : "Include a Monday–Friday work shift"}</span></label>{form.plan.plannedWork && <div className={styles.formGrid}><label className={styles.field} htmlFor="workCategory"><span>{uk ? "Інтенсивність роботи" : "Work intensity"}</span><select id="workCategory" value={form.plan.workCategory} onChange={(event) => updatePlan("workCategory", event.currentTarget.value as PlanValues["workCategory"])}><option value="standingLight">{uk ? "Дуже легка" : "Very light"}</option><option value="manualLight">{uk ? "Легка ручна" : "Light manual"}</option><option value="standingLightModerate">{uk ? "Активна легка" : "Active light"}</option><option value="manualModerate">{uk ? "Помірна ручна" : "Moderate manual"}</option></select></label><PlanNumberField id="shiftHours" label={uk ? "Зміна" : "Shift"} unit={uk ? "год" : "hours"} value={form.plan.shiftHours} min={0.1} max={24} step={0.25} onChange={(value) => updatePlan("shiftHours", value)} /><PlanNumberField id="breakHours" label={uk ? "Перерви" : "Breaks"} unit={uk ? "год" : "hours"} value={form.plan.breakHours} max={form.plan.shiftHours} step={0.25} onChange={(value) => updatePlan("breakHours", value)} /><PlanNumberField id="workWalkingDistance" label={uk ? "Ходьба на роботі" : "Work walking"} unit={uk ? "км" : "km"} value={form.plan.workWalkingDistanceKm} max={100} step={0.1} onChange={(value) => updatePlan("workWalkingDistanceKm", value)} /></div>}<FieldError id="plan-error" message={formErrors.plan} /></section>

      <div className={styles.submitRow}><div><strong>{uk ? "Розрахунок може тривати кілька секунд." : "The solve may take several seconds."}</strong><span>{uk ? "Новий запит скасовує попередній; показується лише останній результат." : "A new request cancels the previous one; only the latest result is shown."}</span></div><button type="submit" aria-busy={solving}>{solving ? (uk ? "Скасувати попередній і перерахувати" : "Cancel previous and recalculate") : (uk ? "Розрахувати сценарій" : "Calculate scenario")}</button></div>
    </form>}

    {error && <section className={styles.errorCard} role="alert"><strong>{uk ? "План не розраховано" : "Plan was not calculated"}</strong><p>{error}</p></section>}
    {solving && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>{uk ? "Перевіряємо межі, траєкторії та фінальну числову якість" : "Checking bounds, trajectories, and final numerical quality"}</strong><span>{uk ? "Ми не послаблюємо 128/512 траєкторій заради швидшого інтерфейсу." : "The 128/512 path verification is not weakened for UI speed."}</span></section>}

    {result && statusCopy && <section className={`${styles.statusCard} ${styles[statusCopy.tone]}`}><p className={styles.eyebrow}>{result.status}</p><h2>{statusCopy.title}</h2><p>{statusCopy.detail}</p>{result.reason && <small>{result.reason}</small>}</section>}

    {result && <>
      <section className={styles.summaryGrid}>
        <article><span>{uk ? "Змодельований центр плану" : "Modeled plan center"}</span><strong>{showPlanCenter ? `~${new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 0 }).format(displayCalories!)} ${uk ? "ккал/день" : "kcal/day"}` : "—"}</strong><small>{showPlanCenter ? (uk ? `Практична роздільність: ≈${result.numerical.practicalResolutionKcal} ккал` : `Practical resolution: ≈${result.numerical.practicalResolutionKcal} kcal`) : (uk ? "Точний центр не підтримується цим статусом" : "This status does not support a plan center")}</small></article>
        <article><span>{uk ? `Медіана на ${formatDate(result.goal.goalDate, { year: "numeric" }, locale)}` : `Median on ${formatDate(result.goal.goalDate, { year: "numeric" }, locale)}`}</span><strong>{result.terminal ? formatValue(result.terminal.median, "kg", locale) : "—"}</strong><small>{result.terminal ? `${uk ? "Відхилення" : "Residual"}: ${result.terminal.targetErrorKg >= 0 ? "+" : ""}${result.terminal.targetErrorKg.toFixed(2)} kg` : (uk ? "Фінальний Forecast недоступний" : "Final Forecast unavailable")}</small></article>
        <article><span>{uk ? "Прогнозний діапазон 5–95%" : "Predictive 5–95% range"}</span><strong>{result.terminal ? `${formatValue(result.terminal.p05, "kg", locale)}–${formatValue(result.terminal.p95, "kg", locale)}` : "—"}</strong><small>{uk ? "Варіативність змодельованих фізіологічних результатів" : "Variation in modeled physiological outcomes"}</small></article>
        <article><span>{uk ? "Досягнення цілі" : "Target attainment"}</span><strong>{result.terminal ? percent(result.terminal.attainment.probability, locale) : "—"}</strong><small>{probabilityCopy ?? (uk ? "Емпірична частка фінальних траєкторій" : "Empirical share of final paths")}</small></article>
      </section>
      {result.terminal && interval && <section className={styles.uncertaintyCard}><div><strong>{uk ? "Числова невизначеність імовірності" : "Probability numerical uncertainty"}</strong><span>{uk ? `95% Wilson Monte Carlo interval: ${percent(interval.lower, locale)}–${percent(interval.upper, locale)} (${result.terminal.attainment.successes}/${result.terminal.attainment.sampleCount} траєкторій).` : `95% Wilson Monte Carlo interval: ${percent(interval.lower, locale)}–${percent(interval.upper, locale)} (${result.terminal.attainment.successes}/${result.terminal.attainment.sampleCount} paths).`}</span></div><p>{uk ? "Це невизначеність оцінки ймовірності через скінченну кількість Monte Carlo траєкторій — не діапазон ваги й не ймовірність правильності моделі." : "This is uncertainty in the probability estimate from finite Monte Carlo paths—not a weight range or the probability that the model is correct."}</p></section>}
      {result.forecast && <section className={styles.chartPanel}><div className={styles.chartHeading}><div><p className={styles.eyebrow}>{uk ? "Історія → сценарій → ціль" : "History → scenario → target"}</p><h2>{uk ? "Траєкторія ваги" : "Weight trajectory"}</h2></div><div className={styles.legend}><span><i className={styles.historyKey} />{uk ? "Історія" : "History"}</span><span><i className={styles.medianKey} />{uk ? "Медіана" : "Median"}</span><span><i className={styles.innerKey} />25–75%</span><span><i className={styles.outerKey} />5–95%</span><span><i className={styles.targetKey} />{uk ? "Ціль" : "Target"}</span></div></div><ForecastChart result={result.forecast} metric="physiologicalBodyWeightKg" history={context?.history ?? []} locale={locale} target={{ date: result.goal.goalDate, weightKg: result.goal.targetValueKg }} /><p className={styles.chartNote}>{uk ? "Маркер цілі — введена вами майбутня точка, а не спостереження. Заштриховані діапазони — predictive distribution Forecast." : "The target marker is your submitted future point, not an observation. Shaded bands are the Forecast predictive distribution."}</p></section>}
      <section className={styles.detailGrid}><article><h2>{uk ? "Введені припущення" : "Submitted assumptions"}</h2><dl><div><dt>{uk ? "Ціль" : "Target"}</dt><dd>{result.goal.targetValueKg} kg · {result.goal.goalDate}</dd></div><div><dt>{uk ? "Межі калорій" : "Calorie bounds"}</dt><dd>{result.assumptions.constraints.minCaloriesKcal}–{result.assumptions.constraints.maxCaloriesKcal} kcal</dd></div><div><dt>{uk ? "Сценарій" : "Scenario"}</dt><dd>{result.assumptions.scenarioMode}</dd></div><div><dt>{uk ? "Шаблон" : "Template"}</dt><dd>{result.assumptions.referenceNutrition.caloriesKcal} kcal · P {result.assumptions.referenceNutrition.proteinG} · F {result.assumptions.referenceNutrition.fatG} · C {result.assumptions.referenceNutrition.carbsG}</dd></div><div><dt>{uk ? "Ходьба" : "Walking"}</dt><dd>{result.assumptions.activity.outsideWorkWalkingDistanceKm} km @ {result.assumptions.activity.averageWalkingSpeedKmh} km/h</dd></div><div><dt>{uk ? "Робочі дні" : "Scheduled work days"}</dt><dd>{result.assumptions.activity.scheduledOccupationDayCount}</dd></div></dl></article><article><h2>{uk ? "Якість і обмеження" : "Quality and limitations"}</h2><ul><li>{uk ? "Початковий стан" : "Initial state"}: {result.provenance.initialStateQuality ?? "—"}</li><li>{uk ? "Якість Forecast" : "Forecast quality"}: {result.numerical.forecastQuality ?? "—"}</li><li>{uk ? "Числова похибка солвера" : "Solver tolerance"}: {result.numerical.solverToleranceKg} kg</li><li>{uk ? "Смуга near-target probability" : "Near-target probability band"}: ±{result.numerical.goalToleranceKg} kg ({uk ? "інженерне налаштування" : "engineering setting"})</li><li>{uk ? "Локальна чутливість" : "Local sensitivity"}: {result.numerical.localSensitivityKgPer100Kcal === null ? "—" : `${result.numerical.localSensitivityKgPer100Kcal.toFixed(2)} kg / 100 kcal`}</li>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></article></section>
    </>}
  </main>;
}
