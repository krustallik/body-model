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

type SummaryMetric = Pick<LoadMetricV1<string>, "value" | "availability" | "coverage">;
type DisplayContribution = Omit<LoadAccountingBreakdownContributionV1, "availability"> & {
  availability: "available" | "partial" | "unavailable";
};

function combinedBandMetric(accounting: LoadAccountingOutputV1): SummaryMetric {
  const logged = accounting.bandNominalIndex.perLoggedSide;
  const left = accounting.bandNominalIndex.leftSide;
  const right = accounting.bandNominalIndex.rightSide;
  const streams = [logged, left, right];
  const eligibleRows = Math.max(...streams.map((metric) => metric.coverage.eligibleRows));
  const accountedRows = Math.min(
    eligibleRows,
    logged.coverage.accountedRows + Math.max(left.coverage.accountedRows, right.coverage.accountedRows),
  );
  const values = streams.flatMap((metric) => metric.value === null ? [] : [metric.value]);
  const value = values.length ? values.reduce((total, part) => total + part, 0) : null;
  const omittedRows = Math.max(0, eligibleRows - accountedRows);
  return {
    value,
    availability: accountedRows === 0 ? "unavailable" : omittedRows > 0 ? "partial" : "available",
    coverage: { eligibleRows, accountedRows, omittedRows, omittedReasons: {} },
  };
}

