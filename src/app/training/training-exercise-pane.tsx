"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  EXERCISE_ORIGIN,
  RESISTANCE,
  TRAINING_LIMITS,
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

const SET_DELETE_SWIPE_RATIO = 0.75;
const SET_DELETE_SWIPE_MIN_PX = 56;

function setDeleteSwipeThreshold(viewportWidth: number): number {
  // Deletion requires a genuinely long swipe across most of the viewport,
  // regardless of where the gesture starts within the row.
  return Math.max(SET_DELETE_SWIPE_MIN_PX, Math.round(Math.max(0, viewportWidth) * SET_DELETE_SWIPE_RATIO));
}

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

function SetActionIcon({ kind }: { kind: "edit" | "delete" }) {
  return kind === "edit" ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
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
  busyLabel?: string;
  mutationUncertain?: boolean;
  historyMutationBlocked?: boolean;
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
  actionsOpen,
  onOpenActions,
  onCloseActions,
  onCopy,
  onUpdate,
  onDelete,
  mutationBlocked,
}: {
  entry: ExerciseHistoryEntryDto;
  set: ExerciseHistorySetDto;
  uk: boolean;
  interactive: boolean;
  actionsOpen: boolean;
  onOpenActions: () => void;
  onCloseActions: () => void;
  onCopy: (set: ExerciseHistorySetDto) => void;
  onUpdate: (entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto, payload: UpdateSetInput) => Promise<void>;
  onDelete: (entry: ExerciseHistoryEntryDto, set: ExerciseHistorySetDto) => Promise<void>;
  mutationBlocked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => historicalSetDraft(set));
  const [additionalLoadDirty, setAdditionalLoadDirty] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; id: number; offset: number; deleteThreshold: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const wasEditing = useRef(false);
  const editActionRef = useRef<HTMLButtonElement | null>(null);
  const firstEditorRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [deleteIntent, setDeleteIntent] = useState(false);
  const override = set.loadAccountingOverride == null
    ? null
    : setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
  const canPreserveOverride = override === null || override.success;
  const asymmetricCurrent = override?.success ? override.data.reps : undefined;

  useEffect(() => {
    if (editing) firstEditorRef.current?.focus();
    else if (wasEditing.current) editActionRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function preserveScroll(update: () => void) {
    const scrollY = window.scrollY;
    update();
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
  }

  function beginEdit() {
    if (mutationBlocked || !canPreserveOverride) return;
    setDraft(historicalSetDraft(set));
    setAdditionalLoadDirty(false);
    setError(null);
    setEditing(true);
    onCloseActions();
  }

  function cancelEdit() {
    preserveScroll(() => {
      setEditing(false);
      setAdditionalLoadDirty(false);
      setError(null);
      setDraft(historicalSetDraft(set));
    });
  }

  async function save() {
    if (mutationBlocked) return;
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
    const originalOverride = override?.success ? override.data : null;
    const originalAdditionalLoadKg = originalOverride?.additionalLoadKg;
    let additionalLoadKg: number | undefined;
    let additionalLoadChanged = false;
    if (entry.resistanceType === RESISTANCE.BODYWEIGHT) {
      let requestedAdditionalLoadKg: number | undefined;
      if (draft.additionalLoadKg.trim() !== "") {
        const parsedAdditionalLoadKg = parseTrainingDecimal(draft.additionalLoadKg);
        if (!Number.isFinite(parsedAdditionalLoadKg) || parsedAdditionalLoadKg < 0) {
          setError(uk
            ? "Додаткове обтяження має бути скінченним невід’ємним числом."
            : "Additional load must be a finite non-negative number.");
          return;
        }
        if (parsedAdditionalLoadKg > 0) requestedAdditionalLoadKg = parsedAdditionalLoadKg;
      }
      additionalLoadChanged = additionalLoadDirty && requestedAdditionalLoadKg !== originalAdditionalLoadKg;
      if (additionalLoadChanged && requestedAdditionalLoadKg !== undefined
          && requestedAdditionalLoadKg > TRAINING_LIMITS.maxLoadKg) {
        setError(uk
          ? `Максимальне додаткове обтяження — ${TRAINING_LIMITS.maxLoadKg} кг.`
          : `Maximum additional load is ${TRAINING_LIMITS.maxLoadKg} kg.`);
        return;
      }
      if (additionalLoadChanged) additionalLoadKg = requestedAdditionalLoadKg;
    }
    if (additionalLoadChanged && set.loadAccountingOverride != null && !override?.success) {
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
    if (override?.success || draft.asymmetric || additionalLoadChanged) {
      const nextOverride = originalOverride ? { ...originalOverride } : {};
      if (draft.asymmetric) {
        nextOverride.reps = { kind: "asymmetric-per-side", left, right };
      } else {
        delete nextOverride.reps;
      }
      if (entry.resistanceType === RESISTANCE.BODYWEIGHT) {
        if (additionalLoadChanged) {
          if (additionalLoadKg !== undefined) nextOverride.additionalLoadKg = additionalLoadKg;
          else delete nextOverride.additionalLoadKg;
        }
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
      const nextOverrideValue = Object.keys(validatedOverride.data).length > 0 ? validatedOverride.data : null;
      const originalOverrideValue = originalOverride && Object.keys(originalOverride).length > 0 ? originalOverride : null;
      if (JSON.stringify(nextOverrideValue) !== JSON.stringify(originalOverrideValue)) {
        payload.loadAccountingOverride = nextOverrideValue;
      }
    }

    setBusy(true);
    setError(null);
    try {
      await onUpdate(entry, set, payload);
      preserveScroll(() => {
        setEditing(false);
        setAdditionalLoadDirty(false);
      });
    } catch {
      setError(uk ? "Не вдалося зберегти підхід." : "Could not save this set.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mutationBlocked) return;
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
    if (!interactive || mutationBlocked || event.pointerType === "mouse" || busy || editing) return;
    if (event.target instanceof Element && event.target.closest("[data-history-action]:not([data-history-action='copy'])")) return;
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      offset: actionsOpen ? -104 : 0,
      deleteThreshold: setDeleteSwipeThreshold(window.innerWidth),
    };
    setDragOffset(actionsOpen ? -104 : 0);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      event.preventDefault();
      const offset = Math.max(-104, Math.min(0, start.offset + dx));
      setDragging(true);
      setDragOffset(offset);
      setDeleteIntent(dx <= -start.deleteThreshold);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const offset = Math.max(-104, Math.min(0, start.offset + dx));
    setDragging(false);
    if (Math.abs(dx) <= Math.abs(dy) * 1.15) {
      setDeleteIntent(false);
      setDragOffset(actionsOpen ? -104 : 0);
      return;
    }
    if (Math.abs(dx) >= 56) suppressClickUntil.current = Date.now() + 120;
    if (dx > 56 || offset > -52) {
      onCloseActions();
      setDeleteIntent(false);
      return;
    }
    onOpenActions();
    if (dx <= -start.deleteThreshold && interactive) {
      setDeleteIntent(true);
      void remove().finally(() => setDeleteIntent(false));
    }
  }

  return (
    <li
      className={styles.workoutHistorySetRow}
      data-testid={`history-set-${entry.sessionId}-${set.id}`}
      data-open={actionsOpen || undefined}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      data-delete-intent={deleteIntent || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => { event.stopPropagation(); pointerStart.current = null; setDragging(false); setDeleteIntent(false); setDragOffset(0); onCloseActions(); }}
      onClickCapture={(event) => {
        if (Date.now() <= suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickUntil.current = 0;
          return;
        }
        if (actionsOpen && event.target instanceof Element && event.target.closest(`.${styles.workoutHistorySwipeSurface}`)) {
          event.preventDefault();
          event.stopPropagation();
          setDragOffset(0);
          onCloseActions();
        }
      }}
    >
      {interactive && !editing && (
        <div className={styles.workoutSetActionsRail} role="group" aria-label={uk ? `Дії для підходу ${set.setNumber}` : `Actions for set ${set.setNumber}`}>
          <button ref={editActionRef} type="button" data-history-action="edit" className={styles.workoutSetIconButton} aria-label={uk ? `Редагувати підхід ${set.setNumber}` : `Edit set ${set.setNumber}`} title={uk ? "Редагувати" : "Edit"} disabled={!canPreserveOverride || busy || mutationBlocked} onFocus={onOpenActions} onClick={beginEdit}>
            <SetActionIcon kind="edit" />
          </button>
          <button type="button" data-history-action="delete" className={`${styles.workoutSetIconButton} ${styles.workoutHistoryDelete}`} aria-label={uk ? `Видалити підхід ${set.setNumber}` : `Delete set ${set.setNumber}`} title={uk ? "Видалити" : "Delete"} disabled={busy || mutationBlocked} onFocus={onOpenActions} onClick={() => void remove()}>
            <SetActionIcon kind="delete" />
          </button>
        </div>
      )}
      <div
        className={styles.workoutHistorySwipeSurface}
        data-editing={editing || undefined}
        style={{ transform: `translateX(${dragging ? dragOffset : actionsOpen ? -104 : 0}px)` }}
      >
        {interactive ? (
          <button
            type="button"
            data-history-action="copy"
            className={styles.workoutHistorySetBtn}
            aria-label={uk ? `Підставити дані підходу ${set.setNumber}` : `Use values from set ${set.setNumber}`}
            disabled={mutationBlocked}
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
        {interactive && editing && (
          <form className={styles.workoutHistoryEditForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {draft.asymmetric ? <>
            <label><span>{uk ? "Повтори зліва" : "Left reps"}</span><input ref={firstEditorRef} disabled={busy || mutationBlocked} inputMode="numeric" value={draft.leftReps} onChange={(event) => setDraft((current) => ({ ...current, leftReps: event.target.value }))} /></label>
            <label><span>{uk ? "Повтори справа" : "Right reps"}</span><input disabled={busy || mutationBlocked} inputMode="numeric" value={draft.rightReps} onChange={(event) => setDraft((current) => ({ ...current, rightReps: event.target.value }))} /></label>
          </> : <label><span>{uk ? "Повтори" : "Reps"}</span><input ref={firstEditorRef} disabled={busy || mutationBlocked} inputMode="numeric" value={draft.reps} onChange={(event) => setDraft((current) => ({ ...current, reps: event.target.value }))} /></label>}
          {entry.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && <label><span>{uk ? "Вага, кг" : "Weight, kg"}</span><input disabled={busy || mutationBlocked} inputMode="decimal" value={draft.weightKg} onChange={(event) => setDraft((current) => ({ ...current, weightKg: event.target.value }))} /></label>}
          {entry.resistanceType === RESISTANCE.BODYWEIGHT && <label><span>{uk ? "Додаткове обтяження, кг (необов’язково)" : "Additional load, kg (optional)"}</span><input disabled={busy || mutationBlocked} inputMode="decimal" autoComplete="off" placeholder={uk ? "опційно" : "optional"} value={draft.additionalLoadKg} onChange={(event) => { setAdditionalLoadDirty(true); setDraft((current) => ({ ...current, additionalLoadKg: event.target.value })); }} /></label>}
          {entry.resistanceType === RESISTANCE.RESISTANCE_BAND && <label><span>{uk ? "Опір резинки, кг" : "Band resistance, kg"}</span><input disabled={busy || mutationBlocked} inputMode="decimal" value={draft.bandNominalResistanceKg} onChange={(event) => setDraft((current) => ({ ...current, bandNominalResistanceKg: event.target.value }))} /></label>}
          {asymmetricCurrent !== undefined && <p>{uk ? "Асиметричні повтори збережуться окремо для кожної сторони." : "Asymmetric reps stay stored separately for each side."}</p>}
          <label><span>RIR</span><input disabled={busy || mutationBlocked} inputMode="numeric" value={draft.rir} onChange={(event) => setDraft((current) => ({ ...current, rir: event.target.value }))} /></label>
          <label className={styles.workoutHistoryComment}><span>{uk ? "Коментар" : "Comment"}</span><textarea disabled={busy || mutationBlocked} maxLength={500} value={draft.comment} onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} /></label>
          {error && <p role="alert">{error}</p>}
            <div className={styles.workoutHistoryActions}>
              <button type="submit" data-history-action="save" disabled={busy || mutationBlocked}>{busy ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти" : "Save")}</button>
              <button type="button" data-history-action="cancel" disabled={busy} onClick={cancelEdit}>{uk ? "Скасувати" : "Cancel"}</button>
            </div>
          </form>
        )}
        {error && !editing && <p role="alert">{error}</p>}
      </div>
      {error && !editing && !interactive ? <p role="alert">{error}</p> : null}
    </li>
  );
}

function LiveLoggedSetRow({
  exercise,
  set,
  uk,
  interactive,
  editing,
  actionsOpen,
  busy,
  busyLabel,
  saveBlocked,
  mutationBlocked,
  draft,
  onDraftChange,
  onSave,
  onEdit,
  onCancel,
  onDelete,
  onOpenActions,
  onCloseActions,
}: {
  exercise: StrengthSessionExerciseDto;
  set: StrengthSetDto;
  uk: boolean;
  interactive: boolean;
  editing: boolean;
  actionsOpen: boolean;
  busy: boolean;
  busyLabel?: string;
  saveBlocked: boolean;
  mutationBlocked: boolean;
  draft: SetDraft;
  onDraftChange: (next: SetDraft) => void;
  onSave: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenActions: () => void;
  onCloseActions: () => void;
}) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const editActionRef = useRef<HTMLButtonElement | null>(null);
  const pointerStart = useRef<{ x: number; y: number; id: number; offset: number; deleteThreshold: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const wasEditing = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [deleteIntent, setDeleteIntent] = useState(false);

  useEffect(() => {
    if (editing) {
      rowRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    } else if (wasEditing.current) {
      editActionRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);

  function onPointerDown(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    suppressClickUntil.current = 0;
    if (event.pointerType === "mouse" || busy || editing) return;
    if (event.target instanceof Element && event.target.closest("[data-set-action]")) return;
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      offset: actionsOpen ? -104 : 0,
      deleteThreshold: setDeleteSwipeThreshold(window.innerWidth),
    };
    setDragOffset(actionsOpen ? -104 : 0);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      event.preventDefault();
      const offset = Math.max(-104, Math.min(0, start.offset + dx));
      setDragging(true);
      setDragOffset(offset);
      setDeleteIntent(dx <= -start.deleteThreshold);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLLIElement>) {
    event.stopPropagation();
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const offset = Math.max(-104, Math.min(0, start.offset + dx));
    setDragging(false);
    if (Math.abs(dx) <= Math.abs(dy) * 1.15) {
      setDragOffset(actionsOpen ? -104 : 0);
      setDeleteIntent(false);
      return;
    }
    if (Math.abs(dx) >= 56) suppressClickUntil.current = Date.now() + 120;
    if (dx > 56 || offset > -52) {
      onCloseActions();
      setDeleteIntent(false);
      return;
    }
    onOpenActions();
    if (dx <= -start.deleteThreshold) {
      setDeleteIntent(true);
      onDelete();
      setDeleteIntent(false);
    }
  }

  const clockIso = setCompletionTimestampIso(set);
  const parsedOverride = setExecutionOverrideV1Schema.safeParse(set.loadAccountingOverride);
  const asymmetricReps = parsedOverride.success ? parsedOverride.data.reps : undefined;

  return (
    <li
      ref={rowRef}
      className={`${styles.liveSetRow} ${editing ? styles.liveSetRowEditing : ""}`}
      data-testid={`logged-set-${set.id}`}
      data-set-action-area
      data-open={actionsOpen || undefined}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      data-delete-intent={deleteIntent || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => { event.stopPropagation(); pointerStart.current = null; setDragging(false); setDragOffset(0); setDeleteIntent(false); onCloseActions(); }}
      onClickCapture={(event) => {
        if (Date.now() <= suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickUntil.current = 0;
          return;
        }
        if (actionsOpen && event.target instanceof Element && event.target.closest(`.${styles.liveSetSurface}`)) {
          event.preventDefault();
          event.stopPropagation();
          setDragOffset(0);
          onCloseActions();
        }
      }}
    >
      {interactive && !editing && <div className={styles.workoutSetActionsRail} role="group" aria-label={uk ? `Дії для підходу ${set.setNumber}` : `Actions for set ${set.setNumber}`}>
        <button ref={editActionRef} type="button" data-set-action className={styles.workoutSetIconButton} aria-label={uk ? `Редагувати підхід ${set.setNumber}` : `Edit set ${set.setNumber}`} title={uk ? "Редагувати" : "Edit"} disabled={busy || mutationBlocked} onFocus={onOpenActions} onClick={onEdit}>
          <SetActionIcon kind="edit" />
        </button>
        <button type="button" data-set-action className={`${styles.workoutSetIconButton} ${styles.workoutHistoryDelete}`} disabled={busy || mutationBlocked} aria-label={uk ? `Видалити підхід ${set.setNumber}` : `Delete set ${set.setNumber}`} title={uk ? "Видалити" : "Delete"} onFocus={onOpenActions} onClick={onDelete}>
          <SetActionIcon kind="delete" />
        </button>
      </div>}
      <div className={styles.liveSetSurface} style={{ transform: `translateX(${dragging ? dragOffset : actionsOpen ? -104 : 0}px)` }}>
      {editing ? (
        <>
          <span className={styles.liveSetNum}>#{set.setNumber}</span>
          <section className={`${styles.liveEntry} ${styles.liveSetInlineEditor}`} aria-label={uk ? `Редагування підходу ${set.setNumber}` : `Edit set ${set.setNumber}`}>
            <div className={styles.liveFields}>
              {exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && <label className={styles.liveField}><span>{externalWeightEntryLabel(exercise.stableKey, uk)}</span><input disabled={busy || saveBlocked} inputMode="decimal" autoComplete="off" value={draft.weightKg} onChange={(event) => onDraftChange({ ...draft, weightKg: event.target.value })} /></label>}
              {exercise.resistanceType === RESISTANCE.RESISTANCE_BAND && <label className={styles.liveField}><span>{uk ? "Опір резинки, кг" : "Band resistance, kg"}</span><input disabled={busy || saveBlocked} inputMode="decimal" autoComplete="off" value={draft.bandNominalResistanceKg} onChange={(event) => onDraftChange({ ...draft, bandNominalResistanceKg: event.target.value })} /></label>}
              {exercise.resistanceType === RESISTANCE.BODYWEIGHT && <label className={styles.liveField}><span>{uk ? "Додаткове обтяження, кг (необов’язково)" : "Additional load, kg (optional)"}</span><input disabled={busy || saveBlocked} inputMode="decimal" autoComplete="off" placeholder={uk ? "опційно" : "optional"} value={draft.additionalLoadKg} onChange={(event) => onDraftChange({ ...draft, additionalLoadKg: event.target.value })} /></label>}
              {asymmetricReps ? <>
                <label className={styles.liveField}><span>{uk ? "Повтори зліва" : "Left reps"}</span><input disabled={busy || saveBlocked} inputMode="numeric" value={draft.leftReps} onChange={(event) => onDraftChange({ ...draft, leftReps: event.target.value })} /></label>
                <label className={styles.liveField}><span>{uk ? "Повтори справа" : "Right reps"}</span><input disabled={busy || saveBlocked} inputMode="numeric" value={draft.rightReps} onChange={(event) => onDraftChange({ ...draft, rightReps: event.target.value })} /></label>
              </> : <label className={styles.liveField}><span>{uk ? "Повтори" : "Reps"}</span><input disabled={busy || saveBlocked} inputMode="numeric" autoComplete="off" value={draft.reps} onChange={(event) => onDraftChange({ ...draft, reps: event.target.value })} /></label>}
              <label className={styles.liveField}><span>RIR</span><input disabled={busy || saveBlocked} inputMode="numeric" autoComplete="off" value={draft.rir} onChange={(event) => onDraftChange({ ...draft, rir: event.target.value })} /></label>
              <label className={styles.liveField}><span>{uk ? "Коментар" : "Comment"}</span><input disabled={busy || saveBlocked} autoComplete="off" maxLength={280} value={draft.comment} onChange={(event) => onDraftChange({ ...draft, comment: event.target.value })} /></label>
            </div>
            {asymmetricReps && <p className={styles.workoutInfoLine}>{uk ? "Асиметричні повтори зберігаються окремо для кожної сторони." : "Asymmetric reps remain stored separately for each side."}</p>}
            <div className={styles.liveSaveRow}>
              <button className={styles.liveSave} type="button" disabled={busy || saveBlocked} aria-busy={busy || undefined} onClick={onSave}>{busy ? (busyLabel ?? (uk ? "Збереження…" : "Saving…")) : (uk ? "Оновити підхід" : "Update set")}</button>
              <button className={styles.liveSecondary} type="button" disabled={busy || saveBlocked} onClick={onCancel}>{uk ? "Скасувати" : "Cancel"}</button>
            </div>
          </section>
        </>
      ) : (
        <>
          <span className={styles.liveSetNum}>#{set.setNumber}</span>
          <span className={styles.liveSetLoad}>{setLoadLabel(exercise, set, uk)}{" × "}{set.reps}</span>
          {asymmetricReps ? <span className={styles.liveSetRir}>{uk ? `Л/П ${asymmetricReps.left}/${asymmetricReps.right}` : `L/R ${asymmetricReps.left}/${asymmetricReps.right}`}</span> : null}
          <span className={styles.liveSetRir}>{set.rir != null ? `RIR ${set.rir}` : ""}</span>
          {clockIso ? <time className={styles.liveSetClock} dateTime={clockIso}>{formatSetCompletionClock(set, uk ? "uk-UA" : "en-US")}</time> : <span className={styles.liveSetClock}>{uk ? "час недоступний" : "time unavailable"}</span>}
          {set.comment ? <p className={styles.liveSetComment}>{set.comment}</p> : null}
        </>
      )}
      </div>
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
    busyLabel,
    mutationUncertain = false,
    historyMutationBlocked = false,
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
  const [openSetActionsKey, setOpenSetActionsKey] = useState<string | null>(null);
  const openSetActions = (key: string) => setOpenSetActionsKey(key);
  const closeSetActions = (key: string) => setOpenSetActionsKey((current) => current === key ? null : current);
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

        {editingSetId === null && <section className={styles.liveEntry} aria-label={uk ? "Новий підхід" : "New set"}>
          <div className={styles.liveFields}>
            {exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT && (
              <label className={styles.liveField}>
                <span>{externalWeightEntryLabel(exercise.stableKey, uk)}</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  tabIndex={interactive ? 0 : -1}
                  readOnly={!interactive || busy || mutationUncertain}
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
                  readOnly={!interactive || busy || mutationUncertain}
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
                  readOnly={!interactive || busy || mutationUncertain}
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
                readOnly={!interactive || busy || mutationUncertain}
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
                readOnly={!interactive || busy || mutationUncertain}
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
              disabled={!interactive || busy || mutationUncertain}
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
                readOnly={busy || mutationUncertain}
                value={paneDraft.comment}
                onChange={(event) => onDraftChange({ ...paneDraft, comment: event.target.value })}
              />
            </label>
          )}

          <div className={styles.liveSaveRow}>
            {interactive && editingSetId != null && (
              <button className={styles.liveSecondary} type="button" disabled={busy || mutationUncertain} onClick={onCancelEditSet}>
                {uk ? "Скасувати" : "Cancel"}
              </button>
            )}
            <button
              className={styles.liveSave}
              type="button"
              disabled={!interactive || !canSave || busy || mutationUncertain}
              aria-busy={interactive && busy || undefined}
              onClick={interactive ? onSaveSet : undefined}
            >
              {interactive && busy
                ? (busyLabel ?? (uk ? "Збереження…" : "Saving…"))
                : interactive && editingSetId != null
                  ? (uk ? "Оновити підхід" : "Update set")
                  : (uk ? "Додати підхід" : "Add set")}
            </button>
          </div>
          {interactive ? trailingAction : null}
        </section>}

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
                const actionKey = `live:${exercise.id}:${set.id}`;
                return (
                  <LiveLoggedSetRow
                    key={set.id}
                    exercise={exercise}
                    set={set}
                    uk={uk}
                    interactive={interactive}
                    editing={editingSetId === set.id}
                    actionsOpen={openSetActionsKey === actionKey}
                    busy={busy}
                    busyLabel={busyLabel}
                    saveBlocked={mutationUncertain}
                    mutationBlocked={mutationUncertain}
                    draft={paneDraft}
                    onDraftChange={onDraftChange}
                    onSave={onSaveSet}
                    onEdit={() => { closeSetActions(actionKey); onBeginEditSet(set); }}
                    onCancel={onCancelEditSet}
                    onDelete={() => onDeleteSet(set.id)}
                    onOpenActions={() => openSetActions(actionKey)}
                    onCloseActions={() => closeSetActions(actionKey)}
                  />
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
                        actionsOpen={openSetActionsKey === `history:${entry.sessionId}:${set.id}`}
                        onOpenActions={() => openSetActions(`history:${entry.sessionId}:${set.id}`)}
                        onCloseActions={() => closeSetActions(`history:${entry.sessionId}:${set.id}`)}
                        onCopy={onCopyHistorySet}
                        onUpdate={onUpdateHistoricalSet}
                        onDelete={onDeleteHistoricalSet}
                        mutationBlocked={historyMutationBlocked}
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
