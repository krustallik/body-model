"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StepperWorkoutDto } from "@/modules/training/stepper-workout.repository";
import type { StrengthSessionSummaryDto } from "@/modules/training/training.types";
import { currentTrainingHref } from "./training-url-state";
import { TrainingPagination } from "./training-pagination";
import {
  handleTrainingPaginationNavigate,
  parseTrainingPage,
  trainingSearchParamHref,
  updateTrainingSearchParams,
  useTrainingSearchParam,
} from "./training-url-state";
import {
  formatDateTime,
  formatDurationMinutes,
  formatSelectedActiveEnergyText,
  matchStatusBadgeTone,
  matchStatusLabel,
  planCompletionPillClass,
} from "./training-labels";
import styles from "./training.module.css";

const RECENT_PAGE_SIZE = 6;
const ATTENTION_PAGE_SIZE = 5;
const STEPPER_PAGE_SIZE = 6;

function matchBadgeClass(status: StrengthSessionSummaryDto["matchStatus"]): string {
  switch (matchStatusBadgeTone(status)) {
    case "ok": return styles.badgeSuccess;
    case "warn": return styles.badgeWarning;
    case "info": return styles.badgeInfo;
    case "danger": return styles.badgeDanger;
    case "neutral": return styles.badgeNeutral;
    default: return styles.badgeMuted;
  }
}

function usePageUrl(key: string) {
  const { value, ready } = useTrainingSearchParam(key);
  const page = parseTrainingPage(value);

  const hrefForPage = useCallback((nextPage: number) => (
    trainingSearchParamHref(key, nextPage <= 1 ? null : String(nextPage))
  ), [key]);

  const pageFromUrlMatches = typeof window === "undefined"
    ? true
    : new URLSearchParams(window.location.search).get(key) === value;

  useEffect(() => {
    if (ready && value !== null && page === 1 && value !== "1") {
      updateTrainingSearchParams({ [key]: null }, true);
    }
  }, [key, page, ready, value]);

  return { page, value, ready, pageFromUrlMatches, hrefForPage };
}

