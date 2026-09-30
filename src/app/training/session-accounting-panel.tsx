"use client";

import type {
  LoadAccountingBreakdownContributionV1,
  LoadAccountingBreakdownRowV1,
  LoadAccountingOutputV1,
  LoadMetricV1,
} from "@/modules/training/load-accounting-v1";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import styles from "./training.module.css";

type Props = {
  session: StrengthSessionDto;
  uk: boolean;
  onMaterialize?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  error?: string | null;
};

function numberText(value: number, uk: boolean): string {
  return new Intl.NumberFormat(uk ? "uk-UA" : "en-GB", { maximumFractionDigits: 2 }).format(value);
}

function availabilityLabel(value: "available" | "partial" | "unavailable", uk: boolean): string {
  if (value === "available") return uk ? "Доступно" : "Available";
  if (value === "partial") return uk ? "Частково" : "Partial";
  return uk ? "Недоступно" : "Unavailable";
}

function MetricCard<Unit extends string>({
  label,
  metric,
  uk,
}: {
  label: string;
  metric: LoadMetricV1<Unit>;
  uk: boolean;
}) {
  const unitText = metric.unit === "kg-repetitions" ? (uk ? "кг × повтори" : "kg × reps")
    : metric.unit === "nominal-kg-repetitions-per-logged-side" ? (uk ? "номінальні кг × повтори на записану сторону" : "nominal kg × reps per logged side")
      : metric.unit === "nominal-kg-repetitions-per-side" ? (uk ? "номінальні кг × повтори на сторону" : "nominal kg × reps per side")
        : metric.unit === "bodyweight-reference-kg-repetitions" ? (uk ? "кг референсу × повтори" : "reference kg × reps")
          : metric.unit === "sets" ? (uk ? "підходів" : "sets")
            : metric.unit === "repetitions" ? (uk ? "повторень" : "reps") : metric.unit;
  return (
    <article className={styles.accountingMetric}>
      <div className={styles.accountingMetricHead}>
        <h3>{label}</h3>
        <span className={styles.accountingAvailability} data-state={metric.availability}>
          {availabilityLabel(metric.availability, uk)}
        </span>
      </div>
      <p className={styles.accountingMetricValue}>
        {metric.value === null ? (uk ? "Немає значення" : "No value") : numberText(metric.value, uk)}
      </p>
      <p className={styles.accountingMetricUnit}>{unitText}</p>
      <p className={styles.accountingMetricCoverage}>
        {uk ? "Покриття" : "Coverage"}: {metric.coverage.accountedRows}/{metric.coverage.eligibleRows}
        {metric.coverage.omittedRows > 0
          ? ` · ${uk ? "пропущено" : "omitted"} ${metric.coverage.omittedRows}`
          : ""}
      </p>
    </article>
  );
}

function bodyweightDescription(accounting: LoadAccountingOutputV1, uk: boolean): string {
  const ref = accounting.bodyweight.reference;
  if (ref.status === "unavailable") {
    return uk ? "Історичний референс маси недоступний; значення не замінено нулем." : "Historical bodyweight reference unavailable; no zero value was substituted.";
  }
  if (ref.status === "observed") {
    return uk
      ? `Точне вимірювання ${ref.localDate} · ${numberText(ref.valueKg, uk)} кг. Це збережений референс сесії.`
      : `Exact observation on ${ref.localDate} · ${numberText(ref.valueKg, uk)} kg. This is the session's saved reference.`;
  }
  if (ref.status === "nearest-observed") {
    return uk
      ? `Приблизно, вимірювання ${ref.observationLocalDate} (${ref.dayOffset > 0 ? "+" : ""}${ref.dayOffset} дн.) · ${numberText(ref.valueKg, uk)} кг.`
      : `Approximate, measured ${ref.observationLocalDate} (${ref.dayOffset > 0 ? "+" : ""}${ref.dayOffset} days) · ${numberText(ref.valueKg, uk)} kg.`;
  }
  return uk
    ? `Оцінка «на дату» ${ref.localDate} · ${numberText(ref.valueKg, uk)} кг.`
    : `As-of estimate for ${ref.localDate} · ${numberText(ref.valueKg, uk)} kg.`;
}

