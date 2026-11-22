"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import type { AnatomyIdV2 } from "@/modules/training/body-map-catalog-v2";
import type {
  BodyMapAnalyticsWeeksV1,
  BodyMapAnalyticsCoverageSourceV1,
  BodyMapTrainingAnalyticsResponseV1,
} from "@/modules/training/body-map-training-analytics-v1";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import { resistanceEquipmentLabel } from "@/app/training/training-labels";
import { bodyMapAnatomyLabel } from "./body-map-localization";
import styles from "./body-map-training-analytics-panel.module.css";

type GroupReport = BodyMapTrainingAnalyticsResponseV1["groups"][number];
type ExerciseSet = GroupReport["exercises"][number]["sets"][number];
type ViewLevel = "OVERVIEW" | "GROUP_DETAIL" | "SUBREGION_DETAIL";
type CoverageFilter = "coverage:sessions" | "coverage:recorded" | "coverage:mapped" | "coverage:partial" | "coverage:unmapped";
type SourceFilter = "direct" | "indirect" | "mapped" | "days" | CoverageFilter | `rir:${number}` | `week:${string}` | `week-direct:${string}` | `week-indirect:${string}`;

function count(value: number | null, uk: boolean): string {
  return value === null ? (uk ? "Недоступно" : "Unavailable") : new Intl.NumberFormat(uk ? "uk-UA" : "en-US").format(value);
}

function time(value: number | null, uk: boolean): string {
  if (value === null) return uk ? "Не вказано" : "Not reported";
  return `${new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 1 }).format(value)} ${uk ? "кг" : "kg"}`;
}

type GroupProgressStatus = "improving" | "declining" | "steady" | "mixed" | "insufficient-data";
type GroupProgressEvidence = GroupReport["exercises"][number]["performanceTrend"]["evidence"][number] & {
  stableKey: string | null;
  exerciseName: string;
};

function summarizeGroupProgress(group: GroupReport, latestPhaseNumber: number | null): {
  status: GroupProgressStatus;
  comparableExerciseCount: number;
  comparableSessionCount: number;
  comparedSetPairs: number;
  evidence: GroupProgressEvidence[];
  latestSharedPhase: number | null;
  hasEarlierPhases: boolean;
  latestPhaseHasData: boolean;
} {
  const latestSharedPhase = latestPhaseNumber;
  const phaseExercises = latestSharedPhase === null ? [] : group.exercises.flatMap((exercise) => {
    const phase = exercise.performanceTrend.segments.find((segment) => segment.phaseNumber === latestSharedPhase);
    return phase ? [{
      exercise,
      phase,
      directInPhase: exercise.sets.some((set) => set.sessionPhaseNumber === latestSharedPhase && set.directAnatomyIds.length > 0),
    }] : [];
  });
  const directPhaseExercises = phaseExercises.filter(({ directInPhase }) => directInPhase);
  const trendExercises = (directPhaseExercises.length > 0 ? directPhaseExercises : phaseExercises)
    .filter(({ phase }) => phase.status !== "insufficient-data");
  const statuses = new Set(trendExercises.map(({ phase }) => phase.status));
  const status: GroupProgressStatus = trendExercises.length === 0 ? "insufficient-data"
    : statuses.size === 1 ? trendExercises[0]!.phase.status
      : "mixed";
  const evidenceCandidates = trendExercises.flatMap(({ exercise, phase }) => phase.evidence.map((row) => ({
    ...row,
    stableKey: exercise.stableKey,
    exerciseName: exercise.exerciseName,
  }))).sort((left, right) => left.currentDate.localeCompare(right.currentDate)
    || left.previousDate.localeCompare(right.previousDate)
    || (left.stableKey ?? left.exerciseName).localeCompare(right.stableKey ?? right.exerciseName)
    || left.setNumber - right.setNumber);
  const seenTransitions = new Set<string>();
  const evidence = evidenceCandidates.filter((row) => {
    const key = `${row.stableKey ?? row.exerciseName}:${row.previousSessionId}:${row.currentSessionId}`;
    if (seenTransitions.has(key)) return false;
    seenTransitions.add(key);
    return true;
  }).slice(-3);
  return {
    status,
    comparableExerciseCount: trendExercises.length,
    comparableSessionCount: Math.max(0, ...trendExercises.map(({ phase }) => phase.comparableSessionCount)),
    comparedSetPairs: trendExercises.reduce((total, { phase }) => total + phase.comparedSetPairs, 0),
    evidence,
    latestSharedPhase,
    hasEarlierPhases: latestSharedPhase !== null && latestSharedPhase > 1,
    latestPhaseHasData: phaseExercises.length > 0,
  };
}