export function TrainingRecentSessionsPanel({
  uk,
  intlLocale,
  refreshVersion,
  busySessionId,
  onDeleteCancelledSession,
}: {
  uk: boolean;
  intlLocale: string;
  refreshVersion: number;
  busySessionId: number | null;
  onDeleteCancelledSession: (sessionId: number) => void;
}) {
  const { page, value, ready, pageFromUrlMatches, hrefForPage } = usePageUrl("recentPage");
  const [sessions, setSessions] = useState<StrengthSessionSummaryDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const requestKey = `${page}:${refreshVersion}`;
  const loading = loadedRequestKey !== requestKey;

  useEffect(() => {
    if (!ready || !pageFromUrlMatches || (value !== null && page === 1 && value !== "1")) return;
    const requestId = ++sequenceRef.current;
    const controller = new AbortController();
    let current = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/training/sessions/recent?limit=${RECENT_PAGE_SIZE + 1}&offset=${(page - 1) * RECENT_PAGE_SIZE}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(uk ? "Не вдалося завантажити сесії." : "Could not load sessions.");
        const body = await response.json() as { sessions: StrengthSessionSummaryDto[]; totalCount?: number };
        if (!current || requestId !== sequenceRef.current) return;
        const count = body.totalCount ?? Math.max(0, (page - 1) * RECENT_PAGE_SIZE + body.sessions.length);
        const lastPage = Math.max(1, Math.ceil(count / RECENT_PAGE_SIZE));
        if (page > lastPage) {
          updateTrainingSearchParams({ recentPage: lastPage === 1 ? null : String(lastPage) }, true);
          return;
        }
        setSessions(body.sessions.slice(0, RECENT_PAGE_SIZE));
        setTotalCount(count);
        setError(null);
        setLoadedRequestKey(requestKey);
      } catch (cause) {
        if (!current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : (uk ? "Не вдалося завантажити сесії." : "Could not load sessions."));
        setLoadedRequestKey(requestKey);
      }
    })();

    return () => { current = false; controller.abort(); };
  }, [page, pageFromUrlMatches, ready, requestKey, uk, value]);

  return (
    <section className={`${styles.panel} ${styles.panelRecent}`} aria-label={uk ? "Нещодавні силові сесії" : "Recent strength sessions"}>
      <div className={styles.panelHeader}>
        <div>
          <h2>{uk ? "Нещодавні силові сесії" : "Recent strength sessions"}</h2>
          <p>{uk ? "Дата, програма, тривалість, зіставлення" : "Date, program, duration, match state"}</p>
        </div>
      </div>
      <div className={styles.panelBody} aria-busy={loading}>
        {error && <p className={styles.errorBanner} role="alert">{error}</p>}
        {sessions.length === 0 ? (
          <div className={styles.empty}>
            <span>{page > 1
              ? (uk ? "На цій сторінці сесій немає. Поверніться назад." : "No sessions on this page. Go back a page.")
              : (uk ? "Ще немає завершених сесій." : "No sessions yet.")}</span>
          </div>
        ) : (
          <div className={styles.list}>
            {sessions.map((session) => (
              <article className={styles.card} key={session.id}>
                <div className={styles.cardTop}>
                  <div>
                    <strong>{session.programName}</strong>
                    <p className={styles.cardMeta}>
                      <span>
                        {formatDateTime(session.occurrenceAt ?? session.webStartedAt, intlLocale)}
                        {" · "}
                        {formatDurationMinutes(session.webStartedAt, session.webEndedAt, intlLocale, uk)}
                      </span>
                      {session.planCompletionPercent != null && (
                        <span className={planCompletionPillClass(session.planCompletionPercent, styles)}>
                          {uk ? `${session.planCompletionPercent}% плану` : `${session.planCompletionPercent}% of plan`}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={matchBadgeClass(session.matchStatus)}>{matchStatusLabel(session.matchStatus, uk)}</span>
                </div>
                <div className={styles.denseCardActions}>
                  <Link className={styles.linkLike} href={`/training/sessions/${session.id}`}>
                    {uk ? "Деталі" : "Details"}
                  </Link>
                  {(session.status === "COMPLETED" || session.status === "CANCELLED") && (
                    <Link className={styles.linkLike} href={`/training/sessions/${session.id}/edit`}>
                      {uk ? "Редагувати" : "Edit"}
                    </Link>
                  )}
                  {session.status === "CANCELLED" && (
                    <button
                      className={styles.dangerButton}
                      type="button"
                      disabled={busySessionId === session.id}
                      onClick={() => onDeleteCancelledSession(session.id)}
                    >
                      {busySessionId === session.id ? (uk ? "Видалення…" : "Deleting…") : (uk ? "Видалити" : "Delete")}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {(totalCount > RECENT_PAGE_SIZE || page > 1) && (
          <TrainingPagination
            currentPage={page}
            totalPages={Math.max(1, Math.ceil(totalCount / RECENT_PAGE_SIZE))}
            hrefForPage={hrefForPage}
            label={uk ? "Сторінки силових сесій" : "Strength session pages"}
            onNavigate={handleTrainingPaginationNavigate}
            uk={uk}
          />
        )}
      </div>
    </section>
  );
}

export function TrainingAttentionPanel({
  uk,
  intlLocale,
  refreshVersion,
}: {
  uk: boolean;
  intlLocale: string;
  refreshVersion: number;
}) {
  const { page, value, ready, pageFromUrlMatches, hrefForPage } = usePageUrl("attentionPage");
  const [sessions, setSessions] = useState<StrengthSessionSummaryDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const requestKey = `${page}:${refreshVersion}`;
  const loading = loadedRequestKey !== requestKey;

  useEffect(() => {
    if (!ready || !pageFromUrlMatches || (value !== null && page === 1 && value !== "1")) return;
    const requestId = ++sequenceRef.current;
    const controller = new AbortController();
    let current = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/training/sessions/match-attention?limit=${ATTENTION_PAGE_SIZE + 1}&offset=${(page - 1) * ATTENTION_PAGE_SIZE}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(uk ? "Не вдалося завантажити зіставлення." : "Could not load match attention.");
        const body = await response.json() as { sessions: StrengthSessionSummaryDto[]; totalCount?: number };
        if (!current || requestId !== sequenceRef.current) return;
        const count = body.totalCount ?? Math.max(0, (page - 1) * ATTENTION_PAGE_SIZE + body.sessions.length);
        const lastPage = Math.max(1, Math.ceil(count / ATTENTION_PAGE_SIZE));
        if (page > lastPage) {
          updateTrainingSearchParams({ attentionPage: lastPage === 1 ? null : String(lastPage) }, true);
          return;
        }
        setSessions(body.sessions.slice(0, ATTENTION_PAGE_SIZE));
        setTotalCount(count);
        setError(null);
        setLoadedRequestKey(requestKey);
      } catch (cause) {
        if (!current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : (uk ? "Не вдалося завантажити зіставлення." : "Could not load match attention."));
        setLoadedRequestKey(requestKey);
      }
    })();

    return () => { current = false; controller.abort(); };
  }, [page, pageFromUrlMatches, ready, requestKey, uk, value]);

  const hasItems = sessions.length > 0;
  return (
    <section className={`${styles.panel} ${hasItems ? styles.panelAttention : `${styles.panelCompact} ${styles.panelAttention}`}`} aria-label={uk ? "Увага до зіставлення" : "Match attention"} aria-busy={loading}>
      <div className={styles.panelHeader}>
        <div>
          <h2>{uk ? "Увага до зіставлення" : "Match attention"}</h2>
          <p>{uk ? "Неоднозначні або довго очікують Garmin" : "Ambiguous or long-pending Garmin links"}</p>
        </div>
      </div>
      <div className={styles.panelBody}>
        {error && <p className={styles.errorBanner} role="alert">{error}</p>}
        {hasItems ? (
          <>
            <div className={styles.list}>
              {sessions.map((session) => (
                <article className={styles.card} key={session.id}>
                  <div className={styles.cardTop}>
                    <div>
                      <strong>{session.programName}</strong>
                      <p className={styles.cardMeta}>
                        {formatDateTime(session.webStartedAt, intlLocale)}
                        {" · "}
                        {formatDurationMinutes(session.webStartedAt, session.webEndedAt, intlLocale, uk)}
                      </p>
                    </div>
                    <span className={matchBadgeClass(session.matchStatus)}>{matchStatusLabel(session.matchStatus, uk)}</span>
                  </div>
                  <Link className={styles.linkLike} href={`/training/sessions/${session.id}`}>
                    {uk ? "Відкрити" : "Open"}
                  </Link>
                </article>
              ))}
            </div>
            {(totalCount > ATTENTION_PAGE_SIZE || page > 1) && (
              <TrainingPagination
                currentPage={page}
                totalPages={Math.max(1, Math.ceil(totalCount / ATTENTION_PAGE_SIZE))}
                hrefForPage={hrefForPage}
                label={uk ? "Сторінки зіставлення" : "Match attention pages"}
                onNavigate={handleTrainingPaginationNavigate}
                uk={uk}
              />
            )}
          </>
        ) : (
          <>
            <p className={styles.emptyCompact}>
              {loading
                ? (uk ? "Перевіряємо стан зіставлення…" : "Checking match status…")
                : page > 1
                  ? (uk ? "На цій сторінці записів немає." : "No items on this page.")
                  : (uk ? "Немає сесій, що потребують уваги." : "No sessions need attention.")}
            </p>
            {page > 1 && (
              <TrainingPagination
                currentPage={page}
                totalPages={Math.max(1, Math.ceil(totalCount / ATTENTION_PAGE_SIZE))}
                hrefForPage={hrefForPage}
                label={uk ? "Сторінки зіставлення" : "Match attention pages"}
                onNavigate={handleTrainingPaginationNavigate}
                uk={uk}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function stepperSelectedEnergyText(workout: StepperWorkoutDto, uk: boolean): string {
  return formatSelectedActiveEnergyText({
    kcal: workout.selectedActiveEnergyKcal,
    source: workout.selectedActiveEnergySource,
    fullCoverage: workout.selectedActiveEnergyFullCoverage,
    uk,
    deviceKcalUnused: workout.activeEnergyKcal,
  });
}

function formatStepperDateTime(value: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone: "Europe/Bratislava",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function TrainingStepperList({
  uk,
  intlLocale,
  refreshVersion,
  busy,
  reconBusyId,
  onEdit,
  onDelete,
  onConfirmReconciliation,
  onRejectReconciliation,
}: {
  uk: boolean;
  intlLocale: string;
  refreshVersion: number;
  busy: boolean;
  reconBusyId: number | null;
  onEdit: (workout: StepperWorkoutDto) => void;
  onDelete: (workout: StepperWorkoutDto) => void;
  onConfirmReconciliation: (workout: StepperWorkoutDto) => void;
  onRejectReconciliation: (workout: StepperWorkoutDto) => void;
}) {
  const { page, value, ready, pageFromUrlMatches, hrefForPage } = usePageUrl("stepperPage");
  const [workouts, setWorkouts] = useState<StepperWorkoutDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const requestKey = `${page}:${refreshVersion}`;
  const loading = loadedRequestKey !== requestKey;

  useEffect(() => {
    if (!ready || !pageFromUrlMatches || (value !== null && page === 1 && value !== "1")) return;
    const requestId = ++sequenceRef.current;
    const controller = new AbortController();
    let current = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/training/stepper-workouts?limit=${STEPPER_PAGE_SIZE + 1}&offset=${(page - 1) * STEPPER_PAGE_SIZE}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(uk ? "Не вдалося завантажити степер." : "Could not load stepper workouts.");
        const body = await response.json() as { workouts: StepperWorkoutDto[]; totalCount?: number };
        if (!current || requestId !== sequenceRef.current) return;
        const count = body.totalCount ?? Math.max(0, (page - 1) * STEPPER_PAGE_SIZE + body.workouts.length);
        const lastPage = Math.max(1, Math.ceil(count / STEPPER_PAGE_SIZE));
        if (page > lastPage) {
          updateTrainingSearchParams({ stepperPage: lastPage === 1 ? null : String(lastPage) }, true);
          return;
        }
        setWorkouts(body.workouts.slice(0, STEPPER_PAGE_SIZE));
        setTotalCount(count);
        setError(null);
        setLoadedRequestKey(requestKey);
      } catch (cause) {
        if (!current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : (uk ? "Не вдалося завантажити степер." : "Could not load stepper workouts."));
        setLoadedRequestKey(requestKey);
      }
    })();

    return () => { current = false; controller.abort(); };
  }, [page, pageFromUrlMatches, ready, requestKey, uk, value]);

  return (
    <div className={styles.panelBody} aria-busy={loading}>
      {error && <p className={styles.errorBanner} role="alert">{error}</p>}
      {workouts.length === 0 ? (
        <div className={styles.empty}>
          <strong>{page > 1
            ? (uk ? "На цій сторінці записів немає" : "No workouts on this page")
            : (uk ? "Записів степера поки немає" : "No stepper workouts yet")}</strong>
          <span>{page > 1
            ? (uk ? "Поверніться до попередньої сторінки." : "Return to the previous page.")
            : (uk ? "Додайте тренування вручну або синхронізуйте Apple Health." : "Add one manually or sync Apple Health.")}</span>
        </div>
      ) : (
        <div className={styles.list}>
          {workouts.map((workout) => (
            <article className={styles.card} key={workout.id}>
              <div className={styles.cardTop}>
                <div>
                  <strong>{uk ? "Степер" : "Stepper"}</strong>
                  <p className={styles.cardMeta}>
                    <span>{formatStepperDateTime(workout.startAt, intlLocale)}</span>
                    <span>{formatDurationMinutes(workout.startAt, workout.endAt, intlLocale, uk)}</span>
                  </p>
                  <p className={styles.energyLine}>{stepperSelectedEnergyText(workout, uk)}</p>
                  {(workout.reconciliationStatus === "pending" || workout.reconciliationStatus === "ambiguous") && (
                    <p className={styles.reconNotice} role="status">
                      {uk ? "Можливе дублювання з Garmin · кроки лишаються доданими" : "Possible Garmin duplicate · steps stay additive"}
                    </p>
                  )}
                </div>
                <span className={workout.source === "manual" ? styles.badgePrimary : styles.badgeInfo}>
                  {workout.source === "manual" ? (uk ? "Ручний запис" : "Manual entry") : "Apple Health"}
                </span>
              </div>
              <div className={`${styles.denseCardActions} ${styles.stepperCardActions}`}>
                <Link
                  className={styles.secondaryButton}
                  href={`/training/workouts/${workout.id}/stepper-diagnostic?returnTo=${encodeURIComponent(currentTrainingHref())}`}
                >
                  {uk ? "Енергія · діагностика" : "Energy · diagnostics"}
                </Link>
                {(workout.reconciliationStatus === "pending" || workout.reconciliationStatus === "ambiguous")
                  && workout.reconciliationPeerWorkoutId !== null
                  && workout.reconciliationRole === "manual" && (
                  <button className={styles.secondaryButton} type="button" disabled={reconBusyId === workout.id || busy} onClick={() => onConfirmReconciliation(workout)}>
                    {uk ? "Підтвердити пару" : "Confirm pair"}
                  </button>
                )}
                {(workout.reconciliationStatus === "pending" || workout.reconciliationStatus === "ambiguous")
                  && workout.reconciliationGroupId !== null && (
                  <button className={styles.dangerButton} type="button" disabled={reconBusyId === workout.id || busy} onClick={() => onRejectReconciliation(workout)}>
                    {uk ? "Відхилити" : "Reject"}
                  </button>
                )}
                {workout.editable && <button className={styles.linkLike} type="button" disabled={busy} onClick={() => onEdit(workout)}>{uk ? "Редагувати" : "Edit"}</button>}
                {workout.editable && <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => onDelete(workout)}>{uk ? "Видалити" : "Delete"}</button>}
                {!workout.editable && <span className={styles.cardMeta}>{uk ? "Зв’язано із записом щоденника" : "Linked to a training diary entry"}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
      {(totalCount > STEPPER_PAGE_SIZE || page > 1) && (
        <TrainingPagination
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(totalCount / STEPPER_PAGE_SIZE))}
          hrefForPage={hrefForPage}
          label={uk ? "Сторінки степера" : "Stepper pages"}
          onNavigate={handleTrainingPaginationNavigate}
          uk={uk}
        />
      )}
    </div>
  );
}
