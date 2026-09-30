"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { HelpTip } from "@/components/help-tip";
import { ModelStateSource } from "@/components/model-state-source";
import { useI18n, type Locale } from "@/i18n/i18n-provider";
import { ForecastChart } from "@/app/forecast/forecast-chart";
import { attachObservedBodyFatPercent } from "@/app/forecast/forecast-chart-measurements";
import { beginForecastRequest, formatDate, formatValue, isCurrentForecastRequest, type PlanValues } from "@/modules/model-forecast/forecast-ui";
import { forecastChartLabels } from "@/modules/model-forecast/forecast-chart-data";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import type { ProfileDto } from "@/modules/profile/profile.types";
import {
  buildGoalPlanningRequest,
  canOpenGoalPlanner,
  defaultGoalForm,
  guidedWorkCategory,
  initialGoalFormWithRecommendation,
  recommendGoalFormNutrition,
  recommendGoalNutritionAtCalories,
  goalStatusPresentation,
  goalScenarioModeLabel,
  goalWarningLabel,
  probabilityDefinition,
  type GoalFormErrors,
  type GoalFormValues,
} from "@/modules/model-goal-planning/goal-planning-ui";
import type { GoalPlanningResponse } from "@/modules/model-goal-planning/goal-planning.types";
import styles from "./goal.module.css";
import { goalSettingsFromForm, isGoalBrowserSettings } from "@/modules/browser-settings/planning-settings";
import { GOAL_SETTINGS_KEY, readBrowserSettings, resetBrowserSettings, writeBrowserSettings } from "@/modules/browser-settings/versioned-settings";

type HistoricalDay = { date: string; modeledWeightKg: number | null; filteredWeightKg: number | null; fatMassKg: number | null; leanTissueKg: number | null; glycogenAssociatedMassKg: number | null; dataQuality: string };
type ObservedWeight = { date: string; weightKg: number; bodyFatPercent?: number | null };
type GoalProfileAttributes = Pick<ProfileDto, "sex" | "dateOfBirth" | "heightCm">;
type Context = { status: ModelStatusDto; history: HistoricalDay[]; observedWeights?: ObservedWeight[]; profile?: GoalProfileAttributes | null };

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

function MetricExplanation({ children, locale }: { children: ReactNode; locale: Locale }) {
  return <details className={styles.metricExplanation}>
    <summary>{locale === "uk" ? "Як читати" : "How to read"}</summary>
    <p>{children}</p>
  </details>;
}

function TextNumberField({ id, label, value, onChange, error, unit, min, max, step = "any", optional = false, help, helpLabel }: {
  id: string; label: string; value: string; onChange: (value: string) => void; error?: string; unit?: string;
  min?: number; max?: number; step?: number | "any"; optional?: boolean; help?: string; helpLabel?: string;
}) {
  const errorId = `${id}-error`;
  return <label className={styles.field} htmlFor={id}><span>{label}{unit ? ` (${unit})` : ""}{optional ? " · optional" : ""}{help && <HelpTip label={helpLabel}>{help}</HelpTip>}</span><input id={id} name={id} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} required={!optional} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => onChange(event.currentTarget.value)} /><FieldError id={errorId} message={error} /></label>;
}

function PlanNumberField({ id, label, value, onChange, unit, min = 0, max, step = 1, help, helpLabel }: {
  id: string; label: string; value: number; onChange: (value: number) => void; unit?: string; min?: number; max?: number; step?: number; help?: string; helpLabel?: string;
}) {
  return <label className={styles.field} htmlFor={id}><span>{label}{unit ? ` (${unit})` : ""}{help && <HelpTip label={helpLabel}>{help}</HelpTip>}</span><input id={id} type="number" inputMode="decimal" value={Number.isNaN(value) ? "" : value} min={min} max={max} step={step} required onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
}

function percent(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function displayPlanValue(value: number, locale: Locale) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 1 }).format(value)
    : "—";
}

function nutritionLimitationText(code: string, uk: boolean): string {
  const text: Record<string, { uk: string; en: string }> = {
    "current-weight-unavailable": { uk: "Поточна вага недоступна, тому білкова оцінка не персоналізована за масою тіла.", en: "Current weight is unavailable, so protein is not personalized to body mass." },
    "target-date-or-weight-incomplete": { uk: "Темп зміни ваги не вдалося оцінити за цими даними.", en: "The requested rate of weight change could not be reviewed from these inputs." },
    "target-date-invalid": { uk: "Дату цілі не вдалося використати для перевірки темпу.", en: "The goal date could not be used to review the requested pace." },
    "target-rate-review": { uk: "Заданий темп перевищує довідковий орієнтир продукту; це не медична межа й не блокує сценарій.", en: "The requested pace exceeds a product review guideline; this is not a medical limit and does not block the scenario." },
    "adult-guidance-only": { uk: "Загальна макрорекомендація не адаптована для віку до 18 років.", en: "This general macro guidance is not tailored for people under 18." },
    "older-adult-guidance-not-modeled": { uk: "Спеціальні рекомендації для людей 65+ не моделюються.", en: "Specific guidance for people 65+ is not modeled." },
    "body-composition-and-clinical-context-not-modeled": { uk: "Рекомендація не враховує склад тіла або клінічний контекст.", en: "The recommendation does not account for body composition or clinical context." },
    "protein-energy-bound": { uk: "Білок обмежено діапазоном 10–35% енергії; персональна ціль у грамах вийшла за нього.", en: "Protein was kept within 10–35% of energy; the weight-based target in grams fell outside that range." },
    "invalid-input": { uk: "Частина профільних даних невалідна, тому рекомендація має обмеження.", en: "Some profile inputs are invalid, which limits this recommendation." },
  };
  const value = text[code];
  return value ? (uk ? value.uk : value.en) : code;
}