function MetricCard({
  label,
  metric,
  unit,
  tone,
  uk,
}: {
  label: string;
  metric: SummaryMetric;
  unit: string;
  tone: "external" | "bands" | "bodyweight";
  uk: boolean;
}) {
  return (
    <article className={styles.accountingMetric} data-tone={tone}>
      <div className={styles.accountingMetricHead}>
        <span className={styles.accountingMetricMark} aria-hidden="true" />
        <h3>{label}</h3>
        <span className={styles.accountingAvailability} data-state={metric.availability}>
          {availabilityLabel(metric.availability, uk)}
        </span>
      </div>
      <div className={styles.accountingMetricValue}>
        <strong>{metric.value === null ? (uk ? "Немає значення" : "No value") : numberText(metric.value, uk)}</strong>
        <span>{unit}</span>
      </div>
      <p className={styles.accountingMetricCoverage}>
        {uk ? "Враховано підходів" : "Sets counted"}: {metric.coverage.accountedRows}/{metric.coverage.eligibleRows}
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

function basisLabel(basis: LoadAccountingBreakdownContributionV1["basis"], uk: boolean): string {
  const labels: Record<LoadAccountingBreakdownContributionV1["basis"], [string, string]> = {
    "per-implement-kg": ["кг на снаряд", "kg per implement"],
    "complete-setup-kg": ["кг на всю систему", "kg for complete setup"],
    "nominal-kg-per-logged-side": ["номінальний опір резинки", "nominal band resistance"],
    "bodyweight-reference": ["референс маси тіла", "bodyweight reference"],
    sets: ["підходи", "sets"],
    repetitions: ["повторення", "repetitions"],
    "additional-load-kg": ["додаткова вага, кг", "added load, kg"],
    "assistance-load-kg": ["допоміжна вага, кг", "assistance load, kg"],
  };
  return labels[basis][uk ? 0 : 1];
}

function provenanceKindLabel(
  provenance: LoadAccountingBreakdownContributionV1["provenance"][number],
  uk: boolean,
): string {
  if (provenance.kind === "bodyweight-observation") {
    const approximation = provenance.version.includes("nearest");
    const label = approximation
      ? (uk ? "Наближене вимірювання маси" : "Approximate bodyweight measurement")
      : (uk ? "Точне вимірювання маси" : "Exact bodyweight measurement");
    return provenance.localDate
      ? `${label} · ${uk ? "дата вимірювання" : "measured"} ${provenance.localDate}`
      : label;
  }
  if (provenance.kind === "bodycast-as-of-model") {
    const estimate = uk ? "Оцінка моделі на дату" : "Model estimate as of";
    const uncertainty = provenance.uncertaintyStatus === "reported"
      ? (uk ? " · невизначеність вказана" : " · uncertainty reported")
      : "";
    return `${estimate}${provenance.localDate ? ` ${provenance.localDate}` : ""}${uncertainty}`;
  }
  return provenance.kind === "exercise-config" ? (uk ? "Налаштування вправи" : "Exercise settings")
    : provenance.kind === "program-snapshot" ? (uk ? "Знімок програми" : "Program snapshot")
      : provenance.kind === "session-snapshot" ? (uk ? "Знімок сесії" : "Session snapshot")
        : provenance.kind === "legacy-interpretation" ? (uk ? "Стандартне трактування вправи" : "Built-in exercise interpretation")
        : (uk ? "Налаштування підходу" : "Set-specific settings");
}

function contributionProvenanceLabel(
  contribution: DisplayContribution,
  uk: boolean,
  row: LoadAccountingBreakdownRowV1,
): string {
  if (contribution.category === "bodyweightReferenceVolume"
      && contribution.availability === "unavailable"
      && contribution.unavailableReason === "missing-bodyweight-reference") {
    return uk
      ? "Немає доступного історичного вимірювання чи оцінки маси"
      : "No eligible historical measurement or estimate";
  }
  const labels = contribution.provenance.map((entry) => provenanceKindLabel(entry, uk));
  const config = row.config.effective;
  if (contribution.category === "bodyweightReferenceVolume"
      && config?.resistanceType === "bodyweight"
      && config.bodyweightFraction < 1) {
    labels.push(uk
      ? "приблизний коефіцієнт вправи ≈" + numberText(config.bodyweightFraction * 100, uk) + "%"
      : "approximate exercise share ≈" + numberText(config.bodyweightFraction * 100, uk) + "%");
  }
  return labels.length
    ? [...new Set(labels)].join(" · ")
    : (uk ? "Джерело внеску не вказане" : "Contribution source not reported");
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

function contributionValue(contribution: DisplayContribution, uk: boolean): string {
  if (contribution.value === null) return uk ? "Недоступно" : "Unavailable";
  const unit = contribution.unit === "kg-repetitions" ? "kg × reps"
    : contribution.unit === "nominal-kg-repetitions-per-logged-side" ? (uk ? "ном. кг × повтори" : "nominal kg × reps")
      : contribution.unit === "nominal-kg-repetitions-per-side" ? (uk ? "ном. кг × повтори" : "nominal kg × reps")
        : contribution.unit === "bodyweight-reference-kg-repetitions" ? (uk ? "кг × повтори" : "kg × reps")
          : contribution.unit;
  return `${numberText(contribution.value, uk)} ${unit}`;
}

function compactCategoryLabel(category: LoadAccountingBreakdownContributionV1["category"], uk: boolean): string {
  const labels: Record<LoadAccountingBreakdownContributionV1["category"], [string, string]> = {
    externalLoadVolume: ["Зовнішнє", "External"],
    bandNominalPerLoggedSide: ["Резинки", "Bands"],
    bandNominalLeftSide: ["Резинки", "Bands"],
    bandNominalRightSide: ["Резинки", "Bands"],
    bodyweightSets: ["Власна вага", "Bodyweight"],
    bodyweightRepetitions: ["Власна вага", "Bodyweight"],
    bodyweightReferenceVolume: ["Власна вага", "Bodyweight"],
    additionalLoad: ["Додаткове", "Added"],
    assistanceLoad: ["Допоміжне", "Assistance"],
  };
  return labels[category][uk ? 0 : 1];
}

function mechanicsLabel(row: LoadAccountingBreakdownRowV1, uk: boolean): string | null {
  const config = row.config.effective;
  if (config?.resistanceType === "bodyweight" && config.bodyweightFraction < 1) {
    return uk
      ? "Приблизна частка маси · " + numberText(config.bodyweightFraction * 100, uk) + "%"
      : "Approximate bodyweight share · " + numberText(config.bodyweightFraction * 100, uk) + "%";
  }
  if (config?.resistanceType === "external"
      && config.accountingKind === "external-per-implement-per-movement"
      && config.implementsPerMovement > 1) {
    return uk ? "Снарядів на рух · " + config.implementsPerMovement : "Implements per movement · " + config.implementsPerMovement;
  }
  if (row.mechanics && row.mechanics.effectiveMultiplier !== 1) {
    return uk
      ? "Множник ×" + numberText(row.mechanics.effectiveMultiplier, uk)
      : "Multiplier ×" + numberText(row.mechanics.effectiveMultiplier, uk);
  }
  return null;
}

function BreakdownRow({
  row,
  reference,
  uk,
}: {
  row: LoadAccountingBreakdownRowV1;
  reference: LoadAccountingOutputV1["bodyweight"]["reference"];
  uk: boolean;
}) {
  const bodyweightConfig = row.config.effective?.resistanceType === "bodyweight"
    ? row.config.effective
    : null;
  const loadParts = [
    row.enteredLoad.externalKg !== null ? numberText(row.enteredLoad.externalKg, uk) + (uk ? " кг" : " kg") : null,
    row.enteredLoad.bandNominalKg !== null ? numberText(row.enteredLoad.bandNominalKg, uk) + (uk ? " кг резинки" : " kg band") : null,
    bodyweightConfig
      ? reference.status === "unavailable"
        ? (uk ? "референс маси недоступний" : "bodyweight reference unavailable")
        : (uk ? "історичний референс " : "historical reference ") + numberText(reference.valueKg, uk) + (uk ? " кг" : " kg")
      : null,
  ].filter(Boolean);

  const band = row.contributions.filter((item) =>
    item.category === "bandNominalPerLoggedSide"
    || item.category === "bandNominalLeftSide"
    || item.category === "bandNominalRightSide");
  const other = row.contributions.filter((item) =>
    item.category !== "bandNominalPerLoggedSide"
    && item.category !== "bandNominalLeftSide"
    && item.category !== "bandNominalRightSide"
    && item.category !== "bodyweightSets"
    && item.category !== "bodyweightRepetitions"
    && !((item.category === "additionalLoad" || item.category === "assistanceLoad") && item.value === 0));
  const applicableBand = band.filter((item) => item.unavailableReason !== "asymmetric-side-breakdown");
  const availableBand = applicableBand.filter((item) => item.availability === "available" && item.value !== null);
  const unavailableBand = applicableBand.filter((item) => item.availability === "unavailable");
  const provenanceByKey = new Map<string, LoadAccountingBreakdownContributionV1["provenance"][number]>();
  for (const item of band) for (const provenance of item.provenance) {
    provenanceByKey.set(JSON.stringify(provenance), provenance);
  }
  const bandContribution = band.length > 0 ? {
    ...band[0]!,
    category: "bandNominalPerLoggedSide" as const,
    basis: "nominal-kg-per-logged-side" as const,
    unit: "nominal-kg-repetitions-per-logged-side" as const,
    value: availableBand.length ? availableBand.reduce((total, item) => total + (item.value ?? 0), 0) : null,
    availability: availableBand.length === 0 ? "unavailable" as const
      : unavailableBand.length > 0 ? "partial" as const : "available" as const,
    unavailableReason: unavailableBand[0]?.unavailableReason ?? null,
    provenance: [...provenanceByKey.values()],
  } : null;
  const contributions: DisplayContribution[] = bandContribution ? [...other, bandContribution] : other;
  const mechanicsText = mechanicsLabel(row, uk);
  const setLoad = loadParts.length ? loadParts.join(" + ") : (uk ? "вага не вказана" : "load not entered");

  return (
    <article className={styles.accountingBreakdownRow}>
      <p className={styles.accountingBreakdownSetLine}>
        <span>{uk ? "Підхід " + row.setNumber : "Set " + row.setNumber}</span>
        <strong>{row.scalarReps ?? (uk ? "н/д" : "n/a")} × {setLoad}</strong>
      </p>
      <ul className={styles.accountingContributionList}>
        {contributions.map((contribution, index) => (
          <li className={styles.accountingBreakdownContribution} key={contribution.category + "-" + index}>
            <div className={styles.accountingBreakdownContributionLine}>
              <strong>{compactCategoryLabel(contribution.category, uk)}</strong>
              <span className={styles.accountingContributionValue}>
                {contribution.value === null ? "—" : contributionValue(contribution, uk)}
              </span>
              <span className={styles.accountingAvailability} data-state={contribution.availability}>
                {availabilityLabel(contribution.availability, uk)}
              </span>
            </div>
            {contribution.availability !== "available" && unavailableReasonLabel(contribution.unavailableReason, uk) && (
              <small className={styles.accountingBreakdownUnavailableReason}>
                {unavailableReasonLabel(contribution.unavailableReason, uk)}
              </small>
            )}
            <details className={styles.accountingBreakdownMeta}>
              <summary>{uk ? "База й походження" : "Basis and source"}</summary>
              <div>
                <span>{basisLabel(contribution.basis, uk)}</span>
                {mechanicsText && <span>{mechanicsText}</span>}
                <span>{(uk ? "Джерело внеску: " : "Contribution source: ") + contributionProvenanceLabel(contribution, uk, row)}</span>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </article>
  );
}

function groupBreakdownRows(rows: LoadAccountingBreakdownRowV1[]) {
  const groups = new Map<number, { exerciseOrder: number; exerciseName: string; rows: LoadAccountingBreakdownRowV1[] }>();
  for (const row of rows) {
    const group = groups.get(row.sessionExerciseId) ?? {
      exerciseOrder: row.exerciseOrder,
      exerciseName: row.exerciseName,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.sessionExerciseId, group);
  }
  return [...groups.entries()]
    .sort(([, left], [, right]) => left.exerciseOrder - right.exerciseOrder)
    .map(([sessionExerciseId, group]) => ({
      sessionExerciseId,
      ...group,
      rows: group.rows.slice().sort((left, right) => left.setNumber - right.setNumber),
    }));
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
            <div className={styles.accountingMetricGrid} aria-label={uk ? "Підсумки навантаження" : "Load summary"}>
              <MetricCard
                label={uk ? "Зовнішнє навантаження" : "External load"}
                metric={accounting.externalLoadVolume}
                unit={uk ? "кг × повтори" : "kg × reps"}
                tone="external"
                uk={uk}
              />
              <MetricCard
                label={uk ? "Резинки" : "Bands"}
                metric={combinedBandMetric(accounting)}
                unit={uk ? "ном. кг × повтори" : "nominal kg × reps"}
                tone="bands"
                uk={uk}
              />
              <MetricCard
                label={uk ? "Власна вага" : "Bodyweight"}
                metric={accounting.bodyweight.referenceVolume}
                unit={uk ? "кг × повтори" : "kg × reps"}
                tone="bodyweight"
                uk={uk}
              />
            </div>
            <p className={styles.accountingBodyweightNote}>{bodyweightDescription(accounting, uk)}</p>
            <div className={styles.accountingBreakdown}>
              {breakdown?.status === "available" ? (
                <details>
                  <summary>{uk ? `Деталі за вправами й підходами (${breakdown.value.rows.length})` : `Exercise and set details (${breakdown.value.rows.length})`}</summary>
                  {breakdown.value.rows.length === 0
                    ? <p className={styles.accountingStateHint}>{uk ? "У знімку немає рядків." : "No rows in this snapshot."}</p>
                    : <div className={styles.accountingBreakdownList}>
                      {groupBreakdownRows(breakdown.value.rows).map((group) => (
                        <section className={styles.accountingBreakdownExercise} key={group.sessionExerciseId}>
                          <h3>{group.exerciseName}</h3>
                          <div className={styles.accountingBreakdownSetGrid}>
                            {group.rows.map((row) => (
                              <BreakdownRow key={row.strengthSetId} row={row} reference={accounting.bodyweight.reference} uk={uk} />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>}
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
