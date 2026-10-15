"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  EXERCISE_ORIGIN,
  RESISTANCE,
} from "@/modules/training/training.constants";
import { externalWeightEntryLabel } from "@/modules/training/external-load-accounting";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { parseTrainingDecimal } from "@/modules/training/parse-training-decimal";
import type {
  ExerciseHistoryEntryDto,
  ExerciseHistorySetDto,
  StrengthSessionExerciseDto,
  StrengthSetDto,
} from "@/modules/training/training.types";
import type { UpdateSetInput } from "@/modules/training/training.schema";
import { setExecutionOverrideV1Schema } from "@/modules/training/load-accounting-v1";
import { resolveExerciseImageSrc } from "./exercise-images";
import { resolveExerciseInfo } from "./exercise-info";
import { formatLoadKg, formatSetCompletionClock, resistanceLabel, setCompletionTimestampIso, trainingSessionTitle } from "./training-labels";
import type { SetDraft } from "./training-exercise-workspace";
import styles from "./training.module.css";

function setLoadLabel(
  exercise: StrengthSessionExerciseDto,
  set: Pick<StrengthSetDto, "weightKg" | "bandNominalResistanceKg" | "loadAccountingOverride">,
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
  const bodyweightLabel = uk ? "власна вага" : "bodyweight";
  const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
  const additionalLoadKg = parsedOverride.success ? parsedOverride.data.additionalLoadKg : undefined;
  return exercise.resistanceType === RESISTANCE.BODYWEIGHT
    && typeof additionalLoadKg === "number"
    && Number.isFinite(additionalLoadKg)
    && additionalLoadKg > 0
    ? `${bodyweightLabel} +${formatLoadKg(additionalLoadKg, uk ? "uk-UA" : "en-US")} ${uk ? "кг" : "kg"}`
    : bodyweightLabel;
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
  const bodyweightLabel = uk ? "власна вага" : "bodyweight";
  const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
  const additionalLoadKg = parsedOverride.success ? parsedOverride.data.additionalLoadKg : undefined;
  return resistanceType === RESISTANCE.BODYWEIGHT
    && typeof additionalLoadKg === "number"
    && Number.isFinite(additionalLoadKg)
    && additionalLoadKg > 0
    ? `${bodyweightLabel} +${formatLoadKg(additionalLoadKg, uk ? "uk-UA" : "en-US")} ${uk ? "кг" : "kg"}`
    : bodyweightLabel;
}

