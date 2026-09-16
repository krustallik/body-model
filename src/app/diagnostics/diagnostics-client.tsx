"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { HelpTip } from "@/components/help-tip";
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
        <div><strong>{needsRecalculation ? (uk ? "Порахованих днів ще немає" : "No calculated days yet") : (uk ? "Оновити пораховану історію" : "Refresh calculated history")}<HelpTip>{uk ? "Кнопка бере записи з таблиці «Історія», заново рахує фізіологічну модель і зберігає результат для Діагностики, Прогнозу та Цілі. Самі записи здоров’я вона не змінює." : "This reads Health History, recalculates the physiology model, and saves results for Diagnostics, Forecast, and Goal. It does not edit health records."}</HelpTip></strong><span>{recalculateCopy.hint}</span></div>
        <button type="button" className={needsRecalculation ? styles.recalculatePrimary : styles.recalculateSecondary} disabled={recalculating} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? recalculateCopy.loadingAction : recalculateCopy.action}</button>
      </section>

      <section className={styles.overview} aria-label={uk ? "Огляд стану моделі" : "Model status overview"}>
        <article data-level={data.currentState.level}><div className={styles.cardTop}><span>{uk ? "Поточна вага моделі" : "Current model weight"}<HelpTip>{uk ? "Внутрішня оцінка складу тіла після останнього порахованого дня. Вона може не збігатися з ранковим показом вагів через воду, їжу та шум вимірювання." : "The internal body-state estimate after the latest calculated day. It can differ from a morning scale reading because of water, food, and measurement noise."}</HelpTip></span><b>{levelLabel(data.currentState.level, uk)}</b></div><strong>{currentStateTitle(data.currentState.status, uk)}</strong><p>{uk ? "Звідки" : "Source"}: {data.currentState.source ?? "—"}</p></article>
        <article data-level={data.dataContinuity.level}><div className={styles.cardTop}><span>{uk ? "Дані · до 28 днів" : "Data · up to 28 days"}<HelpTip>{uk ? "Перше число — дні, які модель змогла повністю порахувати; друге — усі збережені модельні дні у вікні. Це не кількість рядків у таблиці здоров’я." : "The first number is fully calculated days; the second is all saved model days in the window. This is not the row count in Health History."}</HelpTip></span><b>{levelLabel(data.dataContinuity.level, uk)}</b></div><strong>{data.dataContinuity.completeDayCount}/{data.dataContinuity.modeledDayCount} {uk ? "повних порахованих днів" : "complete calculated days"}</strong><p>{uk ? "Зважувань" : "Weigh-ins"}: {data.dataContinuity.weightObservationCount} · {uk ? "днів без калорій" : "days without calories"}: {data.dataContinuity.nutrition.unresolvedDayCount}</p></article>
        <article data-level={data.personalization.level}><div className={styles.cardTop}><span>{uk ? "Підлаштування під вас" : "Tuning to you"}<HelpTip>{uk ? "Модель порівнює прогнозовану й записану вагу. Коли є достатньо довга та різноманітна історія, вона може обережно скоригувати енергобаланс і реакцію на активність." : "The model compares predicted and logged weight. With enough long and varied history, it can cautiously tune energy balance and activity response."}</HelpTip></span><b>{levelLabel(data.personalization.level, uk)}</b></div><strong>{personalization?.[0]}</strong><p>{personalization?.[1]}</p></article>
        <article data-level={data.forecastReadiness.level}><div className={styles.cardTop}><span>{uk ? "Прогноз" : "Forecast"}</span><b>{levelLabel(data.forecastReadiness.level, uk)}</b></div><strong>{data.forecastReadiness.allowed ? (uk ? "Можна будувати" : "Ready to run") : (uk ? "Поки заблоковано" : "Currently blocked")}</strong><p>{data.forecastReadiness.initialStateSource ? `${uk ? "Старт з" : "Starting from"}: ${data.forecastReadiness.initialStateSource}` : data.forecastReadiness.reasons.map((reason) => forecastReasonLabel(reason, uk)).join(", ")}</p></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Поточна оцінка" : "Current estimate"}</p><h2>{uk ? "Що модель думає зараз" : "What the model thinks now"}</h2><dl className={styles.metrics}><div><dt>{uk ? "Вага моделі" : "Model weight"}</dt><dd>{number(data.currentState.predictedWeightKg, 1)} kg</dd></div><div><dt>{uk ? "Жир" : "Fat mass"}</dt><dd>{number(data.currentState.fatMassKg, 1)} kg</dd></div><div><dt>{uk ? "М’язи й інше без жиру" : "Lean (non-fat) mass"}</dt><dd>{number(data.currentState.leanTissueKg, 1)} kg</dd></div><div><dt>{uk ? "Скільки витрачаєте за день" : "Daily burn"}</dt><dd>{number(data.currentState.modeledTdeeKcalPerDay)} kcal</dd></div></dl><p className={styles.note}>{limitationCopy("latent-state-not-scale-reading", uk)}</p></article>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Звідки взялись дані" : "Where the data came from"}</p><h2>{uk ? "Безперервність історії" : "History continuity"}</h2><div className={styles.provenance}><span><i data-kind="observed" />{uk ? "Записано вами" : "Logged by you"}<b>{data.dataContinuity.nutrition.observedDayCount}</b></span><span><i data-kind="imputed" />{uk ? "Підставлено з сусідніх днів" : "Filled from nearby days"}<b>{data.dataContinuity.nutrition.imputedDayCount}</b></span><span><i data-kind="missing" />{uk ? "Без калорій" : "Missing calories"}<b>{data.dataContinuity.nutrition.unresolvedDayCount}</b></span></div><p className={styles.note}>{uk ? "Якщо робочого інтервалу немає — це 0 роботи того дня, а не «дані загубились»." : "No work interval means 0 work that day, not “missing data.”"}</p></article>
      </section>

      <section className={styles.panel}><div className={styles.sectionHead}><div><p className={styles.eyebrow}>{uk ? "Прийняті налаштування" : "Accepted settings"}</p><h2>{uk ? "Коли модель підлаштовується під вас" : "When the model tunes to you"}</h2></div><span className={styles.statusPill} data-level={data.personalization.level}>{personalization?.[0]}</span></div><p>{personalization?.[1]}</p><div className={styles.gates}>{data.personalization.gates.map((gate) => <div key={gate.id} data-met={gate.met}><span>{gateLabel(gate, uk)}</span><strong>{number(gate.current, gate.unit === "coefficient-of-variation" ? 2 : 0)} / {gate.required}{gate.unit === "kcal/day-sd" ? " kcal/day SD" : gate.unit === "days" ? ` ${uk ? "днів" : "days"}` : ""}</strong><small>{gate.met ? (uk ? "достатньо" : "enough") : (uk ? "ще мало" : "not enough yet")}</small></div>)}</div><p className={styles.note}>{uk ? "Це обережні технічні пороги, не медичні норми. Налаштування приймаються лише якщо перевірка на відкладених даних теж покращується." : "These are careful technical thresholds, not medical norms. Settings are accepted only when a held-out check also improves."}</p></section>

      <section className={styles.grid}>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Пропуски в історії" : "Gaps in history"}</p><h2>{uk ? "Закриття пропусків" : "Closing gaps"}<HelpTip>{uk ? "Довга ділянка без калорій або активності розриває послідовний розрахунок. Додайте відсутні записи в Історії та перерахуйте модель; якщо даних немає, відновлення оцінює можливий стан із невизначеністю." : "A long stretch without nutrition or activity breaks the sequential calculation. Add missing History records and recalculate; if data is unavailable, recovery estimates a possible state with uncertainty."}</HelpTip></h2><p className={styles.largeStatus}>{data.recovery.status}</p><p>{data.recovery.status === "not-required" ? (uk ? "Великих дірок немає; беремо звичайну оцінку." : "No big holes; the ordinary estimate is used.") : data.recovery.usableForForecast ? (uk ? "Пропуск оцінено; прогноз можна будувати з позначкою якості." : "The gap was estimated; forecasting can run with a quality label.") : (uk ? "Прогноз не стартує, доки стартова вага ненадійна." : "Forecasting stays blocked while the starting weight is unreliable.")}</p></article>
        <article className={styles.panel}><p className={styles.eyebrow}>{uk ? "Наступна дія" : "Next action"}</p><h2>{data.forecastReadiness.allowed ? (uk ? "Спробувати сценарій" : "Try a scenario") : (uk ? "Спочатку покращити старт" : "Improve the starting point first")}</h2><p>{data.forecastReadiness.allowed ? (uk ? "Прогноз доступний, але діапазон лишається «можливо так», а не гарантією." : "Forecasting is available, but the range remains “maybe,” not a guarantee.") : (uk ? "Перевірте дірки в даних або дочекайтеся нових зважувань. Якщо в таблиці здоров’я вже є дні — перерахуйте модель." : "Check data gaps or wait for new weigh-ins. If the health table already has days, recalculate the model.")}</p><div className={styles.actions}><button type="button" disabled={recalculating} aria-busy={recalculating} onClick={() => void runRecalculate()}>{recalculating ? recalculateCopy.loadingAction : recalculateCopy.action}</button><Link href="/forecast">{uk ? "Відкрити прогноз" : "Open forecast"}</Link><Link href="/history">{uk ? "Перевірити історію" : "Review history"}</Link></div></article>
      </section>

      <section className={styles.panel}><p className={styles.eyebrow}>{uk ? "Межі інтерпретації" : "Interpretation limits"}</p><h2>{uk ? "Що не варто висновувати" : "What not to infer"}</h2><ul className={styles.limitations}>{data.limitations.map((item) => <li key={item.id}>{limitationCopy(item.id, uk)}</li>)}</ul></section>
      <details className={styles.technical}><summary onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const details = event.currentTarget.parentElement as HTMLDetailsElement | null;
        if (details) details.open = !details.open;
      }}>{uk ? "Технічні деталі" : "Technical details"}</summary><dl><div><dt>{uk ? "Версія моделі" : "Model version"}</dt><dd>{data.episode.modelVersion}</dd></div><div><dt>{uk ? "Оновлено" : "Updated"}</dt><dd>{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: data.episode.timezone }).format(new Date(data.episode.updatedAt))}</dd></div><div><dt>{uk ? "Статус калібрування" : "Calibration status"}</dt><dd>{data.personalization.status}</dd></div><div><dt>{uk ? "Оцінена корекція енергобалансу" : "Estimated energy-balance correction"}</dt><dd>{number(data.personalization.initialization.estimatedCorrectionKcalPerDay)} kcal/day</dd></div><div><dt>{uk ? "Впевненість initialization" : "Initialization confidence"}</dt><dd>{data.personalization.initialization.confidence}</dd></div><div><dt>{uk ? "Застосована корекція" : "Applied correction"}</dt><dd>{number(data.personalization.initialization.appliedCorrectionKcalPerDay)} kcal/day · {data.personalization.initialization.applied ? (uk ? "застосовано" : "applied") : (uk ? "не застосовано" : "not applied")}</dd></div><div><dt>{uk ? "Пояснення" : "Explanation"}</dt><dd>{uk && !data.personalization.initialization.applied ? "Оцінку збережено для аудиту, але не застосовано без сильніших незалежних доказів." : data.personalization.initialization.explanation}</dd></div><div><dt>{uk ? "Масштаб активності" : "Activity scale"}</dt><dd>{number(data.personalization.activityCalibration, 3)}</dd></div><div><dt>Recovery ESS</dt><dd>{number(data.recovery.normalizedEffectiveSampleSize, 3)}</dd></div><div><dt>{uk ? "Макс. вага частинки" : "Maximum particle weight"}</dt><dd>{number(data.recovery.maximumWeight, 3)}</dd></div><div><dt>{uk ? "Алгоритм відновлення" : "Recovery algorithm"}</dt><dd>{data.recovery.algorithmVersion ?? "—"}</dd></div></dl></details>
    </>}
  </main>;
}
