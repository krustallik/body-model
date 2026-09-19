"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  EXERCISE_ORIGIN,
  RESISTANCE,
} from "@/modules/training/training.constants";
import { externalWeightEntryLabel } from "@/modules/training/external-load-accounting";
import { parseTrainingDecimal } from "@/modules/training/parse-training-decimal";
import type {
  ExerciseHistoryEntryDto,
  ExerciseHistorySetDto,
  StrengthSessionExerciseDto,
  StrengthSetDto,
} from "@/modules/training/training.types";
import { resolveExerciseImageSrc } from "./exercise-images";
import { resolveExerciseInfo } from "./exercise-info";
import {
  classifyCarouselRelease,
  isEditableSwipeTarget,
  shouldHandleKeyboardExerciseNav,
} from "./horizontal-swipe";
import { formatElapsedClock, resistanceLabel } from "./training-labels";
import styles from "./training.module.css";

export type SetDraft = {
  reps: string;
  weightKg: string;
  bandNominalResistanceKg: string;
  rir: string;
  comment: string;
};

const CAROUSEL_MS = 220;

type TrainingExerciseWorkspaceProps = {
  uk: boolean;
  mode: "live" | "edit";
  sessionId: number;
  backHref: string;
  programName: string;
  exercise: StrengthSessionExerciseDto;
  previousExercise?: StrengthSessionExerciseDto | null;
  nextExercise?: StrengthSessionExerciseDto | null;
  exerciseIndex: number;
  exerciseCount: number;
  draft: SetDraft;
  editingSetId: number | null;
  busy: boolean;
  error: string | null;
  menuOpen: boolean;
  clockStartedAt?: string | null;
  clockEndedAt?: string | null;
  clockTicking?: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  /** Mobile kebab popover / desktop form panels. */
  menuContent: ReactNode;
  /** Compact primary actions shown inline on desktop (>=1024). */
  desktopPrimaryActions?: ReactNode;
  /** Destructive / rare actions shown inline (or compact group) on desktop. */
  desktopDangerActions?: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onDraftChange: (next: SetDraft) => void;
  onSaveSet: () => void;
  onBeginEditSet: (set: StrengthSetDto) => void;
  onCancelEditSet: () => void;
  onDeleteSet: (setId: number) => void;
  trailingAction?: ReactNode;
  finishDialog?: ReactNode;
};

export function emptySetDraft(): SetDraft {
  return { reps: "", weightKg: "", bandNominalResistanceKg: "", rir: "", comment: "" };
}

function setLoadLabel(
  exercise: StrengthSessionExerciseDto,
  set: Pick<StrengthSetDto, "weightKg" | "bandNominalResistanceKg">,
  uk: boolean,
): string {
  if (exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && set.weightKg !== null) {
    return `${set.weightKg} ${uk ? "кг" : "kg"}`;
  }
  if (
    exercise.resistanceType === RESISTANCE.RESISTANCE_BAND
    && set.bandNominalResistanceKg !== null
  ) {
    return `${set.bandNominalResistanceKg} ${uk ? "кг резинки" : "kg band"}`;
  }
  return uk ? "власна вага" : "bodyweight";
}

function historyLoadLabel(
  resistanceType: string,
  set: ExerciseHistoryEntryDto["sets"][number],
  uk: boolean,
): string {
  if (resistanceType === RESISTANCE.EXTERNAL_WEIGHT && set.weightKg !== null) {
    return `${set.weightKg} ${uk ? "кг" : "kg"}`;
  }
  if (resistanceType === RESISTANCE.RESISTANCE_BAND && set.bandNominalResistanceKg !== null) {
    return `${set.bandNominalResistanceKg} ${uk ? "кг резинки" : "kg band"}`;
  }
  return uk ? "власна вага" : "bodyweight";
}

