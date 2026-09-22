"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { HelpTip } from "@/components/help-tip";
import { ModelStateSource } from "@/components/model-state-source";
import { useI18n } from "@/i18n/i18n-provider";
import type { DiagnosticGate, DiagnosticLevel, DiagnosticsDto } from "@/modules/model-diagnostics/model-diagnostics.types";
import {
  modelNeedsRecalculation,
  recalculateModelPresentation,
} from "@/modules/model-forecast/forecast-ui";
import styles from "./diagnostics.module.css";

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
  const [data, setData] = useState<DiagnosticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const loadDiagnostics = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/diagnostics", { cache: "no-store", signal });
    if (!response.ok) {
      throw new Error(response.status === 404
        ? (uk ? "Немає активної моделі." : "No active model.")
        : (uk ? "Не вдалося завантажити діагностику." : "Could not load diagnostics."));
    }
    return response.json() as Promise<DiagnosticsDto>;
  }, [uk]);

  useEffect(() => {
    const controller = new AbortController();
    loadDiagnostics(controller.signal)
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [loadDiagnostics]);

  async function runRecalculate() {
    setRecalculating(true);
    setError(null);
    try {
      const response = await fetch("/api/forecast/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recalculate" }),
      });
      if (!response.ok) {
        throw new Error(uk ? "Не вдалося перерахувати модель." : "Could not recalculate the model.");
      }
      setData(await loadDiagnostics());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRecalculating(false);
    }
  }

  const personalization = data ? personalizationCopy(data.personalization.status, uk) : null;
  const needsRecalculation = data
    ? modelNeedsRecalculation({
      daysModeled: data.dataContinuity.modeledDayCount,
      latestModeledDate: data.episode.latestModeledDate,
      currentPredictedWeightKg: data.currentState.predictedWeightKg,
    })
    : false;

  return <main className={styles.page}>
    <div className={styles.topbar}><Link className={styles.brand} href="/dashboard">BodyCast<span>{uk ? "Прозорість моделі" : "Model transparency"}</span></Link><AppNav active="diagnostics" /></div>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>{uk ? "Діагностика · не оцінка здоров’я" : "Diagnostics · not a health score"}</p><h1>{uk ? "Що модель знає — і чого не знає." : "What the model knows—and what it does not."}</h1><p>{uk ? "Тут кілька окремих перевірок: дані, підлаштування під вас, пропуски й прогноз. Одного спільного бала немає." : "There are several separate checks: data, tuning to you, gaps, and forecast. There is no single overall score."}</p></div>
    </header>
    {!data && !error && <section className={styles.loading} aria-live="polite">{uk ? "Завантажуємо стан моделі…" : "Loading model status…"}</section>}
    {error && <section className={styles.error} role="alert"><strong>{uk ? "Діагностика недоступна" : "Diagnostics unavailable"}</strong><span>{error}</span><div className={styles.actions}><button type="button" disabled={recalculating} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? recalculateCopy.loadingAction : recalculateCopy.action}</button><Link href="/dashboard">{uk ? "Перейти до огляду" : "Go to dashboard"}</Link></div></section>}
    {data && <>
      <section className={styles.recalculateBanner} aria-label={recalculateCopy.action}>
        <div><strong>{needsRecalculation ? (uk ? "Порахованих днів ще немає" : "No calculated days yet") : (uk ? "Оновити пораховану історію" : "Refresh calculated history")}<HelpTip>{uk ? "Кнопка бере записи з таблиці «Історія», заново рахує фізіологічну модель, зберігає результат і за потреби сама оцінює стан після пропуску для Діагностики, Прогнозу та Цілі. Самі записи здоров’я вона не змінює." : "This reads Health History, recalculates the physiology model, saves results, and when needed estimates state after a data gap for Diagnostics, Forecast, and Goal. It does not edit health records."}</HelpTip></strong><span>{recalculateCopy.hint}</span></div>
        <button type="button" className={needsRecalculation ? styles.recalculatePrimary : styles.recalculateSecondary} disabled={recalculating} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? recalculateCopy.loadingAction : recalculateCopy.action}</button>
      </section>

      <section className={styles.overview} aria-label={uk ? "Огляд стану моделі" : "Model status overview"}>
        <article data-level={data.currentState.level}><div className={styles.cardTop}><span>{uk ? "Поточна вага моделі" : "Current model weight"}<HelpTip>{uk ? "Внутрішня оцінка складу тіла після останнього порахованого дня. Вона може не збігатися з ранковим показом вагів через воду, їжу та шум вимірювання." : "The internal body-state estimate after the latest calculated day. It can differ from a morning scale reading because of water, food, and measurement noise."}</HelpTip></span><b>{levelLabel(data.currentState.level, uk)}</b></div><strong>{currentStateTitle(data.currentState.status, uk)}</strong><p>{uk ? "Тип оцінки" : "Estimate type"}: {data.currentState.source ? <ModelStateSource value={data.currentState.source} uk={uk} /> : "—"}</p></article>
        <article data-level={data.dataContinuity.level}><div className={styles.cardTop}><span>{uk ? "Дані · до 28 днів" : "Data · up to 28 days"}<HelpTip>{uk ? "Перше число — дні, які модель змогла повністю порахувати; друге — усі збережені модельні дні у вікні. Це не кількість рядків у таблиці здоров’я." : "The first number is fully calculated days; the second is all saved model days in the window. This is not the row count in Health History."}</HelpTip></span><b>{levelLabel(data.dataContinuity.level, uk)}</b></div><strong>{data.dataContinuity.completeDayCount}/{data.dataContinuity.modeledDayCount} {uk ? "повних порахованих днів" : "complete calculated days"}</strong><p>{uk ? "Зважувань" : "Weigh-ins"}: {data.dataContinuity.weightObservationCount} · {uk ? "днів без калорій" : "days without calories"}: {data.dataContinuity.nutrition.unresolvedDayCount}</p></article>
        <article data-level={data.personalization.level}><div className={styles.cardTop}><span>{uk ? "Підлаштування під вас" : "Tuning to you"}<HelpTip>{uk ? "Модель порівнює прогнозовану й записану вагу. Коли є достатньо довга та різноманітна історія, вона може обережно скоригувати енергобаланс і реакцію на активність." : "The model compares predicted and logged weight. With enough long and varied history, it can cautiously tune energy balance and activity response."}</HelpTip></span><b>{levelLabel(data.personalization.level, uk)}</b></div><strong>{personalization?.[0]}</strong><p>{personalization?.[1]}</p></article>
        <article data-level={data.forecastReadiness.level}><div className={styles.cardTop}><span>{uk ? "Прогноз" : "Forecast"}</span><b>{levelLabel(data.forecastReadiness.level, uk)}</b></div><strong>{data.forecastReadiness.allowed ? (uk ? "Можна будувати" : "Ready to run") : (uk ? "Поки заблоковано" : "Currently blocked")}</strong><p>{data.forecastReadiness.initialStateSource ? <>{uk ? "Тип стартової оцінки" : "Starting estimate type"}: <ModelStateSource value={data.forecastReadiness.initialStateSource} uk={uk} /></> : data.forecastReadiness.reasons.map((reason) => forecastReasonLabel(reason, uk)).join(", ")}</p></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Поточна оцінка" : "Current estimate"}<HelpTip>{uk ? "Розрахований внутрішній стан тіла на кінець останнього обробленого дня. Вага Hall = жир + нежирова тканина + глікоген з водою + позаклітинна рідина (ECF)." : "The calculated internal body state at the end of the latest processed day. Hall weight = fat + lean tissue + glycogen with water + extracellular fluid (ECF)."}</HelpTip></p><h2>{uk ? "Що модель оцінює зараз" : "What the model estimates now"}</h2><dl className={styles.metrics}><div><dt>{uk ? "Розрахункова вага" : "Estimated weight"}</dt><dd>{number(data.currentState.predictedWeightKg, 1)} kg</dd></div><div><dt>{uk ? "Жир" : "Fat mass"}</dt><dd>{number(data.currentState.fatMassKg, 1)} kg</dd></div><div><dt>{uk ? "Нежирова тканина (без глікогену й ECF)" : "Lean tissue (excl. glycogen & ECF)"}<HelpTip>{uk ? "Компартмент leanTissueKg моделі Hall/Forbes — це не скелетний м’яз і не вся маса без жиру. Глікоген з водою та позаклітинна рідина показані окремо." : "Hall/Forbes leanTissueKg is not skeletal muscle and not all non-fat mass. Glycogen with water and extracellular fluid are shown separately."}</HelpTip></dt><dd>{number(data.currentState.leanTissueKg, 1)} kg</dd></div><div><dt>{uk ? "Глікоген, вода й ECF" : "Glycogen, water & ECF"}<HelpTip>{uk ? "Залишок, що замикає рівняння ваги: розрахункова вага − жир − нежирова тканина." : "The residual that closes the weight equation: estimated weight − fat − lean tissue."}</HelpTip></dt><dd>{number(data.currentState.glycogenAndExtracellularFluidMassKg, 1)} kg</dd></div><div><dt>{uk ? "Скільки витрачаєте за день" : "Daily burn"}</dt><dd>{number(data.currentState.modeledTdeeKcalPerDay)} kcal</dd></div></dl><p className={styles.note}>{uk ? "Це розрахунковий стан тіла після останнього обробленого дня. Ранкове зважування може відрізнятися через воду, їжу в травній системі та звичайну похибку вагів." : "This is the calculated body state after the latest processed day. A morning weigh-in can differ because of water, food in the digestive system, and ordinary scale noise."}</p>{data.experimentalEnergySummary ? <dl className={styles.metrics}><div><dt>{uk ? "RMR / спокій" : "Resting RMR"}</dt><dd>{number(data.experimentalEnergySummary.restingRmrKcalPerDay)} kcal</dd></div><div><dt>{uk ? "Типова підтримка (28 днів)" : "Typical maintenance (28 days)"}</dt><dd>{number(data.experimentalEnergySummary.recentTypicalMaintenanceKcalPerDay)} kcal</dd></div><div><dt>{uk ? "Останній змодельований день" : "Latest modeled day"}</dt><dd>{number(data.experimentalEnergySummary.latestModeledExpenditureKcalPerDay)} kcal</dd></div><div><dt>{uk ? "Сьогодні" : "Today"}</dt><dd>{number(data.experimentalEnergySummary.todayEstimatedExpenditureKcalPerDay)} kcal</dd></div></dl> : null}</article>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Звідки взялись дані" : "Where the data came from"}<HelpTip>{uk ? "Показує, скільки днів у вибраному періоді мають ваш запис калорій, скільки модель обережно заповнила за сусідніми днями та скільки залишилися без даних про харчування." : "Shows how many days in the selected period use your calorie log, were cautiously filled from nearby days, or still have no nutrition data."}</HelpTip></p><h2>{uk ? "Дані про харчування за період" : "Nutrition data for the period"}</h2><div className={styles.provenance}><span><i data-kind="observed" />{uk ? "Записано вами" : "Logged by you"}<b>{data.dataContinuity.nutrition.observedDayCount}</b></span><span><i data-kind="imputed" />{uk ? "Підставлено з сусідніх днів" : "Filled from nearby days"}<b>{data.dataContinuity.nutrition.imputedDayCount}</b></span><span><i data-kind="missing" />{uk ? "Без калорій" : "Missing calories"}<b>{data.dataContinuity.nutrition.unresolvedDayCount}</b></span></div><p className={styles.note}>{uk ? "Якщо за день не записано окремий робочий інтервал, модель вважає, що того дня не було додаткової активності на роботі. Інші записи цього дня — харчування, кроки, тренування та вага — не вважаються втраченими." : "If no separate work interval is logged for a day, the model assumes there was no additional occupational activity. Other records for that day—nutrition, steps, workouts, and weight—are not treated as missing."}</p></article>
      </section>

      <section className={styles.panel}><div className={styles.sectionHead}><div><p className={styles.eyebrow}>{uk ? "Прийняті налаштування" : "Accepted settings"}</p><h2>{uk ? "Коли модель підлаштовується під вас" : "When the model tunes to you"}</h2></div><span className={styles.statusPill} data-level={data.personalization.level}>{personalization?.[0]}</span></div><p>{personalization?.[1]}</p><div className={styles.gates}>{data.personalization.gates.map((gate) => { const help = gateHelp(gate, uk); return <div key={gate.id} data-met={gate.met}><span>{gateLabel(gate, uk)}{help && <HelpTip>{help}</HelpTip>}</span><strong>{number(gate.current, gate.unit === "coefficient-of-variation" ? 2 : 0)} / {gate.required}{gate.unit === "kcal/day-sd" ? (uk ? " ккал/день" : " kcal/day SD") : gate.unit === "days" ? ` ${uk ? "днів" : "days"}` : ""}</strong><small>{gate.met ? (uk ? "достатньо" : "enough") : (uk ? "ще мало" : "not enough yet")}</small></div>; })}</div><p className={styles.note}>{uk ? "Це обережні технічні пороги, не медичні норми. Налаштування приймаються лише якщо перевірка на відкладених даних теж покращується." : "These are careful technical thresholds, not medical norms. Settings are accepted only when a held-out check also improves."}</p></section>

      <section className={styles.grid}>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Пропуски в історії" : "Gaps in history"}</p><h2>{uk ? "Як пропуски вплинули на оцінку" : "How gaps affected the estimate"}<HelpTip>{uk ? "Критичний пропуск — це ділянка, де бракує даних, потрібних для послідовного розрахунку стану тіла. Тут показані точні дати та наслідок для поточної оцінки." : "A critical gap is a period missing data required for a sequential body-state calculation. This card shows the exact dates and the effect on the current estimate."}</HelpTip></h2><p className={styles.largeStatus}>{recoveryStatusLabel(data.recovery.status, uk)}</p>{data.recovery.gaps.length > 0 ? <ul className={styles.gapList}>{data.recovery.gaps.map((gap) => <li key={`${gap.startDate}-${gap.endDate}`}><strong>{formatDiagnosticDate(gap.startDate, intlLocale)}{gap.endDate && gap.endDate !== gap.startDate ? ` — ${formatDiagnosticDate(gap.endDate, intlLocale)}` : ""}</strong><span>{gap.durationDays} {uk ? "дн." : "days"}</span></li>)}</ul> : <p>{uk ? "У порахованій історії немає ділянок, які розривають розрахунок." : "There are no periods in the calculated history that break the calculation."}</p>}<p>{data.currentState.source ? <>{uk ? "Через це використовується тип оцінки" : "This results in the estimate type"}: <ModelStateSource value={data.currentState.source} uk={uk} />.</> : (uk ? "Надійної поточної оцінки поки немає, тому прогноз заблоковано." : "There is no reliable current estimate yet, so forecasting is blocked.")}</p></article>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Наступна дія" : "Next action"}</p><h2>{data.forecastReadiness.allowed ? (uk ? "Спробувати сценарій" : "Try a scenario") : (uk ? "Спочатку покращити старт" : "Improve the starting point first")}</h2><p>{data.forecastReadiness.allowed ? (uk ? "Прогноз доступний, але діапазон лишається «можливо так», а не гарантією." : "Forecasting is available, but the range remains “maybe,” not a guarantee.") : (uk ? "Перевірте дірки в даних або дочекайтеся нових зважувань. Якщо в таблиці здоров’я вже є дні — перерахуйте модель." : "Check data gaps or wait for new weigh-ins. If the health table already has days, recalculate the model.")}</p><div className={styles.actions}><button type="button" disabled={recalculating} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? recalculateCopy.loadingAction : recalculateCopy.action}</button><Link href="/forecast">{uk ? "Відкрити прогноз" : "Open forecast"}</Link><Link href="/history">{uk ? "Перевірити історію" : "Review history"}</Link></div></article>
      </section>

      <section className={styles.panel}><p className={styles.eyebrow}>{uk ? "Межі інтерпретації" : "Interpretation limits"}</p><h2>{uk ? "Що не варто висновувати" : "What not to infer"}</h2><ul className={styles.limitations}>{data.limitations.map((item) => <li key={item.id}>{limitationCopy(item.id, uk)}</li>)}</ul></section>
      <p className={styles.technicalIntro}>{uk ? "Службова інформація про розрахунок: версія алгоритму, час оновлення та показники якості. Вона потрібна переважно для перевірки й пошуку помилок; для щоденного користування її можна не відкривати." : "Calculation metadata: algorithm version, update time, and quality metrics. It is mainly for verification and troubleshooting and can stay closed in everyday use."}</p>
      <details className={styles.technical}><summary onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const details = event.currentTarget.parentElement as HTMLDetailsElement | null;
        if (details) details.open = !details.open;
      }}>{uk ? "Технічні деталі" : "Technical details"}</summary><dl><div><dt>{uk ? "Версія моделі" : "Model version"}</dt><dd>{data.episode.modelVersion}</dd></div><div><dt>{uk ? "Оновлено" : "Updated"}</dt><dd>{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: data.episode.timezone }).format(new Date(data.episode.updatedAt))}</dd></div><div><dt>{uk ? "Статус калібрування" : "Calibration status"}</dt><dd>{data.personalization.status}</dd></div><div><dt>{uk ? "Оцінена корекція енергобалансу" : "Estimated energy-balance correction"}</dt><dd>{number(data.personalization.initialization.estimatedCorrectionKcalPerDay)} kcal/day</dd></div><div><dt>{uk ? "Впевненість initialization" : "Initialization confidence"}</dt><dd>{data.personalization.initialization.confidence}</dd></div><div><dt>{uk ? "Застосована корекція" : "Applied correction"}</dt><dd>{number(data.personalization.initialization.appliedCorrectionKcalPerDay)} kcal/day · {data.personalization.initialization.applied ? (uk ? "застосовано" : "applied") : (uk ? "не застосовано" : "not applied")}</dd></div><div><dt>{uk ? "Пояснення" : "Explanation"}</dt><dd>{uk && !data.personalization.initialization.applied ? "Оцінку збережено для аудиту, але не застосовано без сильніших незалежних доказів." : data.personalization.initialization.explanation}</dd></div><div><dt>{uk ? "Масштаб активності" : "Activity scale"}</dt><dd>{number(data.personalization.activityCalibration, 3)}</dd></div><div><dt>Recovery ESS</dt><dd>{number(data.recovery.normalizedEffectiveSampleSize, 3)}</dd></div><div><dt>{uk ? "Макс. вага частинки" : "Maximum particle weight"}</dt><dd>{number(data.recovery.maximumWeight, 3)}</dd></div><div><dt>{uk ? "Алгоритм відновлення" : "Recovery algorithm"}</dt><dd>{data.recovery.algorithmVersion ?? "—"}</dd></div></dl></details>
    </>}
  </main>;
}