function categoryLabel(category: LoadAccountingBreakdownContributionV1["category"], uk: boolean): string {
  const labels: Record<LoadAccountingBreakdownContributionV1["category"], [string, string]> = {
    externalLoadVolume: ["Зовнішнє навантаження", "External load"],
    bandNominalPerLoggedSide: ["Резинка · записана сторона", "Band · logged side"],
    bandNominalLeftSide: ["Резинка · ліва сторона", "Band · left side"],
    bandNominalRightSide: ["Резинка · права сторона", "Band · right side"],
    bodyweightSets: ["Підходи з власною вагою", "Bodyweight sets"],
    bodyweightRepetitions: ["Повторення з власною вагою", "Bodyweight repetitions"],
    bodyweightReferenceVolume: ["Обсяг за референсом маси", "Bodyweight reference volume"],
    additionalLoad: ["Додаткова вага", "Added load"],
    assistanceLoad: ["Допоміжне навантаження", "Assistance load"],
  };
  return labels[category][uk ? 0 : 1];
}

function basisLabel(basis: LoadAccountingBreakdownContributionV1["basis"], uk: boolean): string {
  const labels: Record<LoadAccountingBreakdownContributionV1["basis"], [string, string]> = {
    "per-implement-kg": ["кг на снаряд", "kg per implement"],
    "complete-setup-kg": ["кг на всю систему", "kg for complete setup"],
    "nominal-kg-per-logged-side": ["номінальні кг на записану сторону", "nominal kg per logged side"],
    "bodyweight-reference": ["референс маси тіла", "bodyweight reference"],
    sets: ["підходи", "sets"],
    repetitions: ["повторення", "repetitions"],
    "additional-load-kg": ["додаткова вага, кг", "added load, kg"],
    "assistance-load-kg": ["допоміжна вага, кг", "assistance load, kg"],
  };
  return labels[basis][uk ? 0 : 1];
}

function provenanceLabel(row: LoadAccountingBreakdownRowV1, uk: boolean): string {
  const provenance = row.config.provenance ?? row.contributions.flatMap((entry) => entry.provenance)[0];
  if (!provenance) return uk ? "Походження конфігурації не вказане" : "Configuration provenance not reported";
  const kind = provenance.kind === "exercise-config" ? (uk ? "Налаштування вправи" : "Exercise settings")
    : provenance.kind === "program-snapshot" ? (uk ? "Знімок програми" : "Program snapshot")
      : provenance.kind === "session-snapshot" ? (uk ? "Знімок сесії" : "Session snapshot")
        : provenance.kind === "legacy-interpretation" ? (uk ? "Стандартне трактування вправи" : "Built-in exercise interpretation")
          : provenance.kind === "set-override" ? (uk ? "Налаштування підходу" : "Set-specific settings")
            : provenance.kind === "bodyweight-observation" ? (uk ? "Вимірювання маси" : "Bodyweight observation")
              : (uk ? "Оцінка на дату" : "As-of estimate");
  return provenance.localDate ? `${kind} · ${provenance.localDate}` : kind;
}

function unavailableReasonLabel(
  reason: LoadAccountingBreakdownContributionV1["unavailableReason"],
  uk: boolean,
): string | null {
  if (!reason) return null;
  const labels: Record<NonNullable<LoadAccountingBreakdownContributionV1["unavailableReason"]>, [string, string]> = {
    "unknown-identity": ["вправа не має підтвердженої відповідності", "exercise identity is not confirmed"],
    "ambiguous-identity": ["відповідність вправи неоднозначна", "exercise identity is ambiguous"],
    "unverified-identity": ["відповідність вправи не перевірена", "exercise identity is unverified"],
    "invalid-configuration": ["налаштування навантаження невалідне", "load settings are invalid"],
    "invalid-set-override": ["налаштування підходу невалідне", "set-specific settings are invalid"],
    "missing-load": ["вагу не записано", "load was not recorded"],
    "invalid-load": ["записана вага невалідна", "recorded load is invalid"],
    "missing-repetitions": ["повторення не записані", "repetitions were not recorded"],
    "missing-bodyweight-reference": ["референс маси недоступний", "bodyweight reference is unavailable"],
    "asymmetric-side-breakdown": ["для цього обліку потрібні повтори по сторонах", "side-specific reps are required for this calculation"],
  };
  return labels[reason][uk ? 0 : 1];
}