function formatHistoryDate(iso: string, uk: boolean): string {
  try {
    return new Intl.DateTimeFormat(uk ? "uk-UA" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: DEFAULT_TIME_ZONE,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export type ExercisePaneProps = {
  uk: boolean;
  exercise: StrengthSessionExerciseDto;
  interactive: boolean;
  draft: SetDraft;
  editingSetId: number | null;
  busy: boolean;
  canPrev: boolean;
  canNext: boolean;
  infoOpen: boolean;
  showCommentField: boolean;
  onToggleInfo: () => void;
  onOpenComment: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDraftChange: (next: SetDraft) => void;
  onSaveSet: () => void;
  onBeginEditSet: (set: StrengthSetDto) => void;
  onCancelEditSet: () => void;
  onDeleteSet: (setId: number) => void;
  trailingAction?: ReactNode;
  history: ExerciseHistoryEntryDto[];
  historyLoading: boolean;
  copiedHint: boolean;
  onCopyHistorySet: (set: ExerciseHistorySetDto) => void;
  onUpdateHistoricalSet: (entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto, payload: UpdateSetInput) => Promise<void>;
  onDeleteHistoricalSet: (entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto) => Promise<void>;
};

type HistoricalSetDraft = {
  reps: string;
  asymmetric: boolean;
  leftReps: string;
  rightReps: string;
  weightKg: string;
  additionalLoadKg: string;
  bandNominalResistanceKg: string;
  rir: string;
  comment: string;
};

function historicalSetDraft(set: ExerciseHistorySetDto): HistoricalSetDraft {
  const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
  const asymmetric = parsedOverride.success ? parsedOverride.data.reps : undefined;
  return {
    reps: String(set.reps),
    asymmetric: asymmetric !== undefined,
    leftReps: asymmetric ? String(asymmetric.left) : "",
    rightReps: asymmetric ? String(asymmetric.right) : "",
    weightKg: set.weightKg == null ? "" : String(set.weightKg),
    additionalLoadKg: parsedOverride.success && (parsedOverride.data.additionalLoadKg ?? 0) > 0
      ? String(parsedOverride.data.additionalLoadKg)
      : "",
    bandNominalResistanceKg: set.bandNominalResistanceKg == null ? "" : String(set.bandNominalResistanceKg),
    rir: set.rir == null ? "" : String(set.rir),
    comment: set.comment ?? "",
  };
}

function HistoricalSetRow({
  entry,
  set,
  uk,
  interactive,
  onCopy,
  onUpdate,
  onDelete,
}: {
  entry: ExerciseHistoryEntryDto;
  set: ExerciseHistorySetDto;
  uk: boolean;
  interactive: boolean;
  onCopy: (set: ExerciseHistorySetDto) => void;
  onUpdate: (entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto, payload: UpdateSetInput) => Promise<void>;
  onDelete: (entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto) => Promise<void>;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => historicalSetDraft(set));
  const pointerStart = useRef<{ x: number; y: number; id: number; width: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const wasEditing = useRef(false);
  const actionToggleRef = useRef<HTMLButtonElement | null>(null);
  const firstEditorRef = useRef<HTMLInputElement | null>(null);
  const override = set.loadAccountingOverride == null
    ? null
    : setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
  const canPreserveOverride = override === null || override.success;
  const asymmetricCurrent = override?.success ? override.data.reps : undefined;

  useEffect(() => {
    if (editing) firstEditorRef.current?.focus();
    else if (wasEditing.current) actionToggleRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function preserveScroll(update: () => void) {
    const scrollY = window.scrollY;
    update();
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
  }

  function beginEdit() {
    if (!canPreserveOverride) return;
    setDraft(historicalSetDraft(set));
    setError(null);
    setEditing(true);
    setActionsOpen(false);
  }

  function cancelEdit() {
    preserveScroll(() => {
      setEditing(false);
      setError(null);
      setDraft(historicalSetDraft(set));
    });
  }

  async function save() {
    const reps = Number(draft.reps);
    if (!draft.asymmetric && (!Number.isInteger(reps) || reps < 1)) {
      setError(uk ? "Вкажіть цілу кількість повторень." : "Enter a whole number of reps.");
      return;
    }
    const left = Number(draft.leftReps);
    const right = Number(draft.rightReps);
    if (draft.asymmetric && (!Number.isInteger(left) || left < 0 || !Number.isInteger(right) || right < 0 || left + right < 1)) {
      setError(uk ? "Вкажіть цілі повторення для обох сторін." : "Enter whole-number reps for both sides.");
      return;
    }
    const rir = draft.rir.trim() === "" ? null : Number(draft.rir);
    if (rir !== null && (!Number.isInteger(rir) || rir < 0 || rir > 10)) {
      setError(uk ? "RIR має бути цілим числом від 0 до 10." : "RIR must be a whole number from 0 to 10.");
      return;
    }
    const payload: UpdateSetInput = {
      reps: draft.asymmetric ? left + right : reps,
      rir,
      comment: draft.comment.trim() || null,
    };
    let additionalLoadKg: number | undefined;
    if (entry.resistanceType === RESISTANCE.BODYWEIGHT && draft.additionalLoadKg.trim() !== "") {
      const parsedAdditionalLoadKg = parseTrainingDecimal(draft.additionalLoadKg);
      if (!Number.isFinite(parsedAdditionalLoadKg) || parsedAdditionalLoadKg < 0) {
        setError(uk
          ? "Додаткове обтяження має бути скінченним невід’ємним числом."
          : "Additional load must be a finite non-negative number.");
        return;
      }
      if (parsedAdditionalLoadKg > 0) additionalLoadKg = parsedAdditionalLoadKg;
    }
    if (additionalLoadKg !== undefined && set.loadAccountingOverride != null && !override?.success) {
      setError(uk
        ? "Не вдалося безпечно зберегти попередні налаштування цього підходу."
        : "Could not safely preserve this set's existing accounting settings.");
      return;
    }
    if (entry.resistanceType === RESISTANCE.EXTERNAL_WEIGHT) {
      const weightKg = parseTrainingDecimal(draft.weightKg);
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        setError(uk ? "Вкажіть вагу." : "Enter a load.");
        return;
      }
      payload.weightKg = weightKg;
    } else if (entry.resistanceType === RESISTANCE.RESISTANCE_BAND) {
      const bandNominalResistanceKg = parseTrainingDecimal(draft.bandNominalResistanceKg);
      if (!Number.isFinite(bandNominalResistanceKg) || bandNominalResistanceKg <= 0) {
        setError(uk ? "Вкажіть опір резинки." : "Enter band resistance.");
        return;
      }
      payload.bandNominalResistanceKg = bandNominalResistanceKg;
    }
    if (override?.success || draft.asymmetric || additionalLoadKg !== undefined) {
      const nextOverride = override?.success ? { ...override.data } : {};
      if (draft.asymmetric) {
        nextOverride.reps = { kind: "asymmetric-per-side", left, right };
      } else {
        delete nextOverride.reps;
      }
      if (entry.resistanceType === RESISTANCE.BODYWEIGHT) {
        if (additionalLoadKg !== undefined) nextOverride.additionalLoadKg = additionalLoadKg;
        else delete nextOverride.additionalLoadKg;
      }
      const validatedOverride = setExecutionOverrideV1Schema.safeParse(nextOverride);
      if (!validatedOverride.success) {
        const assistanceConflict = validatedOverride.error.issues.some((issue) => issue.path.includes("assistanceLoadKg"));
        setError(assistanceConflict
          ? (uk
            ? "Підхід не може одночасно мати додаткове обтяження та допомогу."
            : "A set cannot have both additional load and assistance.")
          : (uk
            ? "Не вдалося перевірити налаштування обліку цього підходу."
            : "Could not validate this set's accounting settings."));
        return;
      }
      payload.loadAccountingOverride = Object.keys(validatedOverride.data).length > 0 ? validatedOverride.data : null;
    }

    setBusy(true);
    setError(null);
    try {
      await onUpdate(entry, set, payload);
      preserveScroll(() => {
        setEditing(false);
      });
    } catch {
      setError(uk ? "Не вдалося зберегти підхід." : "Could not save this set.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(uk ? "Видалити цей історичний підхід?" : "Delete this historical set?")) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(entry, set);
    } catch {
      setError(uk ? "Не вдалося видалити підхід." : "Could not delete this set.");
    } finally {
      setBusy(false);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    // A new gesture supersedes any click suppression left by a swipe that emitted no click.
    suppressClickUntil.current = 0;
    if (!interactive || event.pointerType === "mouse" || busy || editing) return;
    if (event.target instanceof Element && event.target.closest("[data-history-action]:not([data-history-action='copy'])")) return;
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      width: event.currentTarget.getBoundingClientRect().width,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) event.preventDefault();
  }

  function onPointerUp(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) <= Math.abs(dy) * 1.15) return;
    if (Math.abs(dx) >= 56) suppressClickUntil.current = Date.now() + 400;
    if (dx > 56) {
      setActionsOpen(false);
      return;
    }
    if (dx > -56) return;
    setActionsOpen(true);
    if (start.width >= 140 && -dx >= start.width * 0.86 && interactive && canPreserveOverride) void remove();
  }

  return (
    <li
      className={styles.workoutHistorySetRow}
      data-testid={`history-set-${entry.sessionId}-${set.id}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => { event.stopPropagation(); pointerStart.current = null; }}
      onClickCapture={(event) => {
        if (Date.now() > suppressClickUntil.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClickUntil.current = 0;
      }}
    >
      {interactive ? (
        <button
          type="button"
          data-history-action="copy"
          className={styles.workoutHistorySetBtn}
          aria-label={uk ? `Підставити дані підходу ${set.setNumber}` : `Use values from set ${set.setNumber}`}
          onClick={() => onCopy(set)}
        >
          <span>#{set.setNumber}</span>
          <span>{historyLoadLabel(entry.resistanceType, set, uk)}{" × "}{set.reps}{set.rir != null ? ` · RIR ${set.rir}` : ""}</span>
          <time dateTime={set.completedAt ?? undefined}>
            {set.completedAt && Number.isFinite(Date.parse(set.completedAt))
              ? new Intl.DateTimeFormat(uk ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: DEFAULT_TIME_ZONE }).format(new Date(set.completedAt))
              : (uk ? "час не записано" : "time not recorded")}
          </time>
        </button>
      ) : (
        <div className={styles.workoutHistorySetBtn}>
          <span>#{set.setNumber}</span>
          <span>{historyLoadLabel(entry.resistanceType, set, uk)}{" × "}{set.reps}{set.rir != null ? ` · RIR ${set.rir}` : ""}</span>
          <time dateTime={set.completedAt ?? undefined}>
            {set.completedAt && Number.isFinite(Date.parse(set.completedAt))
              ? new Intl.DateTimeFormat(uk ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: DEFAULT_TIME_ZONE }).format(new Date(set.completedAt))
              : (uk ? "час не записано" : "time not recorded")}
          </time>
        </div>
      )}
      {set.comment ? <em>{set.comment}</em> : null}
      {interactive && !editing && (
        <div className={styles.workoutHistoryActions}>
          <button
            type="button"
            data-history-action="toggle"
            ref={actionToggleRef}
            aria-label={uk ? `Дії для підходу ${set.setNumber}` : `Actions for set ${set.setNumber}`}
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((open) => !open)}
          >
            {uk ? "Дії" : "Actions"}
          </button>
          {actionsOpen && <>
            <button type="button" data-history-action="edit" disabled={!canPreserveOverride || busy} onClick={beginEdit}>
              {uk ? "Редагувати" : "Edit"}
            </button>
            <button type="button" data-history-action="delete" className={styles.workoutHistoryDelete} disabled={busy} onClick={() => void remove()}>
              {uk ? "Видалити" : "Delete"}
            </button>
          </>}
        </div>
      )}
      {interactive && editing && (
        <form className={styles.workoutHistoryEditForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {draft.asymmetric ? <>
            <label><span>{uk ? "Повтори зліва" : "Left reps"}</span><input ref={firstEditorRef} disabled={busy} inputMode="numeric" value={draft.leftReps} onChange={(event) => setDraft((current) => ({ ...current, leftReps: event.target.value }))} /></label>
            <label><span>{uk ? "Повтори справа" : "Right reps"}</span><input disabled={busy} inputMode="numeric" value={draft.rightReps} onChange={(event) => setDraft((current) => ({ ...current, rightReps: event.target.value }))} /></label>
          </> : <label><span>{uk ? "Повтори" : "Reps"}</span><input ref={firstEditorRef} disabled={busy} inputMode="numeric" value={draft.reps} onChange={(event) => setDraft((current) => ({ ...current, reps: event.target.value }))} /></label>}
          {entry.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && <label><span>{uk ? "Вага, кг" : "Weight, kg"}</span><input disabled={busy} inputMode="decimal" value={draft.weightKg} onChange={(event) => setDraft((current) => ({ ...current, weightKg: event.target.value }))} /></label>}
          {entry.resistanceType === RESISTANCE.BODYWEIGHT && <label><span>{uk ? "Додаткове обтяження, кг (необов’язково)" : "Additional load, kg (optional)"}</span><input disabled={busy} inputMode="decimal" autoComplete="off" placeholder={uk ? "опційно" : "optional"} value={draft.additionalLoadKg} onChange={(event) => setDraft((current) => ({ ...current, additionalLoadKg: event.target.value }))} /></label>}
          {entry.resistanceType === RESISTANCE.RESISTANCE_BAND && <label><span>{uk ? "Опір резинки, кг" : "Band resistance, kg"}</span><input disabled={busy} inputMode="decimal" value={draft.bandNominalResistanceKg} onChange={(event) => setDraft((current) => ({ ...current, bandNominalResistanceKg: event.target.value }))} /></label>}
          {asymmetricCurrent !== undefined && <p>{uk ? "Асиметричні повтори збережуться окремо для кожної сторони." : "Asymmetric reps stay stored separately for each side."}</p>}
          <label><span>RIR</span><input disabled={busy} inputMode="numeric" value={draft.rir} onChange={(event) => setDraft((current) => ({ ...current, rir: event.target.value }))} /></label>
          <label className={styles.workoutHistoryComment}><span>{uk ? "Коментар" : "Comment"}</span><textarea disabled={busy} maxLength={500} value={draft.comment} onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} /></label>
          {error && <p role="alert">{error}</p>}
          <div className={styles.workoutHistoryActions}>
            <button type="submit" data-history-action="save" disabled={busy}>{busy ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти" : "Save")}</button>
            <button type="button" data-history-action="cancel" disabled={busy} onClick={cancelEdit}>{uk ? "Скасувати" : "Cancel"}</button>
          </div>
        </form>
      )}
      {error && !editing && <p role="alert">{error}</p>}
    </li>
  );
}

export function ExercisePane(props: ExercisePaneProps) {
  const {
    uk,
    exercise,
    interactive,
    draft,
    editingSetId,
    busy,
    canPrev,
    canNext,
    infoOpen,
    showCommentField,
    onToggleInfo,
    onOpenComment,
    onPrev,
    onNext,
    onDraftChange,
    onSaveSet,
    onBeginEditSet,
    onCancelEditSet,
    onDeleteSet,
    trailingAction,
    history,
    historyLoading,
    copiedHint,
    onCopyHistorySet,
    onUpdateHistoricalSet,
    onDeleteHistoricalSet,
  } = props;

  const sets = exercise.sets.slice().sort((a, b) => b.setNumber - a.setNumber);
  const completedSets = sets.length;
  const plannedSets = exercise.plannedSets;
  const imageSrc = resolveExerciseImageSrc({
    snapshotExerciseName: exercise.snapshotExerciseName,
  });
  const info = resolveExerciseInfo({
    snapshotExerciseName: exercise.snapshotExerciseName,
  });
  const paneDraft = draft;
  const repsOk = Number.isFinite(Number(paneDraft.reps)) && Number(paneDraft.reps) >= 1;
  const weightValue = parseTrainingDecimal(paneDraft.weightKg);
  const bandValue = parseTrainingDecimal(paneDraft.bandNominalResistanceKg);
  const weightOk = exercise.resistanceType !== RESISTANCE.EXTERNAL_WEIGHT
    || (Number.isFinite(weightValue) && weightValue > 0);
  const bandOk = exercise.resistanceType !== RESISTANCE.RESISTANCE_BAND
    || (Number.isFinite(bandValue) && bandValue > 0);
  const canSave = interactive && !busy && repsOk && weightOk && bandOk;
  const progressLabel = plannedSets > 0
    ? (uk
      ? `${completedSets} / ${plannedSets} підходів`
      : `${completedSets} / ${plannedSets} sets`)
    : (uk
      ? `Записано підходів: ${completedSets}`
      : `Sets recorded: ${completedSets}`);
  return (
    <div className={styles.workoutMain}>
      <div className={styles.workoutHero}>
        <h1 className={styles.workoutTitle}>{exercise.snapshotExerciseName}</h1>
        <div className={styles.workoutStatusRow}>
          <span className={styles.liveBadge}>{resistanceLabel(exercise.resistanceType, uk)}</span>
          <span
            className={
              completedSets >= plannedSets && plannedSets > 0
                ? `${styles.workoutProgressBadge} ${styles.workoutProgressBadgeComplete}`
                : styles.workoutProgressBadge
            }
            aria-live={interactive ? "polite" : undefined}
          >
            {progressLabel}
          </span>
          {exercise.origin === EXERCISE_ORIGIN.EXTRA
            ? <span className={styles.workoutExtraBadge}>{uk ? "додаткова" : "extra"}</span>
            : null}
        </div>
      </div>

      <figure className={styles.workoutVisual}>
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={interactive ? exercise.snapshotExerciseName : ""}
            className={styles.workoutImage}
          />
        ) : (
          <div className={styles.workoutVisualEmpty} aria-hidden="true" />
        )}
        {interactive && (
          <div className={styles.workoutImageHints}>
            <button
              className={styles.workoutImageHint}
              type="button"
              tabIndex={canPrev ? 0 : -1}
              disabled={!canPrev}
              aria-label={uk ? "Попередня вправа" : "Previous exercise"}
              onClick={onPrev}
            >
              ‹
            </button>
            <button
              className={styles.workoutImageHint}
              type="button"
              tabIndex={canNext ? 0 : -1}
              disabled={!canNext}
              aria-label={uk ? "Наступна вправа" : "Next exercise"}
              onClick={onNext}
            >
              ›
            </button>
          </div>
        )}
      </figure>

      <div className={styles.workoutControls}>
        {info && (
          <section className={styles.workoutInfo} aria-label={uk ? "Про вправу" : "About exercise"}>
            <button
              type="button"
              className={styles.workoutInfoToggle}
              aria-expanded={interactive && infoOpen}
              tabIndex={interactive ? 0 : -1}
              onClick={interactive ? onToggleInfo : undefined}
            >
              <span>{uk ? "М’язи та підказки" : "Muscles & cues"}</span>
              <span aria-hidden="true">{interactive && infoOpen ? "▴" : "▾"}</span>
            </button>
            <div className={interactive && infoOpen ? styles.workoutInfoBody : styles.workoutInfoBodyCollapsed}>
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
                  tabIndex={interactive ? 0 : -1}
                  readOnly={!interactive}
                  value={paneDraft.weightKg}
                  onChange={(event) => onDraftChange({ ...paneDraft, weightKg: event.target.value })}
                />
              </label>
            )}
            {exercise.resistanceType === RESISTANCE.RESISTANCE_BAND && (
              <label className={styles.liveField}>
                <span>{uk ? "Опір резинки, кг" : "Band resistance, kg"}</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  tabIndex={interactive ? 0 : -1}
                  readOnly={!interactive}
                  value={paneDraft.bandNominalResistanceKg}
                  onChange={(event) => onDraftChange({
                    ...paneDraft,
                    bandNominalResistanceKg: event.target.value,
                  })}
                />
              </label>
            )}
            {exercise.resistanceType === RESISTANCE.BODYWEIGHT && (
              <label className={styles.liveField}>
                <span>{uk ? "Додаткове обтяження, кг (необов’язково)" : "Additional load, kg (optional)"}</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  tabIndex={interactive ? 0 : -1}
                  readOnly={!interactive}
                  placeholder={uk ? "опційно" : "optional"}
                  value={paneDraft.additionalLoadKg}
                  onChange={(event) => onDraftChange({
                    ...paneDraft,
                    additionalLoadKg: event.target.value,
                  })}
                />
              </label>
            )}
            <label className={styles.liveField}>
              <span>{uk ? "Повтори" : "Reps"}</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                tabIndex={interactive ? 0 : -1}
                readOnly={!interactive}
                value={paneDraft.reps}
                onChange={(event) => onDraftChange({ ...paneDraft, reps: event.target.value })}
              />
            </label>
            <label className={styles.liveField}>
              <span>RIR</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                tabIndex={interactive ? 0 : -1}
                readOnly={!interactive}
                placeholder={uk ? "опційно" : "optional"}
                value={paneDraft.rir}
                onChange={(event) => onDraftChange({ ...paneDraft, rir: event.target.value })}
              />
            </label>
          </div>
          <p className={styles.workoutInfoLine}>
            {uk
              ? "RIR — скільки повторів ще залишалось у запасі (опційно)."
              : "RIR — how many reps you still had in reserve (optional)."}
          </p>

          {!showCommentField || !interactive ? (
            <button
              type="button"
              className={styles.workoutCommentToggle}
              tabIndex={interactive ? 0 : -1}
              disabled={!interactive}
              onClick={interactive ? onOpenComment : undefined}
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
                value={paneDraft.comment}
                onChange={(event) => onDraftChange({ ...paneDraft, comment: event.target.value })}
              />
            </label>
          )}

          <div className={styles.liveSaveRow}>
            {interactive && editingSetId != null && (
              <button className={styles.liveSecondary} type="button" onClick={onCancelEditSet}>
                {uk ? "Скасувати" : "Cancel"}
              </button>
            )}
            <button
              className={styles.liveSave}
              type="button"
              disabled={!interactive || !canSave}
              aria-busy={interactive && busy || undefined}
              onClick={interactive ? onSaveSet : undefined}
            >
              {interactive && busy
                ? (uk ? "Збереження…" : "Saving…")
                : interactive && editingSetId != null
                  ? (uk ? "Оновити підхід" : "Update set")
                  : (uk ? "Додати підхід" : "Add set")}
            </button>
          </div>
          {interactive ? trailingAction : null}
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
              {sets.map((set) => {
                const clockIso = setCompletionTimestampIso(set);
                return (
                <li className={styles.liveSetRow} key={set.id}>
                  <span className={styles.liveSetNum}>#{set.setNumber}</span>
                  <span className={styles.liveSetLoad}>
                    {setLoadLabel(exercise, set, uk)}
                    {" × "}
                    {set.reps}
                  </span>
                  {(() => {
                    const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
                    return parsedOverride.success && parsedOverride.data.reps
                      ? <span className={styles.liveSetRir}>{uk ? `Л/П ${parsedOverride.data.reps.left}/${parsedOverride.data.reps.right}` : `L/R ${parsedOverride.data.reps.left}/${parsedOverride.data.reps.right}`}</span>
                      : null;
                  })()}
                  {set.rir != null ? (
                    <span className={styles.liveSetRir}>RIR {set.rir}</span>
                  ) : (
                    <span className={styles.liveSetRir} />
                  )}
                  {clockIso ? (
                    <time className={styles.liveSetClock} dateTime={clockIso}>
                      {formatSetCompletionClock(set, uk ? "uk-UA" : "en-US")}
                    </time>
                  ) : (
                    <span className={styles.liveSetClock}>
                      {uk ? "час недоступний" : "time unavailable"}
                    </span>
                  )}
                  {interactive ? (
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
                  ) : (
                    <span className={styles.liveSetActions} />
                  )}
                  {set.comment ? (
                    <p className={styles.liveSetComment}>{set.comment}</p>
                  ) : null}
                </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={styles.workoutHistory} aria-label={uk ? "Історія вправи" : "Exercise history"}>
          <h2 className={styles.liveSectionTitle}>
            {uk ? "Історія вправи" : "Exercise history"}
          </h2>
          {interactive && (
            <p className={styles.workoutHistoryHint}>
              {uk
                ? "Натисни підхід, щоб підставити вагу, повтори й RIR."
                : "Tap a set to fill weight, reps, and RIR."}
            </p>
          )}
          {interactive && copiedHint && (
            <p className={styles.workoutHistoryCopied} role="status">
              {uk ? "Поля підставлено — додай підхід, коли будеш готовий." : "Fields filled — add the set when ready."}
            </p>
          )}
          {historyLoading ? (
            <p className={styles.liveEmptySets}>{uk ? "Завантаження…" : "Loading…"}</p>
          ) : history.length === 0 ? (
            <p className={styles.liveEmptySets}>
              {uk ? "Поки немає попередніх записів." : "No previous entries yet."}
            </p>
          ) : (
            <ul className={styles.workoutHistoryList}>
              {history.map((entry) => (
                <li className={styles.workoutHistoryEntry} key={`${entry.sessionId}-${entry.occurredAt}`}>
                  <div className={styles.workoutHistoryHead}>
                    <strong>{formatHistoryDate(entry.occurredAt, uk)}</strong>
                    <span>{trainingSessionTitle(entry.programName, uk)}</span>
                  </div>
                  <ul className={styles.workoutHistorySets}>
                    {entry.sets.map((set) => (
                      <HistoricalSetRow
                        key={`${entry.sessionId}-${set.id}`}
                        entry={entry}
                        set={set}
                        uk={uk}
                        interactive={interactive}
                        onCopy={onCopyHistorySet}
                        onUpdate={onUpdateHistoricalSet}
                        onDelete={onDeleteHistoricalSet}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