export function BodyMapTrainingAnalyticsPanel({
  level,
  weeks,
  onWeeksChange,
  analytics,
  requestState,
  groupLabel,
  anatomyId,
  anatomyLabel,
  groupReport,
  onRefresh,
}: {
  level: ViewLevel;
  weeks: BodyMapAnalyticsWeeksV1;
  onWeeksChange: (weeks: BodyMapAnalyticsWeeksV1) => void;
  analytics: BodyMapTrainingAnalyticsResponseV1 | null;
  requestState: "loading" | "ready" | "unauthorized" | "error";
  groupLabel: string | null;
  anatomyId: AnatomyIdV2 | null;
  anatomyLabel: string | null;
  groupReport: GroupReport | null;
  onRefresh: () => void;
}) {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const [sourceFilter, setSourceFilter] = useState<SourceFilter | null>(null);
  const [assessmentBusy, setAssessmentBusy] = useState(false);
  const [assessmentSkippedFor, setAssessmentSkippedFor] = useState<number | null>(null);
  const [assessmentNotice, setAssessmentNotice] = useState<string | null>(null);
  const sourceRecordsRef = useRef<HTMLElement | null>(null);
  const contexts = useMemo(() => new Map((analytics?.sessionContexts ?? []).map((context) => [context.sessionId, context])), [analytics]);
  const maxWeeklySets = Math.max(1, ...(groupReport?.weekly ?? []).map(({ totalUniqueSetCount }) => totalUniqueSetCount));
  const latestPhaseNumber = analytics?.sessions.at(-1)?.phaseNumber ?? null;
  const groupProgress = groupReport ? summarizeGroupProgress(groupReport, latestPhaseNumber) : null;
  const groupSessionIds = new Set(groupReport?.exercises.flatMap((exercise) => exercise.sets.map((set) => set.sessionId)) ?? []);
  const latestGroupSession = analytics?.sessions.filter((session) => groupSessionIds.has(session.id)).at(-1) ?? null;
  const sourceSets = useMemo(() => {
    if (!groupReport || !sourceFilter) return [];
    return groupReport.exercises.flatMap((exercise) => exercise.sets.map((set) => ({ exercise, set })))
      .filter(({ set }) => !anatomyId || set.anatomyIds.includes(anatomyId))
      .filter(({ set }) => {
        if (sourceFilter === "direct") return anatomyId
          ? set.directAnatomyIds.includes(anatomyId)
          : set.directAnatomyIds.length > 0;
        if (sourceFilter === "indirect") return anatomyId
          ? set.indirectAnatomyIds.includes(anatomyId)
          : set.indirectAnatomyIds.length > 0;
        if (sourceFilter === "days" || sourceFilter === "mapped") return true;
        if (sourceFilter.startsWith("week-direct:")) return weekStartForDate(set.sessionDate) === sourceFilter.slice(12)
          && (anatomyId ? set.directAnatomyIds.includes(anatomyId) : set.directAnatomyIds.length > 0);
        if (sourceFilter.startsWith("week-indirect:")) return weekStartForDate(set.sessionDate) === sourceFilter.slice(14)
          && (anatomyId ? set.indirectAnatomyIds.includes(anatomyId) : set.indirectAnatomyIds.length > 0);
        if (sourceFilter.startsWith("week:")) return weekStartForDate(set.sessionDate) === sourceFilter.slice(5);
        if (sourceFilter.startsWith("coverage:")) return false;
        return set.rir === Number(sourceFilter.slice(4));
      })
      .sort((left, right) => left.set.sessionDate.localeCompare(right.set.sessionDate)
        || left.set.exerciseIndex - right.set.exerciseIndex || left.set.setNumber - right.set.setNumber);
  }, [anatomyId, groupReport, sourceFilter]);
  const coverageSources = useMemo(() => {
    if (!analytics || !sourceFilter?.startsWith("coverage:")) return [];
    if (sourceFilter === "coverage:recorded") return analytics.coverage.sources;
    if (sourceFilter === "coverage:mapped") return analytics.coverage.sources.filter((source) => source.projectedToBodyMap);
    if (sourceFilter === "coverage:partial") return analytics.coverage.sources.filter((source) => source.mappingCoverage === "partial");
    if (sourceFilter === "coverage:unmapped") return analytics.coverage.sources.filter((source) => !source.projectedToBodyMap);
    return [];
  }, [analytics, sourceFilter]);

  useEffect(() => {
    if (!sourceFilter || !sourceRecordsRef.current) return;
    const section = sourceRecordsRef.current;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }, [sourceFilter]);

  function showSources(filter: SourceFilter) {
    setSourceFilter(filter);
  }

  function sourceFilterLabel(filter: SourceFilter): string {
    if (filter === "direct") return uk ? "прямих підходів" : "direct sets";
    if (filter === "indirect") return uk ? "допоміжних підходів" : "indirect sets";
    if (filter === "days") return uk ? "записаних тренувальних днів" : "logged training days";
    if (filter === "mapped") return uk ? "зіставлених підходів" : "mapped sets";
    if (filter === "coverage:sessions") return uk ? "завершених сесій" : "completed sessions";
    if (filter === "coverage:recorded") return uk ? "записаних підходів" : "recorded sets";
    if (filter === "coverage:mapped") return uk ? "зіставлених підходів" : "mapped sets";
    if (filter === "coverage:partial") return uk ? "підходів із частковим мапінгом" : "partially mapped sets";
    if (filter === "coverage:unmapped") return uk ? "підходів без мапінгу" : "unmapped sets";
    if (filter.startsWith("week-direct:")) return `${uk ? "прямих підходів за тиждень від" : "direct sets for week of"} ${dateLabel(filter.slice(12))}`;
    if (filter.startsWith("week-indirect:")) return `${uk ? "допоміжних підходів за тиждень від" : "indirect sets for week of"} ${dateLabel(filter.slice(14))}`;
    if (filter.startsWith("week:")) return `${uk ? "тижня від" : "week of"} ${dateLabel(filter.slice(5))}`;
    return `RIR ${filter.slice(4)}`;
  }

  const trendLabel = (status: NonNullable<GroupReport>["exercises"][number]["performanceTrend"]["status"]) => {
    if (uk) {
      return status === "improving" ? "Записані показники зростають"
        : status === "declining" ? "Записані показники знизились"
          : status === "steady" ? "Без зміни у зіставлених підходах"
            : status === "mixed" ? "Змішані зміни"
              : "Замало зіставних записів";
    }
    return status === "improving" ? "Recorded performance is trending up"
      : status === "declining" ? "Recorded performance is trending down"
        : status === "steady" ? "No change in compared sets"
          : status === "mixed" ? "Mixed changes"
            : "Not enough comparable logs";
  };

  const exerciseLabel = (stableKey: string | null, fallback: string) => uk && stableKey
    ? CANONICAL_EXERCISE_IDENTITIES.find((exercise) => exercise.stableKey === stableKey)?.displayName ?? fallback
    : fallback;

  const coverageNote = () => {
    if (!analytics) return "";
    if (analytics.sessions.length === 0) return uk
      ? "У цьому періоді немає завершених сесій у щоденнику. Відсутність запису не доводить, що тренування не було."
      : "No completed diary sessions were logged in this window. Missing records do not prove that no workout occurred.";
    return analytics.coverage.mapping === "partial"
      ? uk
        ? "Підрахунок охоплює зіставлені підходи зі завершених сесій; частина записів має частковий або відсутній мапінг."
        : "Counts include mapped sets from completed sessions; some records have partial or missing mappings."
      : uk
        ? "Підрахунок охоплює лише зіставлені підходи із завершених сесій, а не активацію м’язів чи доказ бездіяльності."
        : "Counts describe mapped sets in completed sessions, not muscle activation or proof of inactivity.";
  };

  function dateLabel(date: string): string {
    return new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  }

  function dateTimeLabel(value: string): string {
    return new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  }

  function periodControl() {
    return <div className={styles.periodRow}>
      <label className={styles.periodField}>
        <span>{uk ? "Період журналу" : "Diary window"}</span>
        <select value={weeks} onChange={(event) => onWeeksChange(Number(event.currentTarget.value) as BodyMapAnalyticsWeeksV1)}>
          <option value={4}>{uk ? "4 тижні" : "4 weeks"}</option>
          <option value={8}>{uk ? "8 тижнів" : "8 weeks"}</option>
          <option value={12}>{uk ? "12 тижнів" : "12 weeks"}</option>
        </select>
      </label>
      {analytics && <small>{dateLabel(analytics.period.from.slice(0, 10))} – {dateLabel(analytics.period.to.slice(0, 10))}</small>}
    </div>;
  }

  async function saveLoadAssessment(sessionId: number, status: "lighter" | "not-lighter") {
    setAssessmentBusy(true);
    setAssessmentNotice(null);
    try {
      const response = await fetch("/api/v1/training/sessions/" + sessionId + "/load-assessment", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("assessment_save_failed");
      const result = await response.json() as { saved: boolean };
      setAssessmentSkippedFor(sessionId);
      setAssessmentNotice(result.saved
        ? (uk ? "Відповідь збережено в контексті цієї завершеної сесії." : "Your answer was saved for this completed session.")
        : (uk ? "Контекст уже оновлено в іншій вкладці; завантажую актуальні дані." : "This session was updated in another tab; refreshing its data."));
      onRefresh();
    } catch {
      setAssessmentNotice(uk ? "Не вдалося зберегти відповідь. Спробуй ще раз." : "Could not save your answer. Try again.");
    } finally {
      setAssessmentBusy(false);
    }
  }

  function loadAssessmentLabel(assessment: NonNullable<typeof latestGroupSession>["loadAssessment"]): string {
    if (assessment.source === "manual") return uk ? "За твоєю відповіддю" : "Based on your answer";
    if (assessment.status === "lighter") return uk ? "Полегшене тренування за журналом" : "Lighter session pattern in diary";
    if (assessment.status === "not-lighter") return uk ? "Ознак полегшення не виявлено" : "No lighter pattern found";
    return uk ? "Не вдалося визначити" : "Could not determine";
  }

  function loadAssessmentReason(assessment: NonNullable<typeof latestGroupSession>["loadAssessment"]): string {
    const typicalSets = assessment.typicalSetCount === null ? null
      : new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(assessment.typicalSetCount);
    const currentRir = assessment.medianRir === null ? null
      : new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(assessment.medianRir);
    const usualRir = assessment.typicalMedianRir === null ? null
      : new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(assessment.typicalMedianRir);
    if (assessment.source === "manual") return uk ? "Це ручне уточнення для випадку, коли записів було недостатньо." : "You clarified this because the diary alone did not provide enough evidence.";
    if (assessment.reason === "reduced-volume") return typicalSets
      ? (uk ? "У зіставних вправах записано " + count(assessment.comparableActualSetCount ?? assessment.actualSetCount, uk) + " підх. проти звичних приблизно " + typicalSets + "." : count(assessment.comparableActualSetCount ?? assessment.actualSetCount, uk) + " sets were logged across comparable exercises, versus about " + typicalSets + " typically.")
      : (uk ? "Записаний обсяг підходів помітно нижчий за особисту базу." : "Logged set volume is clearly below your recent baseline.");
    if (assessment.reason === "higher-reported-rir") return currentRir !== null && usualRir !== null
      ? (uk ? "Медіанний RIR " + currentRir + " проти звичних " + usualRir + ": у журналі залишалося більше повторень у запасі." : "Median reported RIR was " + currentRir + ", versus your usual " + usualRir + ": more reps were left in reserve.")
      : (uk ? "Медіанний записаний RIR — " + (currentRir ?? "—") + "; це самооцінка запасу повторень." : "Median reported RIR was " + (currentRir ?? "—") + "; this is your estimate of reps in reserve.");
    if (assessment.reason === "usual-pattern") return currentRir !== null && Number(currentRir.replace(",", ".")) <= 2
      ? (uk ? "Медіанний RIR " + currentRir + " вказує на підходи близько до відмови." : "Median reported RIR " + currentRir + " indicates sets near failure.")
      : (uk ? "За зіставним обсягом і записаним RIR ознак полегшеного тренування немає." : "Comparable set volume and reported RIR do not indicate a lighter session.");
    if (assessment.reason === "mixed-signals") return uk
      ? "Обсяг підходів і RIR дають суперечливі сигнали; автоматичний висновок не робиться."
      : "Set volume and reported RIR point in different directions, so no automatic conclusion is made.";
    return uk
      ? "Для надійного висновку бракує повторюваних записів вправ або RIR."
      : "There are not enough repeated exercise or RIR records for a reliable assessment.";
  }

  function progressHeadline(status: GroupProgressStatus): string {
    if (uk) return status === "improving" ? "Записані показники зростають"
      : status === "declining" ? "Записані показники знижуються"
        : status === "steady" ? "Без виразних змін"
          : status === "mixed" ? "Змішані результати"
            : "Недостатньо даних";
    return status === "improving" ? "Recorded performance is trending up"
      : status === "declining" ? "Recorded performance is trending down"
        : status === "steady" ? "No clear change"
          : status === "mixed" ? "Mixed results"
            : "Not enough data";
  }

  function progressExplanation(summary: NonNullable<typeof groupProgress>): string {
    const phaseNote = summary.hasEarlierPhases
      ? (uk ? " Підсумок враховує лише останню фазу; попередні фази не змішуються." : " The summary uses only the latest phase; earlier phases are kept separate.")
      : "";
    if (summary.status === "insufficient-data" && !summary.latestPhaseHasData && summary.hasEarlierPhases) return uk
      ? "У найновішій фазі немає записів для цієї групи; попередні фази не подаються як поточний тренд."
      : "There are no records for this muscle group in the latest phase; earlier phases are not shown as the current trend.";
    if (summary.status === "insufficient-data") return (uk
      ? "Щоб оцінити напрямок, потрібні щонайменше три зіставні тренування протягом чотирьох тижнів."
      : "At least three comparable sessions across four weeks are needed to assess a direction.") + phaseNote;
    if (summary.status === "mixed") return (uk
      ? "Зіставні вправи змінилися в різних напрямах, тому спільний висновок для групи буде передчасним."
      : "Comparable exercises changed in different directions, so a single group-level conclusion would be premature.") + phaseNote;
    const exerciseCount = new Intl.NumberFormat(intlLocale).format(summary.comparableExerciseCount);
    const sessionCount = new Intl.NumberFormat(intlLocale).format(summary.comparableSessionCount);
    const pairCount = new Intl.NumberFormat(intlLocale).format(summary.comparedSetPairs);
    if (summary.status === "improving") return uk
      ? "Висновок спирається на " + exerciseCount + " зіставні вправи, " + sessionCount + " сесії та " + pairCount + " пар підходів з однаковим RIR, порядком і відпочинком." + phaseNote
      : "Based on " + exerciseCount + " comparable exercises, " + sessionCount + " sessions, and " + pairCount + " set pairs with matching RIR, order, and rest." + phaseNote;
    if (summary.status === "declining") return uk
      ? "У " + exerciseCount + " зіставних вправах записані вага або повторення знизилися за порівнюваних RIR, порядку й відпочинку." + phaseNote
      : "Logged load or reps decreased in " + exerciseCount + " comparable exercises with matching RIR, order, and rest." + phaseNote;
    return uk
      ? "У зіставних підходах вага й повторення не змінилися; порівняння охоплює " + sessionCount + " сесії." + phaseNote
      : "Load and reps were unchanged in comparable sets across " + sessionCount + " sessions." + phaseNote;
  }

  function evidenceLoad(row: GroupProgressEvidence, previous: boolean): string {
    const kg = row.resistanceType === "RESISTANCE_BAND"
      ? (previous ? row.previousBandNominalResistanceKg : row.currentBandNominalResistanceKg)
      : (previous ? row.previousWeightKg : row.currentWeightKg);
    return row.resistanceType === "RESISTANCE_BAND"
      ? resistanceEquipmentLabel(uk, row.stableKey, row.exerciseName) + " " + time(kg, uk)
      : time(kg, uk);
  }

  function requestNotice() {
    if (requestState === "loading") return <p className={styles.notice} role="status">{uk ? "Завантажую записи тренувань…" : "Loading training records…"}</p>;
    if (requestState === "unauthorized") return <p className={styles.notice} role="status">{uk ? "Увійдіть, щоб переглянути власний журнал. Публічні демодані не підміняють ваші записи." : "Sign in to view your diary. Public demo data is never shown as your records."}</p>;
    if (requestState === "error") return <p className={styles.notice} role="alert">{uk ? "Аналітика тимчасово недоступна. Записи тренувань не змінено." : "Analytics is temporarily unavailable. Your training records were not changed."}</p>;
    return null;
  }

  return <section className={styles.panel} data-testid="body-map-training-analytics">
    {periodControl()}
    {requestNotice()}
    {requestState === "ready" && analytics && <>
      {level === "OVERVIEW" && <>
        <div className={styles.summaryHeader}>
          <div>
            <p className={styles.kicker}>{uk ? "ЖУРНАЛ ТРЕНУВАНЬ" : "TRAINING DIARY"}</p>
            <h2>{uk ? "Записана робота за період" : "Logged work in this window"}</h2>
          </div>
          <span className={styles.coverageTag} data-coverage={analytics.coverage.mapping}>{analytics.coverage.mapping === "complete-for-input" ? (uk ? "Повна карта записів" : "Mapping complete for these entries") : analytics.coverage.mapping === "partial" ? (uk ? "Часткова карта" : "Partial mapping") : (uk ? "Даних немає" : "No diary data")}</span>
        </div>
        <p className={styles.provenance}>{coverageNote()}</p>
        <div className={styles.summaryMetrics}>
          <Metric label={uk ? "Завершені сесії" : "Completed sessions"} value={count(analytics.coverage.completedSessionCount, uk)} sourceFilter="coverage:sessions" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
          <Metric label={uk ? "Записані підходи" : "Recorded sets"} value={count(analytics.coverage.recordedSetCount, uk)} sourceFilter="coverage:recorded" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
          <Metric label={uk ? "Зіставлені підходи" : "Mapped sets"} value={count(analytics.coverage.mappedSetCount, uk)} sourceFilter="coverage:mapped" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
          <Metric label={uk ? "Частковий мапінг" : "Partial mappings"} value={count(analytics.coverage.partiallyMappedSetCount, uk)} sourceFilter="coverage:partial" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
          <Metric label={uk ? "Підходи без мапінгу" : "Sets without mapping"} value={count(analytics.coverage.unmappedSetCount, uk)} sourceFilter="coverage:unmapped" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
        </div>
        {sourceFilter === "coverage:sessions" && <CoverageSourceRecords
          sectionRef={sourceRecordsRef}
          heading={uk ? "Джерельні сесії" : "Source sessions"}
          note={uk ? "Завершені сесії, включені до періоду; відкрийте сесію, щоб переглянути вправи й збережені підходи." : "Completed sessions included in this window; open a session to review its exercises and saved sets."}
          sessions={analytics.sessions}
          sources={[]}
          filter="coverage:sessions"
          uk={uk}
          dateLabel={dateLabel}
          exerciseLabel={exerciseLabel}
          locale={locale}
          onClose={() => setSourceFilter(null)}
        />}
        {sourceFilter && sourceFilter !== "coverage:sessions" && sourceFilter.startsWith("coverage:") && <CoverageSourceRecords
          sectionRef={sourceRecordsRef}
          heading={uk ? "Джерельні підходи" : "Source sets"}
          note={uk ? `Сирі записи, що формують показник: ${sourceFilterLabel(sourceFilter)}. Частковий мапінг може одночасно входити до кількості зіставлених підходів.` : `Raw set records contributing to ${sourceFilterLabel(sourceFilter)}. A partial mapping can also be included in the mapped-set count.`}
          sessions={[]}
          sources={coverageSources}
          filter={sourceFilter as Exclude<CoverageFilter, "coverage:sessions">}
          uk={uk}
          dateLabel={dateLabel}
          exerciseLabel={exerciseLabel}
          locale={locale}
          onClose={() => setSourceFilter(null)}
        />}
        {analytics.sessions.length === 0 && <p className={styles.emptyState}>{uk ? "За цей період немає завершених сесій у щоденнику. Це не доводить, що тренувань не було." : "No completed diary sessions are recorded for this period. This does not prove that no workouts occurred."}</p>}
      </>}

      {level === "GROUP_DETAIL" && groupReport && <>
        <div className={styles.summaryHeader}>
          <div>
            <p className={styles.kicker}>{uk ? "ЕКСПОЗИЦІЯ ЗА ЖУРНАЛОМ" : "DIARY EXPOSURE"}</p>
            <h2>{groupLabel}</h2>
          </div>
          <span className={styles.coverageTag} data-coverage={groupReport.mappingCoverage}>{groupReport.mappingCoverage === "complete-for-input" ? (uk ? "Повний мапінг записів" : "Mapped logged entries") : groupReport.mappingCoverage === "partial" ? (uk ? "Частковий мапінг" : "Partial mapping") : (uk ? "Недоступно" : "Unavailable")}</span>
        </div>
        {groupProgress && <section className={styles.progressCard} data-progress={groupProgress.status} aria-label={uk ? "Підсумок прогресу за журналом" : "Diary progress summary"}>
          <div className={styles.progressCardHeading}>
            <div>
              <p className={styles.kicker}>{uk ? "ПОРІВНЯННЯ ЗАПИСІВ" : "DIARY COMPARISON"}</p>
              <strong>{progressHeadline(groupProgress.status)}</strong>
            </div>
            <span className={styles.progressMark} aria-hidden="true" />
          </div>
          <p>{progressExplanation(groupProgress)}</p>
          {groupProgress.evidence.length > 0 && <ul className={styles.progressEvidence}>
            {groupProgress.evidence.map((row, index) => <li key={row.previousSessionId + ":" + row.currentSessionId + ":" + row.setNumber + ":" + index}>
              <span>{exerciseLabel(row.stableKey, row.exerciseName)} · {uk ? "підхід" : "set"} {row.setNumber}</span>
              <strong>
                {evidenceLoad(row, true)} × {row.previousReps}
                <span aria-hidden="true"> → </span>
                {evidenceLoad(row, false)} × {row.currentReps}
                {" · RIR " + row.rir}
              </strong>
            </li>)}
          </ul>}
          <small>{uk ? "Це зміни в журналі навантаження й повторень, а не вимір росту чи втрати м’язів." : "These are changes in logged load and reps, not a measurement of muscle growth or loss."}</small>
        </section>}
        {latestGroupSession && <section className={styles.loadAssessment} data-assessment={latestGroupSession.loadAssessment.status} aria-label={uk ? "Оцінка останнього тренування" : "Latest session assessment"}>
          <div className={styles.loadAssessmentHeading}>
            <strong>{uk ? "Останнє тренування" : "Latest session"}</strong>
            <span>{loadAssessmentLabel(latestGroupSession.loadAssessment)}</span>
          </div>
          <p>{loadAssessmentReason(latestGroupSession.loadAssessment)}</p>
          {latestGroupSession.loadAssessment.status === "uncertain"
            && latestGroupSession.loadAssessment.canAskForManualAssessment
            && assessmentSkippedFor !== latestGroupSession.id
            && <div className={styles.assessmentPrompt}>
              <p>{uk ? "Записів поки недостатньо. Це тренування було легшим за звичне?" : "There are not enough diary records yet. Was this session easier than usual?"}</p>
              <div className={styles.assessmentActions}>
                <button type="button" disabled={assessmentBusy} onClick={() => void saveLoadAssessment(latestGroupSession.id, "lighter")}>{uk ? "Так, було легше" : "Yes, it was easier"}</button>
                <button type="button" disabled={assessmentBusy} onClick={() => void saveLoadAssessment(latestGroupSession.id, "not-lighter")}>{uk ? "Ні, звичне або важче" : "No, usual or harder"}</button>
                <button type="button" className={styles.assessmentSkip} disabled={assessmentBusy} onClick={() => setAssessmentSkippedFor(latestGroupSession.id)}>{uk ? "Не зараз" : "Not now"}</button>
              </div>
            </div>}
          {assessmentNotice && <small role="status">{assessmentNotice}</small>}
        </section>}
        <details className={styles.fullDiaryDetails}>
          <summary>{uk ? "Детальні записи та джерела" : "Detailed diary records and sources"}</summary>
        <div className={styles.summaryMetrics}>
              <Metric label={uk ? "Прямі підходи" : "Direct sets"} value={count(groupReport.directUniqueSetCount, uk)} sourceFilter="direct" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
              <Metric label={uk ? "Допоміжні підходи" : "Indirect sets"} value={count(groupReport.indirectUniqueSetCount, uk)} sourceFilter="indirect" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
              <Metric label={uk ? "Унікальні зіставлені підходи" : "Unique mapped sets"} value={count(groupReport.totalUniqueSetCount, uk)} sourceFilter="mapped" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
              <Metric label={uk ? "Тренувальні дні з мапінгом" : "Logged exposure days"} value={count(groupReport.loggedTrainingDayCount, uk)} sourceFilter="days" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
        </div>
        {sourceFilter && !sourceFilter.startsWith("coverage:") && <SourceRecords
          sectionRef={sourceRecordsRef}
          heading={uk ? "Джерельні записи" : "Source records"}
          note={uk ? `Підходи, з яких складено показник: ${sourceFilterLabel(sourceFilter)}.` : `Diary entries contributing to ${sourceFilterLabel(sourceFilter)}.`}
          entries={sourceSets}
          filter={sourceFilter}
          anatomyId={anatomyId}
          emptyLabel={uk ? "Для цього показника немає зіставлених джерельних підходів." : "No mapped source sets contribute to this metric."}
          uk={uk}
          dateLabel={dateLabel}
          exerciseLabel={exerciseLabel}
          onClose={() => setSourceFilter(null)}
        />}
        <LoggedExposureIntervals intervals={groupReport.loggedExposureIntervals} uk={uk} dateLabel={dateLabel} />
        <p className={styles.provenance}>{uk ? "Кількість описує зіставлені підходи з журналу, а не виміряну активацію чи ріст м’язів." : "The count describes mapped diary sets, not measured activation or muscle growth."}</p>

        <section className={styles.subsection} aria-label={uk ? "Тижневий журнал" : "Weekly log"}>
          <h3>{uk ? "Підходи за тижнями" : "Sets by week"}</h3>
          {groupReport.weekly.length === 0
            ? <p className={styles.emptyState}>{uk ? "Немає записаних тренувальних тижнів." : "No logged training weeks."}</p>
            : <ul className={styles.weekList}>{groupReport.weekly.map((week) => <li key={week.weekStart}>
              <div className={styles.weekMeta}>
                <span>{uk ? "Тиждень від" : "Week of"} {dateLabel(week.weekStart)}</span>
                <span>
                  <button className={styles.weekSourceButton} type="button" aria-label={uk ? `Показати джерельні підходи за тиждень від ${dateLabel(week.weekStart)}: ${week.totalUniqueSetCount}` : `Show source sets for week of ${dateLabel(week.weekStart)}: ${week.totalUniqueSetCount}`} aria-expanded={sourceFilter === `week:${week.weekStart}`} aria-controls={sourceFilter === `week:${week.weekStart}` ? "body-map-source-records" : undefined} onClick={() => showSources(`week:${week.weekStart}`)}>{week.totalUniqueSetCount} {uk ? "підх." : "sets"}</button>
                  <span aria-hidden="true"> · </span>
                  <button className={styles.weekSourceButton} type="button" aria-label={uk ? `Показати джерельні сесії за тиждень від ${dateLabel(week.weekStart)}: ${week.loggedSessionCount}` : `Show source sessions for week of ${dateLabel(week.weekStart)}: ${week.loggedSessionCount}`} aria-expanded={sourceFilter === `week:${week.weekStart}`} aria-controls={sourceFilter === `week:${week.weekStart}` ? "body-map-source-records" : undefined} onClick={() => showSources(`week:${week.weekStart}`)}>{week.loggedSessionCount} {uk ? "сес." : "sessions"}</button>
                </span>
              </div>
              <div className={styles.barTrack} aria-hidden="true"><span style={{ width: `${Math.max(2, week.totalUniqueSetCount / maxWeeklySets * 100)}%` }} /></div>
              <small>
                {uk ? "Прямі" : "Direct"}: <button className={styles.weekSourceButton} type="button" aria-label={uk ? `Показати прямі джерельні підходи за тиждень від ${dateLabel(week.weekStart)}: ${week.directUniqueSetCount}` : `Show direct source sets for week of ${dateLabel(week.weekStart)}: ${week.directUniqueSetCount}`} aria-expanded={sourceFilter === `week-direct:${week.weekStart}`} aria-controls={sourceFilter === `week-direct:${week.weekStart}` ? "body-map-source-records" : undefined} onClick={() => showSources(`week-direct:${week.weekStart}`)}>{week.directUniqueSetCount}</button>
                <span aria-hidden="true"> · </span>
                {uk ? "допоміжні" : "Indirect"}: <button className={styles.weekSourceButton} type="button" aria-label={uk ? `Показати допоміжні джерельні підходи за тиждень від ${dateLabel(week.weekStart)}: ${week.indirectUniqueSetCount}` : `Show indirect source sets for week of ${dateLabel(week.weekStart)}: ${week.indirectUniqueSetCount}`} aria-expanded={sourceFilter === `week-indirect:${week.weekStart}`} aria-controls={sourceFilter === `week-indirect:${week.weekStart}` ? "body-map-source-records" : undefined} onClick={() => showSources(`week-indirect:${week.weekStart}`)}>{week.indirectUniqueSetCount}</button>
                {week.mappingCoverage === "partial" ? ` · ${uk ? "мапінг частковий" : "partial mapping"}` : ""}
              </small>
            </li>)}</ul>}
        </section>

        <section className={styles.subsection}>
          <h3>{uk ? "Записаний RIR" : "Reported RIR"}</h3>
          {groupReport.rirCounts.length === 0
            ? <p className={styles.emptyState}>{uk ? "RIR не вказаний у зіставлених підходах." : "RIR was not reported for mapped sets."}</p>
            : <div className={styles.rirList}>{groupReport.rirCounts.map(({ rir, uniqueSetCount }) => <button type="button" key={rir} aria-label={uk ? `Показати джерельні підходи з RIR ${rir}: ${uniqueSetCount}` : `Show source sets with RIR ${rir}: ${uniqueSetCount}`} aria-expanded={sourceFilter === `rir:${rir}`} aria-controls={sourceFilter === `rir:${rir}` ? "body-map-source-records" : undefined} onClick={() => showSources(`rir:${rir}`)}>RIR {rir}: <b>{uniqueSetCount}</b></button>)}</div>}
          <small className={styles.provenance}>{uk ? `RIR записаний у ${groupReport.reportedRirSetCount} підходах; не вказаний у ${groupReport.unreportedRirSetCount}. Значення є самозвітом і не перетворюється на «ефективні підходи».` : `RIR is recorded for ${groupReport.reportedRirSetCount} sets and unreported for ${groupReport.unreportedRirSetCount}. It is self-reported and is not converted into “effective sets.”`}</small>
        </section>

        <section className={styles.subsection}>
          <h3>{uk ? "Вправи та зіставний тренд" : "Exercises and comparable trend"}</h3>
          {groupReport.exercises.length === 0
            ? <p className={styles.emptyState}>{uk ? "Немає зіставлених вправ у цьому періоді." : "No mapped exercises were logged in this window."}</p>
            : <div className={styles.exerciseList}>{groupReport.exercises.map((exercise) => {
              const bySession = new Map<number, typeof exercise.sets>();
              for (const set of exercise.sets) bySession.set(set.sessionId, [...(bySession.get(set.sessionId) ?? []), set]);
              return <details className={styles.exercise} key={`${exercise.stableKey ?? exercise.exerciseName}:${exercise.resistanceType}`}>
                <summary>
                  <span><strong>{exerciseLabel(exercise.stableKey, exercise.exerciseName)}</strong><small>{exercise.totalUniqueSetCount} {uk ? "унікальних підходів" : "unique sets"} · {exercise.sessions} {uk ? "сесій" : "sessions"}</small></span>
                  <span className={styles.trendPill} data-trend={exercise.performanceTrend.status}>{trendLabel(exercise.performanceTrend.status)}</span>
                </summary>
                <div className={styles.exerciseBody}>
                  <p className={styles.provenance}>{uk
                    ? `${exercise.performanceTrend.segments.length > 1 ? "Підсумок лише для останньої фази. " : ""}${exercise.performanceTrend.comparableSessionCount} зіставні сесії · ${exercise.performanceTrend.comparedSetPairs} пар підходів. Це опис записаної ваги/повторень, не росту м’яза.`
                    : `${exercise.performanceTrend.segments.length > 1 ? "Summary is for the latest phase only. " : ""}${exercise.performanceTrend.comparableSessionCount} comparable sessions · ${exercise.performanceTrend.comparedSetPairs} set pairs. This describes logged load/reps, not muscle growth.`}</p>
                  {exercise.performanceTrend.segments.length > 1 && <div className={styles.trendSegments} aria-label={uk ? "Тренди за фазами тренування" : "Trends by training phase"}>
                    {exercise.performanceTrend.segments.map((segment) => <article className={styles.trendSegment} key={`${segment.phaseNumber}:${segment.fromDate}`}>
                      <div>
                        <strong>{segment.blockLabel || (uk ? "Блок без назви" : "Unnamed block")}</strong>
                        <small>{dateLabel(segment.fromDate)}–{dateLabel(segment.toDate)}</small>
                      </div>
                      <span className={styles.trendPill} data-trend={segment.status}>{trendLabel(segment.status)}</span>
                      <small>{segment.sessionIntent
                        ? sessionIntentLabel(segment.sessionIntent, uk)
                        : (uk ? "Намір не вказано" : "Intent not recorded")}
                        {` · ${segment.comparableSessionCount} ${uk ? "сес." : "sessions"} · ${segment.comparedSetPairs} ${uk ? "пар підх." : "set pairs"}`}</small>
                    </article>)}
                  </div>}
                  {[...bySession.entries()].sort((a, b) => a[1][0]!.sessionDate.localeCompare(b[1][0]!.sessionDate)).map(([sessionId, sessionSets]) => {
                    const first = sessionSets[0]!;
                    const context = contexts.get(sessionId);
                    return <article className={styles.session} key={sessionId}>
                      <div className={styles.sessionHeading}>
                        <strong>{dateLabel(first.sessionDate)}</strong>
                        <span>{first.exerciseIndex}/{first.exercisesInSession} {uk ? "вправ" : "exercises"}</span>
                      </div>
                      <p className={styles.sessionPlan}>
                        {first.sessionIntent
                          ? `${uk ? "Плановий намір" : "Pre-session intent"}: ${sessionIntentLabel(first.sessionIntent, uk)}`
                          : (uk ? "Намір до сесії не записано" : "Pre-session intent not recorded")}
                        {first.trainingBlockLabel ? ` · ${first.trainingBlockLabel}` : ""}
                        {first.trainingWeekNumber ? ` · ${uk ? "тиждень" : "week"} ${first.trainingWeekNumber}` : ""}
                      </p>
                      <p className={styles.sessionPlan}>
                        {uk ? "План" : "Plan"}: {first.plannedSets} {uk ? "підх." : "sets"}
                        {first.plannedRepsMin !== null || first.plannedRepsMax !== null ? ` · ${first.plannedRepsMin ?? "…"}–${first.plannedRepsMax ?? "…"} ${uk ? "повт." : "reps"}` : ""}
                        {first.plannedRir !== null ? ` · RIR ${first.plannedRir}` : ""}
                        {" · "}{uk ? "Факт" : "Actual"}: {first.actualExerciseSetCount} {uk ? "записаних підх." : "logged sets"}
                      </p>
                      {first.sessionIntent === "easy-deload" && <EasyDayPlanStatus first={first} sets={sessionSets} uk={uk} />}
                      {first.precedingExercises.length > 0 && <p className={styles.preceding}>
                        {uk ? "Перед цією вправою" : "Earlier in this session"}: {first.precedingExercises.map((previous) => `${exerciseLabel(previous.stableKey, previous.name)} (${previous.loggedSets})`).join(" · ")}
                      </p>}
                      <div className={styles.setList}>
                        {[...sessionSets].sort((a, b) => a.setNumber - b.setNumber).map((set) => <div className={styles.setRow} key={set.id}>
                          <span>{uk ? "Підхід" : "Set"} {set.setNumber}</span>
                          <span>{set.reps} {uk ? "повт." : "reps"}</span>
                          <span>{set.resistanceType === "RESISTANCE_BAND" ? `${resistanceEquipmentLabel(uk, set.exerciseStableKey, set.exerciseName)} · ${time(set.bandNominalResistanceKg, uk)}` : set.resistanceType === "BODYWEIGHT" ? (uk ? "власна вага" : "bodyweight") : time(set.weightKg, uk)}</span>
                          <span>RIR {set.rir === null ? (uk ? "не вказано" : "—") : set.rir}</span>
                          <span
                            aria-label={set.restBeforeSeconds === null
                              ? (uk ? "Відпочинок перед підходом не записаний" : "Rest before set not recorded")
                              : `${uk ? "Відпочинок перед підходом" : "Rest before set"}: ${count(set.restBeforeSeconds, uk)} ${uk ? "секунд" : "seconds"}`}
                            title={set.restBeforeSeconds === null
                              ? (uk ? "Відпочинок перед підходом не записаний" : "Rest before set not recorded")
                              : undefined}
                          >{set.restBeforeSeconds === null
                            ? "—"
                            : `${count(set.restBeforeSeconds, uk)} ${uk ? "с" : "s"}`}</span>
                        </div>)}
                      </div>
                      <div className={styles.contextGrid}>
                        <div><b>{uk ? "Сон за цю календарну дату" : "Sleep on this calendar date"}</b>
                          {context?.sleep
                            ? <small>{dateLabel(context.sleep.sleepDate)} · {(context.sleep.totalSleepMinutes / 60).toLocaleString(intlLocale, { maximumFractionDigits: 1 })} {uk ? "год" : "h"} · {context.sleep.segmentCount} {uk ? "сегм." : "segments"}{context.sleep.source.length ? ` · ${context.sleep.source.join(", ")}` : ""}</small>
                            : <small>{uk ? "Запису сну немає; це не означає нуль сну." : "No sleep record found; this does not mean zero sleep."}</small>}
                        </div>
                        <div><b>{uk ? "Харчовий запис за день тренування" : "Nutrition record for training day"}</b>
                          {context?.nutrition.status === "recorded"
                            ? <>
                              <small>{context.nutrition.caloriesKcal === null ? (uk ? "Ккал не записані" : "Calories not recorded") : `${count(context.nutrition.caloriesKcal, uk)} kcal`} · {context.nutrition.proteinG === null ? (uk ? "білок не записаний" : "protein not recorded") : `${count(context.nutrition.proteinG, uk)} g ${uk ? "білка" : "protein"}`} · {uk ? "щоденний запис здоров’я" : "daily health record"}</small>
                              {context.nutrition.updatedAt && <small>{uk ? "Оновлено" : "Updated"}: {dateTimeLabel(context.nutrition.updatedAt)}</small>}
                            </>
                            : <small>{uk ? "Запису ккал або білка за цю дату немає; це не означає нульове споживання." : "No calorie or protein record was found for this date; this does not mean zero intake."}</small>}
                          <small>{uk ? "Повнота харчового журналу, особиста ціль і середні за 7/28 днів у цьому джерелі недоступні." : "Food-log completeness, personal targets, and 7/28-day averages are unavailable from this source."}</small>
                        </div>
                      </div>
                    </article>;
                  })}
                </div>
              </details>;
            })}</div>}
        </section>
        </details>
      </>}

      {level === "SUBREGION_DETAIL" && groupReport && anatomyId && <>
        <div className={styles.summaryHeader}>
          <div><p className={styles.kicker}>{uk ? "АНАТОМІЧНА ЧАСТИНА" : "ANATOMY DETAIL"}</p><h2>{anatomyLabel}</h2></div>
        </div>
        {(() => {
          const anatomy = groupReport.anatomy.find((row) => row.anatomyId === anatomyId);
          return anatomy ? <>
            <div className={styles.summaryMetrics}>
              <Metric label={uk ? "Прямі підходи" : "Direct sets"} value={count(anatomy.directUniqueSetCount, uk)} sourceFilter="direct" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
              <Metric label={uk ? "Допоміжні підходи" : "Indirect sets"} value={count(anatomy.indirectUniqueSetCount, uk)} sourceFilter="indirect" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
              <Metric label={uk ? "Унікальні зіставлені підходи" : "Unique mapped sets"} value={count(anatomy.totalUniqueSetCount, uk)} sourceFilter="mapped" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
              <Metric label={uk ? "Тренувальні дні з мапінгом" : "Logged exposure days"} value={count(anatomy.loggedTrainingDayCount, uk)} sourceFilter="days" activeFilter={sourceFilter} onShowSources={showSources} uk={uk} />
            </div>
            {sourceFilter && !sourceFilter.startsWith("coverage:") && <SourceRecords
              sectionRef={sourceRecordsRef}
              heading={uk ? "Джерельні записи" : "Source records"}
              note={uk ? `Підходи, з яких складено показник: ${sourceFilterLabel(sourceFilter)}.` : `Diary entries contributing to ${sourceFilterLabel(sourceFilter)}.`}
              entries={sourceSets}
              filter={sourceFilter}
              anatomyId={anatomyId}
              emptyLabel={uk ? "Для цього показника немає зіставлених джерельних підходів." : "No mapped source sets contribute to this metric."}
              uk={uk}
              dateLabel={dateLabel}
              exerciseLabel={exerciseLabel}
              onClose={() => setSourceFilter(null)}
            />}
            <LoggedExposureIntervals intervals={anatomy.loggedExposureIntervals} uk={uk} dateLabel={dateLabel} />
            <p className={styles.provenance}>{anatomy.mappingCoverage === "partial"
              ? (uk ? "Підрахунок неповний: частина записів має часткове або відсутнє анатомічне зіставлення." : "Count is incomplete: some records have partial or missing anatomy mappings.")
              : (uk ? "Кількість показує лише підходи зіставлені саме з цією частиною; вона не розподіляє батьківську групу довільно." : "This count includes only sets mapped to this specific structure; it does not arbitrarily distribute parent-group sets.")}</p>
          </> : <div className={styles.emptyState}>
            <strong>{uk ? "Експозиція недоступна" : "Exposure unavailable"}</strong>
            <p>{uk ? "У поточних мапінгах немає достатньої підстави призначити підхід цій анатомічній частині. Це не нуль." : "Current mappings do not support assigning a set to this anatomy detail. This is not zero."}</p>
          </div>;
        })()}
      </>}

      <details className={styles.method}>
        <summary>{uk ? "Як читати ці дані та їхні межі" : "How to interpret these records"}</summary>
        <p>{uk
          ? "Це зіставлення журналу з анатомічними групами, а не вимір активації чи росту м’язів. Полегшений формат визначається лише за записаним обсягом підходів і суб’єктивним RIR відносно повторюваних вправ; за неоднозначності система питає після сесії. Порядок вправ використовується лише для зіставлення результатів; сон і харчування не трактуються як причина змін."
          : "This maps diary records to anatomy groups; it does not measure activation or muscle growth. A lighter session pattern is inferred only from logged set volume and self-reported RIR across repeated exercises; when the record is ambiguous, the app asks after the session. Exercise order is used only to compare like with like, and sleep or nutrition are not treated as causes of performance changes."}</p>
        <ul>
          <li><a href="https://pubmed.ncbi.nlm.nih.gov/38970765/" target="_blank" rel="noreferrer">{uk ? "RIR і тренувальні результати: метарегресії з обережними висновками" : "RIR and training outcomes: exploratory meta-regressions"}</a></li>
          <li><a href="https://pubmed.ncbi.nlm.nih.gov/32077380/" target="_blank" rel="noreferrer">{uk ? "Систематичний огляд порядку вправ і результатів тренування" : "Exercise order and training outcomes systematic review"}</a></li>
          <li><a href="https://pubmed.ncbi.nlm.nih.gov/38274324/" target="_blank" rel="noreferrer">{uk ? "Рандомізоване дослідження тижневого розвантаження" : "Randomized study of a one-week deload"}</a></li>
        </ul>
      </details>
    </>}
  </section>;
}

function Metric({ label, value, sourceFilter, activeFilter, onShowSources, uk = false }: {
  label: string;
  value: string;
  sourceFilter?: SourceFilter;
  activeFilter?: SourceFilter | null;
  onShowSources?: (filter: SourceFilter) => void;
  uk?: boolean;
}) {
  return <div className={styles.metric}><span>{label}</span>{sourceFilter && onShowSources
    ? <button className={styles.metricSourceButton} type="button" aria-label={uk ? `Показати джерельні записи для показника «${label}»: ${value}` : `Show source records for ${label}: ${value}`} aria-expanded={activeFilter === sourceFilter} aria-controls={activeFilter === sourceFilter ? "body-map-source-records" : undefined} onClick={() => onShowSources(sourceFilter)}><strong>{value}</strong></button>
    : <strong>{value}</strong>}</div>;
}

function EasyDayPlanStatus({ first, sets, uk }: { first: ExerciseSet; sets: readonly ExerciseSet[]; uk: boolean }) {
  const status = checkEasyDayPlan(first, sets);
  const label = status.kind === "met"
    ? uk ? "Факт відповідає записаним цілям легкого дня" : "Actual work matches the recorded easy-day targets"
    : status.kind === "different"
      ? uk ? "Факт відрізняється від записаних цілей легкого дня" : "Actual work differs from the recorded easy-day targets"
      : uk ? "Недостатньо даних, щоб порівняти легкий день із планом" : "Not enough data to compare this easy day with its plan";
  const targets = status.targets.map((target) => target === "sets"
    ? uk ? "підходи" : "sets"
    : target === "reps" ? uk ? "повторення" : "reps" : "RIR").join(", ");
  return <p className={styles.planAdherence} data-status={status.kind}>
    <strong>{label}</strong>
    <small>{targets
      ? `${uk ? "Перевірено за цілями" : "Checked against targets"}: ${targets}. `
      : `${uk ? "Планові цілі не записані. " : "No plan targets are recorded. "}`}
      {uk ? "Цільову вагу не збережено, тому вагу не порівнюємо." : "Planned load is not stored, so load is not compared."}</small>
  </p>;
}

function checkEasyDayPlan(first: ExerciseSet, sets: readonly ExerciseSet[]): {
  kind: "met" | "different" | "unavailable";
  targets: Array<"sets" | "reps" | "rir">;
} {
  const targets: Array<"sets" | "reps" | "rir"> = [];
  let matches = true;
  let missingActual = sets.length !== first.actualExerciseSetCount;
  if (first.plannedSets > 0) {
    targets.push("sets");
    matches &&= first.actualExerciseSetCount === first.plannedSets;
  }
  const hasRepTarget = first.plannedRepsMin !== null || first.plannedRepsMax !== null;
  if (hasRepTarget) {
    targets.push("reps");
    missingActual ||= sets.length === 0;
    matches &&= sets.every((set) => (first.plannedRepsMin === null || set.reps >= first.plannedRepsMin)
      && (first.plannedRepsMax === null || set.reps <= first.plannedRepsMax));
  }
  if (first.plannedRir !== null) {
    targets.push("rir");
    missingActual ||= sets.length === 0 || sets.some((set) => set.rir === null);
    matches &&= sets.every((set) => set.rir === first.plannedRir);
  }
  if (targets.length === 0 || missingActual) return { kind: "unavailable", targets };
  return { kind: matches ? "met" : "different", targets };
}

function SourceRecords({
  sectionRef,
  heading,
  note,
  entries,
  filter,
  anatomyId,
  emptyLabel,
  uk,
  dateLabel,
  exerciseLabel,
  onClose,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  heading: string;
  note: string;
  entries: Array<{ exercise: GroupReport["exercises"][number]; set: GroupReport["exercises"][number]["sets"][number] }>;
  filter: SourceFilter;
  anatomyId: AnatomyIdV2 | null;
  emptyLabel: string;
  uk: boolean;
  dateLabel: (date: string) => string;
  exerciseLabel: (stableKey: string | null, fallback: string) => string;
  onClose: () => void;
}) {
  const groups = new Map<string, { exercise: GroupReport["exercises"][number]; sets: GroupReport["exercises"][number]["sets"] }>();
  for (const { exercise, set } of entries) {
    const key = `${set.sessionId}:${set.exerciseIndex}`;
    const current = groups.get(key) ?? { exercise, sets: [] };
    current.sets.push(set);
    groups.set(key, current);
  }

  return <section className={styles.sourceRecords} id="body-map-source-records" ref={sectionRef} tabIndex={-1} aria-label={heading} aria-live="polite">
    <div className={styles.sourceRecordsHeading}>
      <div><h3>{heading}</h3><p>{note}</p></div>
      <button className={styles.sourceClose} type="button" onClick={onClose}>{uk ? "Закрити" : "Close"}</button>
    </div>
    {groups.size === 0 ? <p className={styles.emptyState}>{emptyLabel}</p> : <ul className={styles.sourceList}>
      {[...groups.entries()].map(([key, { exercise, sets }]) => {
        const first = sets[0]!;
        const setNumbers = sets.map(({ setNumber }) => setNumber).sort((left, right) => left - right).join(", ");
        return <li key={key}>
          <div>
            <strong>{dateLabel(first.sessionDate)} · {exerciseLabel(exercise.stableKey, exercise.exerciseName)}</strong>
            <small>{uk ? "Підходи" : "Sets"} {setNumbers} · {sourceExposureLabel(first, anatomyId, uk)}</small>
            {filter === "days" && <small>{uk ? "Записаний день тренування" : "Logged training day"}</small>}
          </div>
          <Link href={`/training/sessions/${first.sessionId}?exercise=${first.exerciseIndex}`} prefetch={false}>{uk ? "Відкрити сесію" : "Open session"}</Link>
        </li>;
      })}
    </ul>}
  </section>;
}

function sourceExposureLabel(set: GroupReport["exercises"][number]["sets"][number], anatomyId: AnatomyIdV2 | null, uk: boolean): string {
  const direct = anatomyId ? set.directAnatomyIds.includes(anatomyId) : set.directAnatomyIds.length > 0;
  const indirect = anatomyId ? set.indirectAnatomyIds.includes(anatomyId) : set.indirectAnatomyIds.length > 0;
  if (direct && indirect) return uk ? "пряме й допоміжне зіставлення" : "direct and indirect mapping";
  if (direct) return uk ? "пряме зіставлення" : "direct mapping";
  return uk ? "допоміжне зіставлення" : "indirect mapping";
}

function CoverageSourceRecords({
  sectionRef,
  heading,
  note,
  sessions,
  sources,
  filter,
  uk,
  dateLabel,
  exerciseLabel,
  locale,
  onClose,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  heading: string;
  note: string;
  sessions: BodyMapTrainingAnalyticsResponseV1["sessions"];
  sources: BodyMapAnalyticsCoverageSourceV1[];
  filter: CoverageFilter;
  uk: boolean;
  dateLabel: (date: string) => string;
  exerciseLabel: (stableKey: string | null, fallback: string) => string;
  locale: "uk" | "en";
  onClose: () => void;
}) {
  const sessionFilter = filter === "coverage:sessions";
  const groups = new Map<string, BodyMapAnalyticsCoverageSourceV1[]>();
  for (const source of sources) {
    const key = `${source.sessionId}:${source.exerciseIndex}`;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  const mappingStatus = (source: BodyMapAnalyticsCoverageSourceV1) => {
    if (!source.projectedToBodyMap) {
      return source.mappingCoverage === "partial"
        ? uk ? "немає проєкції; мапінг частковий" : "no projection; partial mapping"
        : uk ? "немає мапінгу до карти" : "no Body Map mapping";
    }
    return source.mappingCoverage === "partial"
      ? uk ? "частковий мапінг" : "partial mapping"
      : uk ? "мапінг доступний" : "mapped";
  };
  const setDescription = (source: BodyMapAnalyticsCoverageSourceV1) => {
    const reps = `${source.reps} ${uk ? "повт." : "reps"}`;
    const externalLoad = source.weightKg === null ? null : `${source.weightKg.toLocaleString(locale)} kg`;
    const bandLoad = source.bandNominalResistanceKg === null ? null : `${resistanceEquipmentLabel(uk, source.exerciseStableKey, source.exerciseName)} · ${source.bandNominalResistanceKg.toLocaleString(locale)} ${uk ? "кг" : "kg"}`;
    const load = externalLoad ?? bandLoad;
    const rir = source.rir === null ? (uk ? "RIR не вказано" : "RIR not reported") : `RIR ${source.rir}`;
    const anatomy = source.anatomyIds.length > 0
      ? source.anatomyIds.map((id) => bodyMapAnatomyLabel(id, id.replaceAll("_", " "), locale)).join(", ")
      : uk ? "анатомічні цілі не зіставлені" : "no mapped anatomy targets";
    return `${uk ? "Підхід" : "Set"} ${source.setNumber}: ${reps}${load ? ` · ${load}` : ""} · ${rir} · ${mappingStatus(source)} · ${anatomy}`;
  };

  return <section className={styles.sourceRecords} id="body-map-source-records" ref={sectionRef} tabIndex={-1} aria-label={heading} aria-live="polite">
    <div className={styles.sourceRecordsHeading}>
      <div><h3>{heading}</h3><p>{note}</p></div>
      <button className={styles.sourceClose} type="button" onClick={onClose}>{uk ? "Закрити" : "Close"}</button>
    </div>
    {sessionFilter
      ? sessions.length === 0
        ? <p className={styles.emptyState}>{uk ? "У вибраному періоді немає завершених сесій." : "No completed sessions are included in this window."}</p>
        : <ul className={styles.sourceList}>{sessions.map((session) => <li key={session.id}>
          <div><strong>{dateLabel(session.sessionDate)} · {uk ? "Сесія" : "Session"} #{session.id}</strong>
            <small>{session.exerciseCount} {uk ? "впр." : "exercises"} · {session.recordedSetCount} {uk ? "записаних підх." : "recorded sets"}</small></div>
          <Link href={`/training/sessions/${session.id}`} prefetch={false}>{uk ? "Відкрити сесію" : "Open session"}</Link>
        </li>)}</ul>
      : groups.size === 0
        ? <p className={styles.emptyState}>{uk ? "Для цього показника немає відповідних джерельних підходів." : "No source sets match this coverage metric."}</p>
        : <ul className={styles.sourceList}>{[...groups.entries()].map(([key, rows]) => {
          const first = rows[0]!;
          return <li key={key}>
            <div><strong>{dateLabel(first.sessionDate)} · {exerciseLabel(first.exerciseStableKey, first.exerciseName)}</strong>
              {rows.sort((left, right) => left.setNumber - right.setNumber).map((source) => <small key={source.setId}>{setDescription(source)}</small>)}</div>
            <Link href={`/training/sessions/${first.sessionId}?exercise=${first.exerciseIndex}`} prefetch={false}>{uk ? "Відкрити сесію" : "Open session"}</Link>
          </li>;
        })}</ul>}
  </section>;
}

function LoggedExposureIntervals({
  intervals,
  uk,
  dateLabel,
}: {
  intervals: BodyMapTrainingAnalyticsResponseV1["groups"][number]["loggedExposureIntervals"];
  uk: boolean;
  dateLabel: (date: string) => string;
}) {
  return <section className={styles.subsection} aria-label={uk ? "Проміжки між записаними тренувальними днями" : "Intervals between logged training days"}>
    <h3>{uk ? "Проміжки між записаними днями" : "Intervals between logged days"}</h3>
    {intervals.length === 0
      ? <p className={styles.emptyState}>{uk ? "Потрібні щонайменше два дні зіставлених записів, щоб показати проміжок." : "At least two days with mapped records are needed to show an interval."}</p>
      : <ul className={styles.weekList}>{intervals.map(({ previousDate, nextDate, calendarDays }) => <li key={`${previousDate}:${nextDate}`}>
        <div className={styles.weekMeta}>
          <span>{dateLabel(previousDate)} → {dateLabel(nextDate)}</span>
          <b>{calendarDays} {uk ? "дн." : "days"}</b>
        </div>
      </li>)}</ul>}
    <small className={styles.provenance}>{uk ? "Це календарні проміжки в журналі, а не оцінка відновлення." : "These are calendar gaps in the diary, not a recovery score."}</small>
  </section>;
}

function sessionIntentLabel(intent: NonNullable<BodyMapTrainingAnalyticsResponseV1["groups"][number]["exercises"][number]["sets"][number]["sessionIntent"]>, uk: boolean): string {
  const labels = {
    regular: uk ? "Звичайне тренування" : "Regular session",
    "easy-deload": uk ? "Легкий / розвантажувальний день" : "Easy / deload day",
    strength: uk ? "Силовий акцент" : "Strength focus",
    test: uk ? "Тестування" : "Test",
    "return-from-break": uk ? "Повернення після перерви" : "Return after a break",
  };
  return labels[intent];
}

function weekStartForDate(date: string): string {
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start.toISOString().slice(0, 10);
}