function contributionValue(contribution: LoadAccountingBreakdownContributionV1, uk: boolean): string {
  if (contribution.value === null) return uk ? "Недоступно" : "Unavailable";
  const unit = contribution.unit === "kg-repetitions" ? "kg × reps"
    : contribution.unit === "nominal-kg-repetitions-per-logged-side" ? (uk ? "ном. кг × повтори/сторона" : "nom. kg × reps/side")
      : contribution.unit === "nominal-kg-repetitions-per-side" ? (uk ? "ном. кг × повтори/сторона" : "nom. kg × reps/side")
        : contribution.unit === "bodyweight-reference-kg-repetitions" ? (uk ? "кг референсу × повтори" : "reference kg × reps")
          : contribution.unit;
  return `${numberText(contribution.value, uk)} ${unit}`;
}

function BreakdownRow({ row, uk }: { row: LoadAccountingBreakdownRowV1; uk: boolean }) {
  const loadParts = [
    row.enteredLoad.externalKg !== null ? `${numberText(row.enteredLoad.externalKg, uk)} ${uk ? "кг" : "kg"}` : null,
    row.enteredLoad.bandNominalKg !== null ? `${numberText(row.enteredLoad.bandNominalKg, uk)} ${uk ? "кг резинки" : "kg band"}` : null,
  ].filter(Boolean);
  const asymmetricText = row.asymmetricReps
    ? `${uk ? "ліворуч" : "left"} ${row.asymmetricReps.left} · ${uk ? "праворуч" : "right"} ${row.asymmetricReps.right}`
    : null;
  const mechanicsText = row.mechanics
    ? `${row.mechanics.loadedSides} ${uk ? "стор." : "sides"} · ×${numberText(row.mechanics.effectiveMultiplier, uk)}`
    : null;
  return (
    <article className={styles.accountingBreakdownRow}>
      <div className={styles.accountingBreakdownTitle}>
        <strong>{row.exerciseName}</strong>
        <span>{uk ? `Підхід ${row.setNumber}` : `Set ${row.setNumber}`}</span>
      </div>
      <dl className={styles.accountingBreakdownFacts}>
        <div><dt>{uk ? "Повтори" : "Reps"}</dt><dd>{row.scalarReps ?? (uk ? "н/д" : "n/a")}{asymmetricText ? ` · ${asymmetricText}` : ""}</dd></div>
        <div><dt>{uk ? "Введене навантаження" : "Entered load"}</dt><dd>{loadParts.length ? loadParts.join(" + ") : (uk ? "не вказане" : "not entered")}</dd></div>
        {mechanicsText && <div><dt>{uk ? "Сторони / множник" : "Sides / multiplier"}</dt><dd>{mechanicsText}</dd></div>}
        <div><dt>{uk ? "Походження" : "Provenance"}</dt><dd>{provenanceLabel(row, uk)}</dd></div>
      </dl>
      <ul className={styles.accountingContributionList}>
        {row.contributions.map((contribution, index) => (
          <li key={`${contribution.category}-${index}`}>
            <span><strong>{categoryLabel(contribution.category, uk)}</strong><small>{basisLabel(contribution.basis, uk)}</small></span>
            <span className={styles.accountingContributionValue}>
              {contributionValue(contribution, uk)}
              <small>{availabilityLabel(contribution.availability, uk)}
                {contribution.availability === "unavailable" && unavailableReasonLabel(contribution.unavailableReason, uk)
                  ? ` · ${unavailableReasonLabel(contribution.unavailableReason, uk)}`
                  : ""}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function SessionAccountingPanel({ session, uk, onMaterialize, onRefresh, refreshing = false, error = null }: Props) {
  const reportedState = session.materializationState ?? (session.loadAccountingV1 ? "current" : "missing");
  const state = reportedState === "current" && !session.loadAccountingV1 ? "error" : reportedState;
  const accounting = state === "current" ? session.loadAccountingV1 : undefined;
  const breakdown = state === "current" ? session.loadAccountingBreakdown : undefined;
  const stateText = state === "current" ? (uk ? "Актуальний збережений знімок" : "Current saved snapshot")
    : state === "missing" ? (uk ? "Знімок ще не створено" : "No saved snapshot yet")
        : state === "pending" ? (uk ? "Облік очікує завершення" : "Accounting is pending")
          : state === "stale" ? (uk ? "Знімок застарів після змін" : "Snapshot is stale after changes")
            : (uk ? "Не вдалося прочитати знімок обліку" : "Could not read the accounting snapshot");
  return (
    <section className={`${styles.panel} ${styles.accountingPanel}`} aria-labelledby="session-accounting-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="session-accounting-title">{uk ? "Облік навантаження" : "Training load accounting"}</h2>
          <p>{stateText}</p>
        </div>
        <span className={styles.accountingState} data-state={state}>{stateText}</span>
      </div>
      <div className={styles.panelBody}>
        {error && <p className={styles.accountingError} role="alert">{error}</p>}
        {(state === "missing" || state === "stale" || state === "error") && (
          <p className={styles.accountingStateHint}>
            {state === "missing"
              ? (uk ? "Збережені підсумки з’являться після створення snapshot обліку." : "Saved totals appear after an accounting snapshot is created.")
              : state === "stale"
                ? (uk ? "Поточні цифри приховано, доки знімок не буде оновлено." : "Saved figures are hidden until the snapshot is refreshed.")
                : (uk ? "Сервер позначив snapshot актуальним, але не надав його persisted метрик." : "The server marked the snapshot current but did not return persisted metrics.")}
          </p>
        )}
        {state === "pending" && <p className={styles.accountingStateHint}>{uk ? "Зачекайте на завершення обробки, потім оновіть дані сесії." : "Wait for processing to finish, then reload the session."}</p>}
        {accounting && (
          <>
            <div className={styles.accountingMetricGrid}>
              <MetricCard label={uk ? "Зовнішнє навантаження" : "External-load volume"} metric={accounting.externalLoadVolume} uk={uk} />
              <MetricCard label={uk ? "Резинка · записана сторона" : "Band nominal · logged side"} metric={accounting.bandNominalIndex.perLoggedSide} uk={uk} />
              <MetricCard label={uk ? "Резинка · ліва сторона" : "Band nominal · left side"} metric={accounting.bandNominalIndex.leftSide} uk={uk} />
              <MetricCard label={uk ? "Резинка · права сторона" : "Band nominal · right side"} metric={accounting.bandNominalIndex.rightSide} uk={uk} />
              <MetricCard label={uk ? "Підходи з власною вагою" : "Bodyweight sets"} metric={accounting.bodyweight.sets} uk={uk} />
              <MetricCard label={uk ? "Повторення з власною вагою" : "Bodyweight repetitions"} metric={accounting.bodyweight.repetitions} uk={uk} />
              <MetricCard label={uk ? "Обсяг за референсом маси" : "Bodyweight reference volume"} metric={accounting.bodyweight.referenceVolume} uk={uk} />
              <MetricCard label={uk ? "Додаткове навантаження" : "Added load"} metric={accounting.additionalLoad} uk={uk} />
              <MetricCard label={uk ? "Допоміжне навантаження" : "Assistance load"} metric={accounting.assistanceLoad} uk={uk} />
            </div>
            <p className={styles.accountingBodyweightNote}>{bodyweightDescription(accounting, uk)}</p>
            <div className={styles.accountingBreakdown}>
              {breakdown?.status === "available" ? (
                <details>
                  <summary>{uk ? `Деталі за вправами й підходами (${breakdown.value.rows.length})` : `Exercise and set details (${breakdown.value.rows.length})`}</summary>
                  <div className={styles.accountingBreakdownList}>
                    {breakdown.value.rows.length === 0
                      ? <p className={styles.accountingStateHint}>{uk ? "У знімку немає рядків." : "No rows in this snapshot."}</p>
                      : breakdown.value.rows.map((row) => <BreakdownRow key={row.strengthSetId} row={row} uk={uk} />)}
                  </div>
                </details>
              ) : breakdown?.status === "unavailable" ? (
                <p className={styles.accountingLegacyNote}>{uk ? "Підсумки цього старого знімка збережені, але деталі за підходами недоступні." : "This older snapshot keeps its totals, but set-level details are unavailable."}</p>
              ) : null}
            </div>
          </>
        )}
        {(state === "missing" ? onMaterialize : onRefresh) && state !== "pending" && (
          <div className={styles.accountingRefreshRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={state === "missing" ? onMaterialize : onRefresh}
              disabled={refreshing}
            >
              {refreshing
                ? (uk ? "Оновлення обліку…" : "Refreshing accounting…")
                : state === "missing"
                  ? (uk ? "Створити знімок обліку" : "Create accounting snapshot")
                  : (uk ? "Оновити облік" : "Refresh accounting")}
            </button>
            <span>{uk ? "Окрема дія; звичайне перезавантаження сторінки не змінює знімок." : "Separate action; reloading this page does not refresh the snapshot."}</span>
          </div>
        )}
      </div>
    </section>
  );
}