export function GoalClient() {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const [context, setContext] = useState<Context | null>(null);
  const [form, setForm] = useState<GoalFormValues>(() => defaultGoalForm());
  const [initialized, setInitialized] = useState(false);
  const [formErrors, setFormErrors] = useState<GoalFormErrors>({});
  const [workInputMode, setWorkInputMode] = useState<"direct" | "guided">("direct");
  const [guidedWorkStep, setGuidedWorkStep] = useState(1);
  const [result, setResult] = useState<GoalPlanningResponse | null>(null);
  const [chartHistoryRange, setChartHistoryRange] = useState<"recent" | "full">("recent");
  const [chartMetric, setChartMetric] = useState<"physiologicalBodyWeightKg" | "fatMassKg">("physiologicalBodyWeightKg");
  const [loadingContext, setLoadingContext] = useState(true);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef({ current: 0 });
  const skipSettingsWrite = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const profileRequest = fetch("/api/v1/profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as { profile?: GoalProfileAttributes | null } : { profile: null })
      .catch(() => ({ profile: null }));
    void Promise.all([
      fetch("/api/forecast/context", { cache: "no-store", signal: controller.signal }),
      profileRequest,
    ]).then(async ([response, profileResult]) => {
      if (!response.ok) throw new Error(await responseError(response, locale));
      const contextResponse = await response.json() as Context;
      const next = {
        ...contextResponse,
        observedWeights: await attachObservedBodyFatPercent(contextResponse.observedWeights ?? [], controller.signal),
      };
      const profile = profileResult.profile
        ? {
          sex: profileResult.profile.sex,
          dateOfBirth: profileResult.profile.dateOfBirth,
          heightCm: profileResult.profile.heightCm,
        }
        : null;
      setContext({ ...next, profile });
      const initial = initialGoalFormWithRecommendation(next.status.latestModeledDate, next.status, profile);
      const persisted = readBrowserSettings(GOAL_SETTINGS_KEY, isGoalBrowserSettings);
      if (persisted) {
        const restored: GoalFormValues = {
          ...initial.form,
          ...persisted.form,
          plan: { ...initial.form.plan, ...persisted.form.plan },
        };
        const refreshedRecommendation = recommendGoalFormNutrition(restored, next.status.latestModeledDate, next.status, profile);
        restored.plan = {
          ...restored.plan,
          ...refreshedRecommendation.nutrition,
        };
        setForm(restored);
      } else {
        setForm(initial.form);
      }
      setInitialized(true);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : uk ? "Не вдалося завантажити модель." : "Could not load the model.");
    }).finally(() => { if (!controller.signal.aborted) setLoadingContext(false); });
    return () => { controller.abort(); controllerRef.current?.abort(); };
  }, [locale, uk]);

  useEffect(() => {
    if (!initialized) return;
    if (skipSettingsWrite.current) { skipSettingsWrite.current = false; return; }
    const settings = goalSettingsFromForm(form, null);
    if (isGoalBrowserSettings(settings)) writeBrowserSettings(GOAL_SETTINGS_KEY, settings);
  }, [form, initialized]);

  function updateForm<K extends keyof GoalFormValues>(key: K, value: GoalFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null); setError(null); setFormErrors({});
  }
  function updatePlan<K extends keyof PlanValues>(key: K, value: PlanValues[K]) {
    setForm((current) => ({ ...current, plan: { ...current.plan, [key]: value } }));
    setResult(null); setError(null); setFormErrors({});
  }

  function resetSettings() {
    if (!context) return;
    resetBrowserSettings(GOAL_SETTINGS_KEY);
    const initial = initialGoalFormWithRecommendation(context.status.latestModeledDate, context.status, context.profile ?? null);
    skipSettingsWrite.current = true;
    setForm(initial.form);
    setResult(null); setError(null); setFormErrors({});
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!context?.status.latestModeledDate) { setError(uk ? "Останній змодельований стан недоступний." : "The latest modeled state is unavailable."); return; }
    const referenceNutrition = recommendGoalFormNutrition(
      form,
      context.status.latestModeledDate,
      context.status,
      context.profile ?? null,
    ).nutrition;
    const built = buildGoalPlanningRequest({
      ...form,
      plan: { ...form.plan, ...referenceNutrition },
    }, context.status.latestModeledDate);
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
  const displayCalories = typeof result?.control.solvedCaloriesKcal === "number"
    && Number.isFinite(result.control.solvedCaloriesKcal) && result.control.solvedCaloriesKcal > 0
    ? result.control.solvedCaloriesKcal : null;
  const showPlanCenter = Boolean(result && ["solved", "solved-at-boundary", "numerically-limited"].includes(result.status) && displayCalories !== null);
  const probabilityCopy = result ? probabilityDefinition(result, locale) : null;
  const interval = result?.terminal?.attainment.probabilityMonteCarloInterval;
  const latestModeledDate = context?.status.latestModeledDate ?? null;
  const canPlan = canOpenGoalPlanner(latestModeledDate);
  const nutritionRecommendation = context && displayCalories !== null && showPlanCenter
    ? recommendGoalNutritionAtCalories(form, displayCalories, latestModeledDate, context.status, context.profile ?? null)
    : null;
  const nutritionLimitations = nutritionRecommendation?.limitations ?? [];
  const chartLabels = result?.forecast
    ? forecastChartLabels(locale, chartMetric, result.forecast.forecastVersion === "experimental-forecast-v1")
    : null;

  return <main className={styles.page}>
    <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Планувальник цілі" : "Goal planner"}</span></Link><AppNav active="goal" /></div>
    <header className={styles.hero}><div><p className={styles.eyebrow}>{uk ? "Сценарій · не припис" : "Scenario · not a prescription"}</p><h1>{uk ? "Перевірте шлях до цілі" : "Explore a path to your goal"}</h1><p>{uk ? "Порівняйте бажану вагу з розрахованою траєкторією, імовірністю та межами прогнозу." : "Compare your target weight with the modeled trajectory, attainment estimate, and forecast limits."}</p></div><div className={styles.statePill}><span className={solving ? styles.pulse : undefined} />{solving ? (uk ? "Розраховуємо…" : "Solving…") : (uk ? "Гіпотетичний план" : "Hypothetical plan")}</div></header>

    {loadingContext && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>{uk ? "Завантажуємо поточний стан моделі" : "Loading current model state"}</strong></section>}
    {!loadingContext && initialized && !canPlan && <section className={styles.errorCard} role="status"><strong>{uk ? "Немає змодельованого стану" : "No modeled state yet"}</strong><p>{uk ? "Активна модель є, але останній змодельований день ще недоступний. Додайте історію й розрахуйте модель, перш ніж будувати ціль." : "There is an active model, but the latest modeled day is not available yet. Add history and calculate the model before planning a goal."}</p><p><Link href="/forecast">{uk ? "Перейти до прогнозу / запуску моделі" : "Go to forecast / start model"}</Link> · <Link href="/history">{uk ? "Історія" : "History"}</Link></p></section>}
    {!loadingContext && initialized && canPlan && latestModeledDate && <div className={`${styles.workspace} ${result ? styles.hasResult : ""}`}>
      <section className={styles.formColumn} aria-labelledby="goal-plan-heading">
        <div className={styles.formIntro}><div><p className={styles.eyebrow}>{uk ? "Умови розрахунку" : "Calculation inputs"}</p><h2 id="goal-plan-heading">{uk ? "Ваш сценарій" : "Your scenario"}</h2></div></div>
    {!loadingContext && initialized && canPlan && latestModeledDate && <form className={styles.planner} onSubmit={(event) => void submit(event)} noValidate>
      <div className={styles.formUtilityRow}><span>{uk ? "Параметри сценарію" : "Scenario inputs"}</span><button className={styles.resetButton} type="button" disabled={solving} onClick={resetSettings}>{uk ? "Скинути налаштування" : "Reset settings"}</button></div>
      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>01</span><h2>{uk ? "Ціль і дата" : "Target and date"}</h2></div><p>{uk ? `Останній змодельований день: ${formatDate(latestModeledDate, { year: "numeric" }, locale)}` : `Latest modeled day: ${formatDate(latestModeledDate, { year: "numeric" }, locale)}`}</p></div><div className={styles.formGrid}>
        <TextNumberField id="targetWeightKg" label={uk ? "Цільова вага" : "Target weight"} unit={uk ? "кг" : "kg"} helpLabel={uk ? "Пояснення цільової ваги" : "Explain target weight"} help={uk ? "Вага, до якої solver підбирає сценарій у заданих межах планування." : "The weight the solver uses to search for a scenario within your planning bounds."} value={form.targetWeightKg} min={0.1} max={1000} step={0.1} error={formErrors.targetWeightKg} onChange={(value) => updateForm("targetWeightKg", value)} />
        <label className={styles.field} htmlFor="goalDate"><span>{uk ? "Дата цілі" : "Goal date"}<HelpTip label={uk ? "Пояснення дати цілі" : "Explain goal date"}>{uk ? "Дата задає горизонт планувальника, але не гарантує, що ціль фізіологічно досяжна." : "The date sets the planner horizon; it does not guarantee the goal is physiologically reachable."}</HelpTip></span><input id="goalDate" name="goalDate" type="date" value={form.goalDate} required aria-invalid={Boolean(formErrors.goalDate)} aria-describedby={formErrors.goalDate ? "goalDate-error" : undefined} onChange={(event) => updateForm("goalDate", event.currentTarget.value)} /><FieldError id="goalDate-error" message={formErrors.goalDate} /></label>
      </div></section>

      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>02</span><h2>{uk ? "Межі планування" : "Planning bounds"}<HelpTip label={uk ? "Пояснення меж планування" : "Explain planning bounds"}>{uk ? "Це діапазон, у якому планувальник шукає рішення. Мінімум і максимум — не рекомендація з’їдати саме стільки." : "This is the range the planner searches. The minimum and maximum are not recommendations to eat those amounts."}</HelpTip></h2></div><p>{uk ? "Умови пошуку, не фізіологічні чи медичні межі." : "Search settings, not physiological or medical limits."}</p></div><div className={styles.formGrid}>
        <TextNumberField id="minCaloriesKcal" label={uk ? "Мінімум енергії" : "Minimum calories"} unit={uk ? "ккал" : "kcal"} helpLabel={uk ? "Пояснення мінімуму калорій" : "Explain minimum calories"} help={uk ? "Нижня межа, нижче якої solver не шукатиме. Це не рекомендація з’їдати цей мінімум." : "The lower bound for the solver search. It is not a recommendation to eat this minimum."} value={form.minCaloriesKcal} min={0.1} error={formErrors.minCaloriesKcal} onChange={(value) => updateForm("minCaloriesKcal", value)} />
        <TextNumberField id="maxCaloriesKcal" label={uk ? "Максимум енергії" : "Maximum energy"} unit={uk ? "ккал" : "kcal"} help={uk ? "Верхня межа пошуку. Якщо ціль недосяжна всередині цих меж, результат покаже найближчий край, а не вигадане значення." : "Upper search bound. If the target is unreachable within the bounds, the result shows the nearest edge instead of inventing a value."} value={form.maxCaloriesKcal} min={0.1} error={formErrors.maxCaloriesKcal} onChange={(value) => updateForm("maxCaloriesKcal", value)} />
      </div><details className={styles.optional}><summary>{uk ? "Додаткові межі макронутрієнтів" : "Optional macronutrient bounds"}</summary><p>{uk ? "Порожнє поле означає «межу не задано». Явний нуль залишається нулем." : "Blank means no bound was supplied. An explicit zero remains zero."}</p><div className={styles.formGrid}>
        {(["Protein", "Fat", "Carbs"] as const).flatMap((macro) => {
          const prefix = macro === "Carbs" ? "Carbs" : macro;
          const minKey = `min${prefix}G` as keyof Pick<GoalFormValues, "minProteinG" | "minFatG" | "minCarbsG">;
          const maxKey = `max${prefix}G` as keyof Pick<GoalFormValues, "maxProteinG" | "maxFatG" | "maxCarbsG">;
          const label = macro === "Carbs" ? (uk ? "вуглеводів" : "carbohydrate") : macro === "Protein" ? (uk ? "білків" : "protein") : (uk ? "жирів" : "fat");
          return [<TextNumberField key={minKey} id={minKey} label={`${uk ? "Мінімум" : "Minimum"} ${label}`} unit={uk ? "г" : "g"} value={form[minKey]} min={0} optional error={formErrors[minKey]} onChange={(value) => updateForm(minKey, value)} />, <TextNumberField key={maxKey} id={maxKey} label={`${uk ? "Максимум" : "Maximum"} ${label}`} unit={uk ? "г" : "g"} value={form[maxKey]} min={0} optional error={formErrors[maxKey]} onChange={(value) => updateForm(maxKey, value)} />];
        })}
      </div></details></section>

      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>03</span><h2>{uk ? "Майбутня активність" : "Future activity"}</h2></div><p>{uk ? "Активність задається сценарієм і не оптимізується разом із калоріями." : "Activity is set by your scenario and is not optimized with calories."}</p></div><div className={styles.modeGrid}><button type="button" aria-pressed={form.mode === "target-centered"} onClick={() => updateForm("mode", "target-centered")}><strong>{uk ? "Гнучкий сценарій" : "Flexible scenario"}</strong><span>{uk ? "Поведінка змінюється навколо плану." : "Behavior varies around the plan."}</span></button><button type="button" aria-pressed={form.mode === "fixed"} onClick={() => updateForm("mode", "fixed")}><strong>{uk ? "Точний сценарій" : "Exact scenario"}</strong><span>{uk ? "План повторюється без відхилень." : "The plan repeats without variation."}</span></button></div><div className={styles.formGrid}>
        <PlanNumberField id="averageSteps" label={uk ? "Середні кроки" : "Average steps"} unit={uk ? "на день" : "per day"} helpLabel={uk ? "Пояснення кроків" : "Explain steps"} help={uk ? "Середнє очікуване значення за день." : "Your expected average number of steps per day."} value={form.plan.averageStepsPerDay} max={100000} step={100} onChange={(value) => updatePlan("averageStepsPerDay", value)} />
        <PlanNumberField id="strengthDays" label={uk ? "Силові тренування" : "Strength sessions"} unit={uk ? "на тиждень" : "per week"} helpLabel={uk ? "Пояснення силових тренувань" : "Explain strength sessions"} help={uk ? "Тренування з обтяженнями або іншою силовою роботою." : "Resistance training or other strength-focused sessions."} value={form.plan.strengthDaysPerWeek} max={7} onChange={(value) => updatePlan("strengthDaysPerWeek", value)} />
        <PlanNumberField id="strengthMinutes" label={uk ? "Тривалість силового" : "Strength duration"} unit={uk ? "хв" : "min"} value={form.plan.strengthTrainingMinutes} max={600} onChange={(value) => updatePlan("strengthTrainingMinutes", value)} />
        <PlanNumberField id="otherTrainingDays" label={uk ? "Інші тренування" : "Other training"} unit={uk ? "на тиждень" : "per week"} helpLabel={uk ? "Пояснення інших тренувань" : "Explain other training"} help={uk ? "Структуровані тренування, які не враховані як силові." : "Structured sessions that are not counted as strength training."} value={form.plan.otherTrainingDaysPerWeek} max={7} onChange={(value) => updatePlan("otherTrainingDaysPerWeek", value)} />
        <PlanNumberField id="otherTrainingMinutes" label={uk ? "Тривалість іншого тренування" : "Other training duration"} unit={uk ? "хв" : "min"} value={form.plan.otherTrainingMinutes} max={600} onChange={(value) => updatePlan("otherTrainingMinutes", value)} />
      </div></section>

      <section className={styles.formSection}><div className={styles.sectionHeading}><div><span>04</span><h2>{uk ? "Робоча активність" : "Work activity"}</h2><HelpTip label={uk ? "Пояснення робочої активності" : "Explain work activity"}>{uk ? "Додавайте робочі дні лише якщо робота помітно впливає на ваш рух. Розрахунок використовує одну з наявних категорій роботи." : "Include work days when your job meaningfully affects your movement. The calculation uses one of its existing work categories."}</HelpTip></div><p>{uk ? "Окремо від кроків і тренувань." : "Separate from steps and training."}</p></div>
        <label className={styles.toggle}><input type="checkbox" checked={form.plan.plannedWork} onChange={(event) => { updatePlan("plannedWork", event.currentTarget.checked); if (event.currentTarget.checked) { setWorkInputMode("direct"); setGuidedWorkStep(1); } }} /><span>{uk ? "У мене є робочі дні" : "I have work days"}</span></label>
        {form.plan.plannedWork && <>
          <div className={styles.modeGrid}>
            <button type="button" aria-pressed={workInputMode === "direct"} onClick={() => setWorkInputMode("direct")}><strong>{uk ? "Я знаю характер роботи" : "I know my work type"}</strong><span>{uk ? "Виберіть одну з підтриманих категорій." : "Choose one of the supported categories."}</span></button>
            <button type="button" aria-pressed={workInputMode === "guided"} onClick={() => { setWorkInputMode("guided"); setGuidedWorkStep(1); }}><strong>{uk ? "Не впевнений — допоможіть визначити" : "Not sure — help me choose"}</strong><span>{uk ? "Кілька простих запитань про ваш графік." : "A few simple questions about your schedule."}</span></button>
          </div>
          {workInputMode === "direct" ? <div className={styles.formGrid}>
            <PlanNumberField id="workDaysPerWeek" label={uk ? "Робочих днів" : "Work days"} unit={uk ? "на тиждень" : "per week"} value={form.plan.workDaysPerWeek} min={1} max={7} onChange={(value) => updatePlan("workDaysPerWeek", value)} />
            <label className={styles.field} htmlFor="workCategory"><span>{uk ? "Характер роботи" : "Work type"}</span><select id="workCategory" value={form.plan.workCategory} onChange={(event) => updatePlan("workCategory", event.currentTarget.value as PlanValues["workCategory"])}><option value="standingLight">{uk ? "Дуже легка / переважно очікування" : "Very light / mostly waiting"}</option><option value="manualLight">{uk ? "Легке переміщення / пакування" : "Light handling / packing"}</option><option value="standingLightModerate">{uk ? "Активна легка ручна робота" : "Active light manual work"}</option><option value="manualModerate">{uk ? "Помірна ручна робота" : "Moderate handling"}</option></select></label>
            <PlanNumberField id="shiftHours" label={uk ? "Тривалість зміни" : "Shift duration"} unit={uk ? "год" : "hours"} value={form.plan.shiftHours} min={0.1} max={24} step={0.25} onChange={(value) => updatePlan("shiftHours", value)} />
            <PlanNumberField id="breakHours" label={uk ? "Перерви за зміну" : "Breaks per shift"} unit={uk ? "год" : "hours"} value={form.plan.breakHours} max={form.plan.shiftHours} step={0.25} onChange={(value) => updatePlan("breakHours", value)} />
          </div> : <div className={styles.guidedWork} aria-live="polite">
            {guidedWorkStep === 1 && <><p>{uk ? "Скільки днів на тиждень ви зазвичай працюєте?" : "How many days per week do you usually work?"}</p><div className={styles.guidedControls}><PlanNumberField id="guidedWorkDays" label={uk ? "Робочих днів" : "Work days"} unit={uk ? "на тиждень" : "per week"} value={form.plan.workDaysPerWeek} min={1} max={7} onChange={(value) => updatePlan("workDaysPerWeek", value)} /><button type="button" onClick={() => setGuidedWorkStep(2)}>{uk ? "Далі" : "Next"}</button></div></>}
            {guidedWorkStep === 2 && <><p>{uk ? "Скільки годин триває звичайна зміна?" : "How long is a typical shift?"}</p><div className={styles.guidedControls}><PlanNumberField id="guidedShiftHours" label={uk ? "Тривалість зміни" : "Shift duration"} unit={uk ? "год" : "hours"} value={form.plan.shiftHours} min={0.1} max={24} step={0.25} onChange={(value) => updatePlan("shiftHours", value)} /><button type="button" onClick={() => setGuidedWorkStep(3)}>{uk ? "Далі" : "Next"}</button></div><button className={styles.backButton} type="button" onClick={() => setGuidedWorkStep(1)}>{uk ? "Назад" : "Back"}</button></>}
            {guidedWorkStep === 3 && <><p>{uk ? "Що найкраще описує роботу?" : "Which description best fits your work?"}</p><div className={styles.guidedChoices}><button type="button" onClick={() => { updatePlan("workCategory", guidedWorkCategory("mostly-sitting")); setGuidedWorkStep(4); }}>{uk ? "Переважно сиджу або чекаю" : "Mostly sitting or waiting"}</button><button type="button" onClick={() => { updatePlan("workCategory", guidedWorkCategory("mostly-standing")); setGuidedWorkStep(4); }}>{uk ? "Переважно стою, легкі рухи" : "Mostly standing, light movement"}</button><button type="button" onClick={() => { updatePlan("workCategory", guidedWorkCategory("manual-handling")); setGuidedWorkStep(4); }}>{uk ? "Ручна робота, легке переміщення" : "Manual work, light handling"}</button></div><button className={styles.backButton} type="button" onClick={() => setGuidedWorkStep(2)}>{uk ? "Назад" : "Back"}</button><small>{uk ? "Це найближчі відповідники серед наявних категорій. Для точнішого вибору скористайтеся режимом «Я знаю характер роботи»." : "These are the closest matches among existing categories. Use “I know my work type” for a more exact choice."}</small></>}
            {guidedWorkStep === 4 && <><p>{uk ? "Скільки годин перерв зазвичай входить у зміну?" : "How many hours of breaks are included in a typical shift?"}</p><div className={styles.guidedControls}><PlanNumberField id="guidedBreakHours" label={uk ? "Перерви за зміну" : "Breaks per shift"} unit={uk ? "год" : "hours"} value={form.plan.breakHours} max={form.plan.shiftHours} step={0.25} onChange={(value) => updatePlan("breakHours", value)} /><button type="button" onClick={() => setGuidedWorkStep(1)}>{uk ? "Змінити відповіді" : "Edit answers"}</button></div><p>{uk ? "Графік готовий. Усі відповіді збережені в одному плані." : "Work schedule ready. Your answers are saved in the same plan."}</p></>}
          </div>}
        </>}
        <FieldError id="plan-error" message={formErrors.plan} />
      </section>

      <div className={styles.submitRow}><div><strong>{uk ? "Розрахунок може тривати кілька секунд." : "The solve may take several seconds."}</strong><span>{uk ? "Новий запит скасовує попередній; показується лише останній результат." : "A new request cancels the previous one; only the latest result is shown."}</span></div><button type="submit" aria-busy={solving}>{solving ? (uk ? "Скасувати попередній і перерахувати" : "Cancel previous and recalculate") : (uk ? "Розрахувати сценарій" : "Calculate scenario")}</button></div>
    </form>}
    {error && <section className={styles.errorCard} role="alert"><strong>{uk ? "План не розраховано" : "Plan was not calculated"}</strong><p>{error}</p></section>}
    {solving && <section className={styles.loadingCard} aria-live="polite"><div className={styles.spinner} /><strong>{uk ? "Перевіряємо межі, траєкторії та фінальну числову якість" : "Checking bounds, trajectories, and final numerical quality"}</strong><span>{uk ? "Ми не послаблюємо 128/512 траєкторій заради швидшого інтерфейсу." : "The 128/512 path verification is not weakened for UI speed."}</span></section>}
      </section>
      <section className={styles.resultColumn} aria-label={uk ? "Результат цілі" : "Goal result"}>
        {!result && !solving && <section className={styles.emptyResult}><span>{uk ? "Що покаже розрахунок" : "What the result shows"}</span><strong>{uk ? "Ціль, траєкторія та ймовірність" : "Target, trajectory, and attainment"}</strong><p>{uk ? "Після розрахунку тут з’являться медіанний результат, інтервали невизначеності та графік із цільовою датою." : "After calculation, the median outcome, uncertainty ranges, and target-date chart appear here."}</p></section>}
    {result && statusCopy && <section className={`${styles.statusCard} ${styles[statusCopy.tone]}`}><p className={styles.eyebrow}>{uk ? "Результат планування" : "Planning result"}</p><h2>{statusCopy.title}</h2><p>{statusCopy.detail}</p></section>}
    {result && <>
      <section className={styles.summaryGrid} aria-label={uk ? "Основний результат" : "Goal result summary"}>
        <article className={styles.attainmentMetric}>
          <span>{uk ? "Досягнення цілі" : "Target attainment"}</span>
          <strong>{result.terminal ? percent(result.terminal.attainment.probability, locale) : "—"}</strong>
          <small>{probabilityCopy ?? (uk ? "Частка фінальних симуляцій, що відповідають вашій цілі." : "Share of final simulations that meet your target.")}</small>
          <MetricExplanation locale={locale}>{uk
            ? "Це частка змодельованих фінальних результатів, які відповідають напрямку цілі: для зниження ваги — ціль або нижче, для набору — ціль або вище, для підтримки — у межах заданого допуску. Це результат сценарію, а не гарантія і не шанс того, що сама модель правильна."
            : "This is the share of modeled final outcomes that meet the target direction: for weight loss, at or below the target; for gain, at or above it; for maintenance, within the set tolerance. It describes this scenario, not a guarantee or the probability that the model itself is correct."}</MetricExplanation>
        </article>
        <article className={styles.medianMetric}>
          <span>{uk ? `Медіана на ${formatDate(result.goal.goalDate, { year: "numeric" }, locale)}` : `Median on ${formatDate(result.goal.goalDate, { year: "numeric" }, locale)}`}</span>
          <strong>{result.terminal ? formatValue(result.terminal.median, "kg", locale) : "—"}</strong>
          <small>{result.terminal ? `${uk ? "Відхилення" : "Residual"}: ${result.terminal.targetErrorKg >= 0 ? "+" : ""}${result.terminal.targetErrorKg.toFixed(2)} kg` : (uk ? "Фінальний Forecast недоступний" : "Final Forecast unavailable")}</small>
          <MetricExplanation locale={locale}>{uk
            ? "Медіана — середина змодельованих результатів на дату цілі: приблизно половина симуляцій дала нижче значення, половина — вище. Це не середнє арифметичне, не обіцянка точного ранкового зважування і не окрема виміряна вага."
            : "The median is the midpoint of modeled outcomes on the goal date: about half of the simulations are lower and half are higher. It is not the arithmetic average, a promise about a morning weigh-in, or a measured weight."}</MetricExplanation>
        </article>
        <article className={styles.rangeMetric}>
          <span>{uk ? "Прогнозний діапазон 5–95%" : "Predictive 5–95% range"}</span>
          <strong>{result.terminal ? `${formatValue(result.terminal.p05, "kg", locale)}–${formatValue(result.terminal.p95, "kg", locale)}` : "—"}</strong>
          <small>{uk ? "Центральні 90% змодельованих результатів." : "Central 90% of modeled outcomes."}</small>
          <MetricExplanation locale={locale}>{uk
            ? "Межі 5-го і 95-го перцентилів показують розкид центральної частини змодельованих фінальних значень. Це не гарантійний коридор: частина симуляцій може бути за його межами. Діапазон не враховує всі можливі похибки моделі чи звичайний шум вагів."
            : "The 5th and 95th percentile bounds show the spread of the central part of modeled final values. This is not a guaranteed corridor; some simulations can fall outside it. The range does not capture every possible model error or ordinary scale noise."}</MetricExplanation>
        </article>
        <article className={styles.caloriesMetric}>
          <span>{uk ? "Калорійність, яку обрав solver" : "Calories selected by the solver"}</span>
          <strong>{showPlanCenter ? `${displayPlanValue(displayCalories!, locale)} ${uk ? "ккал/день" : "kcal/day"}` : "—"}</strong>
          <small>{showPlanCenter ? (uk ? `Центр у заданих межах · крок пошуку ≈${result.numerical.practicalResolutionKcal} ккал` : `Center within your bounds · search step ≈${result.numerical.practicalResolutionKcal} kcal`) : (uk ? "Центр не підтримується цим статусом" : "A plan center is not available for this status")}</small>
          <MetricExplanation locale={locale}>{uk
            ? "Це підібране добове значення енергії, за якого медіанна траєкторія наближається до цілі в заданих вами умовах. Пошук має практичний крок, показаний під значенням, а межі задаєте ви. Це не медичний припис і не гарантія результату. Окрема рекомендація білків, жирів і вуглеводів нижче використовує цей центр."
            : "This is the selected daily energy value at which the median trajectory approaches the target under your assumptions. The search has the practical step shown below, and you set its bounds. This is not medical advice or a guarantee. The separate protein, fat, and carbohydrate recommendation below uses this center."}</MetricExplanation>
        </article>
      </section>
      {result.terminal && interval && <section className={styles.uncertaintyCard} aria-labelledby="goal-probability-uncertainty-heading">
        <div className={styles.uncertaintyMain}>
          <p className={styles.eyebrow}>{uk ? "Точність оцінки" : "Estimate precision"}</p>
          <strong id="goal-probability-uncertainty-heading">{uk ? "Скільки симуляцій досягли цілі" : "How many simulations met the target"}</strong>
          <span className={styles.simulationCount}>{uk
            ? `${result.terminal.attainment.successes} із ${result.terminal.attainment.sampleCount} симуляцій · ${percent(result.terminal.attainment.probability, locale)}`
            : `${result.terminal.attainment.successes} of ${result.terminal.attainment.sampleCount} simulations · ${percent(result.terminal.attainment.probability, locale)}`}</span>
        </div>
        <div className={styles.uncertaintyDetail}>
          <p>{uk
            ? `Змодельована частка — ${percent(result.terminal.attainment.probability, locale)}. Через скінченну кількість симуляцій оцінка має 95% числовий інтервал: ${percent(interval.lower, locale)}–${percent(interval.upper, locale)}.`
            : `The modeled share is ${percent(result.terminal.attainment.probability, locale)}. Because the simulation count is finite, its 95% numerical interval is ${percent(interval.lower, locale)}–${percent(interval.upper, locale)}.`}</p>
          <details className={styles.metricExplanation}>
            <summary>{uk ? "Чому є інтервал" : "Why there is an interval"}</summary>
            <p>{uk
              ? "Якби ми знову виконали скінченну кількість симуляцій, отримана частка могла б трохи відрізнятися. Wilson Monte Carlo interval описує цю похибку оцінювання частки (а не ваги). Він не показує ймовірність правильності моделі й не охоплює всі її припущення та обмеження."
              : "If we ran a finite set of simulations again, the share could differ slightly. The Wilson Monte Carlo interval describes this sampling error in the estimated share, not weight. It is not the probability that the model is correct and does not cover all model assumptions and limitations."}</p>
          </details>
          <span className={styles.intervalValue}>{uk ? "95% інтервал Monte Carlo" : "95% Monte Carlo interval"}: {percent(interval.lower, locale)}–{percent(interval.upper, locale)}</span>
        </div>
      </section>}
      {result.forecast && chartLabels && <section className={`${styles.chartPanel} ${styles.goalChart}`} aria-labelledby="goal-trajectory-heading">
        <div className={styles.chartHeading}>
          <div><p className={styles.eyebrow}>{uk ? "Історія → сценарій → ціль" : "History → scenario → target"}</p><h2 id="goal-trajectory-heading">{chartMetric === "physiologicalBodyWeightKg" ? (uk ? "Траєкторія ваги" : "Weight trajectory") : (uk ? "Траєкторія жирової маси" : "Fat-mass trajectory")}</h2></div>
          <div className={styles.chartTools}>
            <div className={`${styles.historyRange} ${styles.chartMetricRange}`} role="group" aria-label={uk ? "Показник графіка цілі" : "Goal chart metric"}>
              <button type="button" aria-pressed={chartMetric === "physiologicalBodyWeightKg"} onClick={() => setChartMetric("physiologicalBodyWeightKg")}>{uk ? "Вага" : "Weight"}</button>
              <button type="button" aria-pressed={chartMetric === "fatMassKg"} onClick={() => setChartMetric("fatMassKg")}>{uk ? "Жирова маса" : "Fat mass"}</button>
            </div>
            <div className={styles.historyRange} role="group" aria-label={uk ? "Вікно історії на графіку" : "Chart history window"}>
              <button type="button" aria-pressed={chartHistoryRange === "recent"} onClick={() => setChartHistoryRange("recent")}>{uk ? "Остання історія" : "Recent history"}</button>
              <button type="button" aria-pressed={chartHistoryRange === "full"} onClick={() => setChartHistoryRange("full")}>{uk ? "Повна історія" : "Full history"}</button>
            </div>
            <div className={styles.legend} aria-label={uk ? "Легенда траєкторії" : "Trajectory legend"}>
              {chartMetric === "physiologicalBodyWeightKg"
                ? <><span><i className={styles.measuredKey} />{chartLabels.measuredWeight}</span><span><i className={styles.historyKey} />{chartLabels.modelEstimate}</span></>
                : <><span><i className={styles.measuredKey} />{chartLabels.measuredFatMass}</span><span><i className={styles.historyKey} />{chartLabels.historicalEstimate}</span></>}
              <span><i className={styles.medianKey} />{chartLabels.futureMedian}</span>
              {chartLabels.hasQuantileBands ? <><span><i className={styles.innerKey} />{chartLabels.innerInterval}</span><span><i className={styles.outerKey} />{chartLabels.outerInterval}</span></> : <span><i className={styles.outerKey} />{chartLabels.engineeringRange}</span>}
              {chartMetric === "physiologicalBodyWeightKg" && <span><i className={styles.targetKey} />{uk ? "Ціль" : "Target"}</span>}
            </div>
          </div>
        </div>
        <ForecastChart result={result.forecast} metric={chartMetric} history={context?.history ?? []} observedWeights={context?.observedWeights ?? []} locale={locale} historyWindowDays={chartHistoryRange === "recent" ? 21 : null} target={chartMetric === "physiologicalBodyWeightKg" ? { date: result.goal.goalDate, weightKg: result.goal.targetValueKg } : undefined} />
        <p className={styles.chartNote}>{chartMetric === "fatMassKg"
          ? (uk ? "Фактична серія жирової маси розрахована з ваги та записаного відсотка жиру; пунктир — історична оцінка моделі. Ціль задана для ваги, тому на цьому графіку її немає." : "Observed fat mass is derived from recorded weight and body-fat percentage; the dashed line is the historical model estimate. The goal is defined for body weight, so it is not shown on this chart.")
          : (uk ? "Вага з вагів — вимірювання; пунктирна оцінка моделі — історична. Маркер цілі є майбутнім припущенням. Смуги показують невизначеність прогнозу." : "Scale readings are measurements; the dashed model estimate is historical. The goal marker is a future assumption. Shaded bands show forecast uncertainty.")}</p>
      </section>}
      {showPlanCenter && nutritionRecommendation && <section className={`${styles.chartPanel} ${styles.nutritionResult}`} aria-labelledby="goal-nutrition-result-heading">
        <div className={styles.chartHeading}><div><p className={styles.eyebrow}>{uk ? "Результат solver-а" : "Solver result"}</p><h2 id="goal-nutrition-result-heading">{uk ? "Рекомендоване харчування" : "Recommended nutrition"}</h2></div></div>
        <div className={styles.recommendedMacros} aria-label={uk ? "Планова калорійність і рекомендація БЖВ" : "Planned calories and macro recommendation"}>
          <article><span>{uk ? "Калорійність" : "Calories"}</span><strong>{displayPlanValue(nutritionRecommendation.nutrition.caloriesKcal, locale)}</strong><small>{uk ? "ккал/день · вибрав solver" : "kcal/day · solver-selected"}</small></article>
          <article><span>{uk ? "Білок" : "Protein"}</span><strong>{displayPlanValue(nutritionRecommendation.nutrition.proteinG, locale)}</strong><small>{uk ? "г/день" : "g/day"}</small></article>
          <article><span>{uk ? "Жири" : "Fat"}</span><strong>{displayPlanValue(nutritionRecommendation.nutrition.fatG, locale)}</strong><small>{uk ? "г/день" : "g/day"}</small></article>
          <article><span>{uk ? "Вуглеводи" : "Carbs"}</span><strong>{displayPlanValue(nutritionRecommendation.nutrition.carbsG, locale)}</strong><small>{uk ? "г/день" : "g/day"}</small></article>
        </div>
        <p className={styles.recommendationNote}>{uk
          ? "Білок розраховано за поточною вагою та типом тренувань; жири й вуглеводи розподіляють решту енергії в межах загальних дорослих орієнтирів. Додаткові межі Б/Ж/В вище обмежують пошук solver-а, але не змінюють цю окрему рекомендацію. Це не медичний припис."
          : "Protein uses current weight and planned training; fat and carbohydrate split the remaining energy within general adult reference ranges. The optional gram limits above constrain the solver search but do not change this separate recommendation. This is not a medical prescription."}</p>
        {nutritionLimitations.length > 0 && <ul className={styles.nutritionLimitations}>{nutritionLimitations.map((code) => <li key={code}>{nutritionLimitationText(code, uk)}</li>)}</ul>}
      </section>}
      <section className={styles.detailGrid}><article><h2>{uk ? "Введені припущення" : "Submitted assumptions"}</h2><dl><div><dt>{uk ? "Ціль" : "Target"}</dt><dd>{result.goal.targetValueKg} kg · {result.goal.goalDate}</dd></div><div><dt>{uk ? "Межі калорій" : "Calorie bounds"}</dt><dd>{result.assumptions.constraints.minCaloriesKcal}–{result.assumptions.constraints.maxCaloriesKcal} kcal</dd></div><div><dt>{uk ? "Сценарій" : "Scenario"}</dt><dd>{goalScenarioModeLabel(result.assumptions.scenarioMode, locale)}</dd></div><div><dt>{uk ? "Середні кроки" : "Average steps"}</dt><dd>{new Intl.NumberFormat(uk ? "uk-UA" : "en-US").format(form.plan.averageStepsPerDay)} / {uk ? "день" : "day"}</dd></div><div><dt>{uk ? "Тренування" : "Training"}</dt><dd>{form.plan.strengthDaysPerWeek} × {form.plan.strengthTrainingMinutes} {uk ? "хв силових" : "min strength"} · {form.plan.otherTrainingDaysPerWeek} × {form.plan.otherTrainingMinutes} {uk ? "хв інших" : "min other"}</dd></div><div><dt>{uk ? "Робочі дні" : "Work days"}</dt><dd>{form.plan.plannedWork ? `${form.plan.workDaysPerWeek} / ${uk ? "тиждень" : "week"}` : "—"}</dd></div></dl></article><article><h2>{uk ? "Якість і обмеження" : "Quality and limitations"}</h2><ul><li>{uk ? "Як модель отримала поточний стан" : "How the model obtained the current state"}: {result.provenance.initialStateQuality ? <ModelStateSource value={result.provenance.initialStateQuality} uk={uk} /> : "—"}</li><li>{uk ? "Якість Forecast" : "Forecast quality"}: {result.numerical.forecastQuality ?? "—"}</li><li>{uk ? "Числова похибка solver-а" : "Solver tolerance"}: {result.numerical.solverToleranceKg} kg</li><li>{uk ? "Смуга ймовірності поблизу цілі" : "Near-target probability band"}: ±{result.numerical.goalToleranceKg} kg ({uk ? "технічне налаштування" : "engineering setting"})</li><li>{uk ? "Локальна чутливість" : "Local sensitivity"}: {result.numerical.localSensitivityKgPer100Kcal === null ? "—" : `${result.numerical.localSensitivityKgPer100Kcal.toFixed(2)} kg / 100 kcal`}</li>{result.warnings.map((warning) => <li key={warning}>{goalWarningLabel(warning, locale)}</li>)}</ul></article></section>
    </>}
      </section>
    </div>}
  </main>;
}