function formatHistoryDate(iso: string, uk: boolean): string {
  try {
    return new Date(iso).toLocaleDateString(uk ? "uk-UA" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function ExercisePeek({
  exercise,
  uk,
}: {
  exercise: StrengthSessionExerciseDto | null | undefined;
  uk: boolean;
}) {
  if (!exercise) {
    return <div className={styles.workoutCarouselPeek} aria-hidden="true" />;
  }
  const imageSrc = resolveExerciseImageSrc({
    snapshotExerciseName: exercise.snapshotExerciseName,
  });
  return (
    <div className={styles.workoutCarouselPeek} aria-hidden="true">
      <figure className={styles.workoutVisual}>
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt="" className={styles.workoutImage} />
        ) : (
          <div className={styles.workoutVisualEmpty} />
        )}
      </figure>
      <p className={styles.workoutCarouselPeekName}>{exercise.snapshotExerciseName}</p>
      <p className={styles.workoutCarouselPeekMeta}>
        {resistanceLabel(exercise.resistanceType, uk)}
        {" · "}
        {exercise.sets.length}/{exercise.plannedSets}
      </p>
    </div>
  );
}

function elapsedMs(startedAt: string | null | undefined, endedAt: string | null | undefined, now: number): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const end = endedAt ? new Date(endedAt).getTime() : now;
  if (!Number.isFinite(end)) return null;
  return end - start;
}

