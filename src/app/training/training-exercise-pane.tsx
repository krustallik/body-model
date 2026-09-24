"use client";

import type { ReactNode } from "react";
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
import { resistanceLabel } from "./training-labels";
import type { SetDraft } from "./training-exercise-workspace";
import styles from "./training.module.css";

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
};

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
  const progressLabel = uk
    ? `${completedSets} / ${plannedSets} підходів`
    : `${completedSets} / ${plannedSets} sets`;
  const TitleTag = interactive ? "h1" : "p";

  return (
    <div className={styles.workoutMain}>
      <div className={styles.workoutHero}>
        <TitleTag className={styles.workoutTitle}>{exercise.snapshotExerciseName}</TitleTag>
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

          {interactive && !showCommentField ? (
            <button
              type="button"
              className={styles.workoutCommentToggle}
              onClick={onOpenComment}
            >
              {uk ? "+ Коментар" : "+ Comment"}
            </button>
          ) : interactive ? (
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
          ) : null}

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
              {sets.map((set) => (
                <li className={styles.liveSetRow} key={set.id}>
                  <span className={styles.liveSetNum}>#{set.setNumber}</span>
                  <span className={styles.liveSetLoad}>
                    {setLoadLabel(exercise, set, uk)}
                    {" × "}
                    {set.reps}
                  </span>
                  {set.rir != null ? (
                    <span className={styles.liveSetRir}>RIR {set.rir}</span>
                  ) : (
                    <span className={styles.liveSetRir} />
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
              ))}
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
                    <span>{entry.programName}</span>
                  </div>
                  <ul className={styles.workoutHistorySets}>
                    {entry.sets.map((set) => (
                      <li key={`${entry.sessionId}-${set.setNumber}`}>
                        {interactive ? (
                          <button
                            type="button"
                            className={styles.workoutHistorySetBtn}
                            onClick={() => onCopyHistorySet(set)}
                          >
                            <span>#{set.setNumber}</span>
                            <span>
                              {historyLoadLabel(entry.resistanceType, set, uk)}
                              {" × "}
                              {set.reps}
                              {set.rir != null ? ` · RIR ${set.rir}` : ""}
                            </span>
                          </button>
                        ) : (
                          <div className={styles.workoutHistorySetBtn}>
                            <span>#{set.setNumber}</span>
                            <span>
                              {historyLoadLabel(entry.resistanceType, set, uk)}
                              {" × "}
                              {set.reps}
                              {set.rir != null ? ` · RIR ${set.rir}` : ""}
                            </span>
                          </div>
                        )}
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
  );
}