export function TrainingExerciseWorkspace(props: TrainingExerciseWorkspaceProps) {
  const {
    uk,
    sessionId,
    backHref,
    programName,
    exercise,
    previousExercise = null,
    nextExercise = null,
    exerciseIndex,
    exerciseCount,
    draft,
    editingSetId,
    busy,
    error,
    menuOpen,
    clockStartedAt = null,
    clockEndedAt = null,
    clockTicking = false,
    onToggleMenu,
    onCloseMenu,
    menuContent,
    desktopPrimaryActions,
    desktopDangerActions,
    onPrev,
    onNext,
    onDraftChange,
    onSaveSet,
    onBeginEditSet,
    onCancelEditSet,
    onDeleteSet,
    trailingAction,
    finishDialog,
  } = props;

  const pointerStart = useRef<{
    x: number;
    y: number;
    id: number;
    at: number;
    locked: boolean;
  } | null>(null);
  const menuButtonRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const animatingRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [history, setHistory] = useState<ExerciseHistoryEntryDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [infoExerciseId, setInfoExerciseId] = useState(exercise.id);
  const [dragPx, setDragPx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [copiedHint, setCopiedHint] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  if (exercise.id !== infoExerciseId) {
    setInfoExerciseId(exercise.id);
    setInfoOpen(false);
    setCommentOpen(false);
    setCopiedHint(false);
  }

  const showCommentField = commentOpen || draft.comment.trim().length > 0;

  const canPrev = exerciseIndex > 0;
  const canNext = exerciseIndex < exerciseCount - 1;
  const sets = exercise.sets.slice().sort((a, b) => a.setNumber - b.setNumber);
  const completedSets = sets.length;
  const plannedSets = exercise.plannedSets;
  const imageSrc = resolveExerciseImageSrc({
    snapshotExerciseName: exercise.snapshotExerciseName,
  });
  const info = resolveExerciseInfo({
    snapshotExerciseName: exercise.snapshotExerciseName,
  });

  const repsOk = Number.isFinite(Number(draft.reps)) && Number(draft.reps) >= 1;
  const weightValue = parseTrainingDecimal(draft.weightKg);
  const bandValue = parseTrainingDecimal(draft.bandNominalResistanceKg);
  const weightOk = exercise.resistanceType !== RESISTANCE.EXTERNAL_WEIGHT
    || (Number.isFinite(weightValue) && weightValue > 0);
  const bandOk = exercise.resistanceType !== RESISTANCE.RESISTANCE_BAND
    || (Number.isFinite(bandValue) && bandValue > 0);
  const canSave = !busy && repsOk && weightOk && bandOk;

  const clockMs = elapsedMs(clockStartedAt, clockTicking ? null : clockEndedAt, nowMs);

  useEffect(() => {
    if (!clockTicking || !clockStartedAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clockTicking, clockStartedAt]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDownDoc(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      onCloseMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseMenu();
    }
    document.addEventListener("pointerdown", onPointerDownDoc);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, onCloseMenu]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) setHistoryLoading(true);
      try {
        const response = await fetch(
          `/api/v1/training/sessions/${sessionId}/exercises/${exercise.id}/history`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = await response.json() as { entries: ExerciseHistoryEntryDto[] };
        if (!cancelled) setHistory(Array.isArray(body.entries) ? body.entries : []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, exercise.id]);

  function paneWidth(): number {
    const width = viewportRef.current?.clientWidth ?? 0;
    return width > 0 ? width : (typeof window !== "undefined" ? window.innerWidth : 320);
  }

  function finishCommit(direction: "left" | "right") {
    animatingRef.current = false;
    setAnimating(false);
    setDragPx(0);
    if (direction === "left") onNext();
    else onPrev();
  }

  function animateTo(offset: number, then?: () => void) {
    animatingRef.current = true;
    setAnimating(true);
    setDragPx(offset);
    window.setTimeout(() => {
      then?.();
    }, CAROUSEL_MS);
  }

  function requestNeighbor(delta: -1 | 1) {
    if (animatingRef.current) return;
    if (delta < 0 && !canPrev) return;
    if (delta > 0 && !canNext) return;
    const width = paneWidth();
    animateTo(delta > 0 ? -width : width, () => finishCommit(delta > 0 ? "left" : "right"));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldHandleKeyboardExerciseNav(event.key, document.activeElement)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        requestNeighbor(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        requestNeighbor(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrev, canNext, exercise.id]);

  function clampDrag(dx: number): number {
    if (dx > 0 && !canPrev) return 0;
    if (dx < 0 && !canNext) return 0;
    const width = paneWidth();
    return Math.max(-width, Math.min(width, dx));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse") return;
    if (animatingRef.current) return;
    if (isEditableSwipeTarget(event.target)) return;
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      at: Date.now(),
      locked: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and some browsers reject capture on non-pointer targets
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        pointerStart.current = null;
        setDragPx(0);
        return;
      }
      start.locked = true;
    }
    event.preventDefault();
    setDragPx(clampDrag(dx));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (isEditableSwipeTarget(event.target) && !start.locked) return;
    const decision = classifyCarouselRelease({
      startX: start.x,
      startY: start.y,
      endX: event.clientX,
      endY: event.clientY,
      durationMs: Date.now() - start.at,
      paneWidth: paneWidth(),
      canPrev,
      canNext,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : undefined,
    });
    if (decision.type === "ignore") {
      setDragPx(0);
      return;
    }
    if (decision.type === "snap-back") {
      animateTo(0, () => {
        animatingRef.current = false;
        setAnimating(false);
        setDragPx(0);
      });
      return;
    }
    const width = paneWidth();
    animateTo(decision.direction === "left" ? -width : width, () => finishCommit(decision.direction));
  }

  function copyHistorySet(set: ExerciseHistorySetDto) {
    onDraftChange({
      ...draft,
      reps: String(set.reps),
      weightKg: set.weightKg == null ? draft.weightKg : String(set.weightKg),
      bandNominalResistanceKg: set.bandNominalResistanceKg == null
        ? draft.bandNominalResistanceKg
        : String(set.bandNominalResistanceKg),
      rir: set.rir == null ? "" : String(set.rir),
    });
    setCopiedHint(true);
  }

  const progressLabel = uk
    ? `${completedSets} / ${plannedSets} підходів`
    : `${completedSets} / ${plannedSets} sets`;
  const exerciseCountLabel = uk
    ? `${exerciseIndex + 1} / ${exerciseCount} вправ`
    : `${exerciseIndex + 1} / ${exerciseCount} exercises`;

  return (
    <main className={styles.workoutShell}>
      <div className={styles.workoutFrame}>
        <header className={styles.workoutTop}>
          <div className={styles.workoutChrome}>
            <Link className={`${styles.liveBack} ${styles.workoutChromeBack}`} href={backHref}>
              {uk ? "← Назад" : "← Back"}
            </Link>
            {clockMs != null && (
              <time className={styles.workoutTimer} dateTime={`${Math.floor(clockMs / 1000)}s`}>
                {formatElapsedClock(clockMs)}
              </time>
            )}
            <div className={styles.workoutChromeMenu} ref={menuButtonRef}>
              <button
                className={styles.editMenuBtn}
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
                aria-label={uk ? "Меню сесії" : "Session menu"}
                onClick={onToggleMenu}
              >
                ⋯
              </button>
            </div>
          </div>

          <div className={styles.workoutHero}>
            <p className={styles.liveProgram}>{programName}</p>
            <p className={styles.liveProgress} aria-live="polite">{exerciseCountLabel}</p>
            <h1 className={styles.workoutTitle}>{exercise.snapshotExerciseName}</h1>
            <div className={styles.workoutStatusRow}>
              <span className={styles.liveBadge}>{resistanceLabel(exercise.resistanceType, uk)}</span>
              <span
                className={
                  completedSets >= plannedSets && plannedSets > 0
                    ? `${styles.workoutProgressBadge} ${styles.workoutProgressBadgeComplete}`
                    : styles.workoutProgressBadge
                }
                aria-live="polite"
              >
                {progressLabel}
              </span>
              {exercise.origin === EXERCISE_ORIGIN.EXTRA
                ? <span className={styles.workoutExtraBadge}>{uk ? "додаткова" : "extra"}</span>
                : null}
            </div>
          </div>

          {(desktopPrimaryActions || desktopDangerActions) && (
            <div className={styles.workoutDesktopActions} aria-label={uk ? "Дії сесії" : "Session actions"}>
              {desktopPrimaryActions ? (
                <div className={styles.workoutDesktopPrimary}>{desktopPrimaryActions}</div>
              ) : null}
              {desktopDangerActions ? (
                <div className={styles.workoutDesktopDanger}>{desktopDangerActions}</div>
              ) : null}
            </div>
          )}

          {menuOpen && (
            <>
              <button
                type="button"
                className={styles.workoutMenuBackdrop}
                aria-label={uk ? "Закрити меню" : "Close menu"}
                onClick={onCloseMenu}
              />
              <div
                ref={menuPanelRef}
                className={styles.workoutActionPanel}
                role="dialog"
                aria-label={uk ? "Дії" : "Actions"}
              >
                {menuContent}
              </div>
            </>
          )}
        </header>

        {error && <div className={styles.errorBanner} role="alert">{error}</div>}

        <div className={styles.workoutWorkspace}>
          <button
            className={`${styles.workoutSideNav} ${!canPrev ? styles.workoutSideNavHidden : ""}`}
            type="button"
            aria-label={uk ? "Попередня вправа" : "Previous exercise"}
            disabled={!canPrev}
            onClick={() => requestNeighbor(-1)}
          >
            ←
          </button>

          <div
            ref={viewportRef}
            className={styles.workoutCarouselViewport}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              pointerStart.current = null;
              if (!animatingRef.current) setDragPx(0);
            }}
          >
            <div
              className={styles.workoutCarouselTrack}
              style={{
                transform: `translateX(calc(-33.333% + ${dragPx}px))`,
                transition: animating ? `transform ${CAROUSEL_MS}ms ease-out` : "none",
              }}
            >
              <div className={styles.workoutCarouselPane}>
                <ExercisePeek exercise={previousExercise} uk={uk} />
              </div>
              <div className={styles.workoutCarouselPane}>
                <div className={styles.workoutMain}>
                  <figure className={styles.workoutVisual}>
                    {imageSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageSrc}
                        alt={exercise.snapshotExerciseName}
                        className={styles.workoutImage}
                      />
                    ) : (
                      <div className={styles.workoutVisualEmpty} aria-hidden="true" />
                    )}
                    <div className={styles.workoutImageHints}>
                      <button
                        className={styles.workoutImageHint}
                        type="button"
                        tabIndex={canPrev ? 0 : -1}
                        disabled={!canPrev}
                        aria-label={uk ? "Попередня вправа" : "Previous exercise"}
                        onClick={() => requestNeighbor(-1)}
                      >
                        ‹
                      </button>
                      <button
                        className={styles.workoutImageHint}
                        type="button"
                        tabIndex={canNext ? 0 : -1}
                        disabled={!canNext}
                        aria-label={uk ? "Наступна вправа" : "Next exercise"}
                        onClick={() => requestNeighbor(1)}
                      >
                        ›
                      </button>
                    </div>
                  </figure>

                  <div className={styles.workoutControls}>
                    {info && (
                      <section className={styles.workoutInfo} aria-label={uk ? "Про вправу" : "About exercise"}>
                        <button
                          type="button"
                          className={styles.workoutInfoToggle}
                          aria-expanded={infoOpen}
                          onClick={() => setInfoOpen((value) => !value)}
                        >
                          <span>{uk ? "М’язи та підказки" : "Muscles & cues"}</span>
                          <span aria-hidden="true">{infoOpen ? "▴" : "▾"}</span>
                        </button>
                        <div className={infoOpen ? styles.workoutInfoBody : styles.workoutInfoBodyCollapsed}>
                          <p className={styles.workoutInfoLine}>
                            <strong>{uk ? "Основні:" : "Primary:"}</strong>{" "}
                            {uk ? info.primaryMusclesUk : info.primaryMusclesEn}
                          </p>
                          {(uk ? info.secondaryMusclesUk : info.secondaryMusclesEn) && (
                            <p className={styles.workoutInfoLine}>
                              <strong>{uk ? "Додаткові:" : "Secondary:"}</strong>{" "}
                              {uk ? info.secondaryMusclesUk : info.secondaryMusclesEn}
                            </p>
                          )}
                          <ul className={styles.workoutCueList}>
                            {(uk ? info.cuesUk : info.cuesEn).map((cue) => (
                              <li key={cue}>{cue}</li>
                            ))}
                          </ul>
                        </div>
                      </section>
                    )}

                    <section className={styles.liveEntry} aria-label={uk ? "Новий підхід" : "New set"}>
                      <div className={styles.liveFields}>
                        {exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && (
                          <label className={styles.liveField}>
                            <span>{externalWeightEntryLabel(exercise.stableKey, uk)}</span>
                            <input
                              inputMode="decimal"
                              autoComplete="off"
                              value={draft.weightKg}
                              onChange={(event) => onDraftChange({ ...draft, weightKg: event.target.value })}
                            />
                          </label>
                        )}
                        {exercise.resistanceType === RESISTANCE.RESISTANCE_BAND && (
                          <label className={styles.liveField}>
                            <span>{uk ? "Опір резинки, кг" : "Band resistance, kg"}</span>
                            <input
                              inputMode="decimal"
                              autoComplete="off"
                              value={draft.bandNominalResistanceKg}
                              onChange={(event) => onDraftChange({
                                ...draft,
                                bandNominalResistanceKg: event.target.value,
                              })}
                            />
                          </label>
                        )}
                        <label className={styles.liveField}>
                          <span>{uk ? "Повтори" : "Reps"}</span>
                          <input
                            inputMode="numeric"
                            autoComplete="off"
                            value={draft.reps}
                            onChange={(event) => onDraftChange({ ...draft, reps: event.target.value })}
                          />
                        </label>
                        <label className={styles.liveField}>
                          <span>RIR</span>
                          <input
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder={uk ? "опційно" : "optional"}
                            value={draft.rir}
                            onChange={(event) => onDraftChange({ ...draft, rir: event.target.value })}
                          />
                        </label>
                      </div>
                      <p className={styles.workoutInfoLine}>
                        {uk
                          ? "RIR — скільки повторів ще залишалось у запасі (опційно)."
                          : "RIR — how many reps you still had in reserve (optional)."}
                      </p>

                      {!showCommentField ? (
                        <button
                          type="button"
                          className={styles.workoutCommentToggle}
                          onClick={() => setCommentOpen(true)}
                        >
                          {uk ? "+ Коментар" : "+ Comment"}
                        </button>
                      ) : (
                        <label className={styles.liveField}>
                          <span>{uk ? "Коментар" : "Comment"}</span>
                          <input
                            autoComplete="off"
                            maxLength={280}
                            placeholder={uk ? "напр. важко / читинг" : "e.g. hard / cheat reps"}
                            value={draft.comment}
                            onChange={(event) => onDraftChange({ ...draft, comment: event.target.value })}
                          />
                        </label>
                      )}

                      <div className={styles.liveSaveRow}>
                        {editingSetId != null && (
                          <button className={styles.liveSecondary} type="button" onClick={onCancelEditSet}>
                            {uk ? "Скасувати" : "Cancel"}
                          </button>
                        )}
                        <button
                          className={styles.liveSave}
                          type="button"
                          disabled={!canSave}
                          aria-busy={busy || undefined}
                          onClick={onSaveSet}
                        >
                          {busy
                            ? (uk ? "Збереження…" : "Saving…")
                            : editingSetId != null
                              ? (uk ? "Оновити підхід" : "Update set")
                              : (uk ? "Додати підхід" : "Add set")}
                        </button>
                      </div>
                      {trailingAction}
                    </section>

                    <section className={styles.workoutSets} aria-label={uk ? "Підходи" : "Sets"}>
                      <h2 className={styles.liveSectionTitle}>
                        {uk ? "Записані підходи" : "Logged sets"}
                        <span className={styles.workoutSetsCount}>{progressLabel}</span>
                      </h2>
                      {sets.length === 0 ? (
                        <p className={styles.liveEmptySets}>
                          {uk ? "Ще немає записаних підходів." : "No sets logged yet."}
                        </p>
                      ) : (
                        <ul className={styles.liveSetTable}>
                          {sets.map((set) => (
                            <li className={styles.liveSetRow} key={set.id}>
                              <span className={styles.liveSetNum}>#{set.setNumber}</span>
                              <span className={styles.liveSetLoad}>{setLoadLabel(exercise, set, uk)}</span>
                              <span className={styles.liveSetReps}>× {set.reps}</span>
                              {set.rir != null ? (
                                <span className={styles.liveSetRir}>RIR {set.rir}</span>
                              ) : (
                                <span className={styles.liveSetRir} />
                              )}
                              <span className={styles.liveSetActions}>
                                <button
                                  className={styles.workoutIconBtn}
                                  type="button"
                                  aria-label={uk ? "Змінити підхід" : "Edit set"}
                                  onClick={() => onBeginEditSet(set)}
                                >
                                  ✎
                                </button>
                                <button
                                  className={`${styles.workoutIconBtn} ${styles.workoutIconBtnDanger}`}
                                  type="button"
                                  disabled={busy}
                                  aria-label={uk ? "Видалити підхід" : "Delete set"}
                                  onClick={() => onDeleteSet(set.id)}
                                >
                                  ×
                                </button>
                              </span>
                              {set.comment ? (
                                <p className={styles.liveSetComment}>{set.comment}</p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className={styles.workoutHistory} aria-label={uk ? "Історія вправи" : "Exercise history"}>
                      <h2 className={styles.liveSectionTitle}>
                        {uk ? "Історія вправи" : "Exercise history"}
                      </h2>
                      <p className={styles.workoutHistoryHint}>
                        {uk
                          ? "Натисни підхід, щоб підставити вагу, повтори й RIR."
                          : "Tap a set to fill weight, reps, and RIR."}
                      </p>
                      {copiedHint && (
                        <p className={styles.workoutHistoryCopied} role="status">
                          {uk ? "Поля підставлено — додай підхід, коли будеш готовий." : "Fields filled — add the set when ready."}
                        </p>
                      )}
                      {historyLoading ? (
                        <p className={styles.liveEmptySets}>{uk ? "Завантаження…" : "Loading…"}</p>
                      ) : (history ?? []).length === 0 ? (
                        <p className={styles.liveEmptySets}>
                          {uk ? "Поки немає попередніх записів." : "No previous entries yet."}
                        </p>
                      ) : (
                        <ul className={styles.workoutHistoryList}>
                          {(history ?? []).map((entry) => (
                            <li className={styles.workoutHistoryEntry} key={`${entry.sessionId}-${entry.occurredAt}`}>
                              <div className={styles.workoutHistoryHead}>
                                <strong>{formatHistoryDate(entry.occurredAt, uk)}</strong>
                                <span>{entry.programName}</span>
                              </div>
                              <ul className={styles.workoutHistorySets}>
                                {entry.sets.map((set) => (
                                  <li key={`${entry.sessionId}-${set.setNumber}`}>
                                    <button
                                      type="button"
                                      className={styles.workoutHistorySetBtn}
                                      onClick={() => copyHistorySet(set)}
                                    >
                                      <span>#{set.setNumber}</span>
                                      <span>
                                        {historyLoadLabel(entry.resistanceType, set, uk)}
                                        {" × "}
                                        {set.reps}
                                        {set.rir != null ? ` · RIR ${set.rir}` : ""}
                                      </span>
                                    </button>
                                    {set.comment ? <em>{set.comment}</em> : null}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </div>
              </div>
              <div className={styles.workoutCarouselPane}>
                <ExercisePeek exercise={nextExercise} uk={uk} />
              </div>
            </div>
          </div>

          <button
            className={`${styles.workoutSideNav} ${!canNext ? styles.workoutSideNavHidden : ""}`}
            type="button"
            aria-label={uk ? "Наступна вправа" : "Next exercise"}
            disabled={!canNext}
            onClick={() => requestNeighbor(1)}
          >
            →
          </button>
        </div>
      </div>
      {finishDialog}
    </main>
  );
}
