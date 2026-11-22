"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  recommendedResistanceTypeForCatalogStableKey,
  RESISTANCE,
} from "@/modules/training/training.constants";
import type { ExerciseCatalogDto } from "@/modules/training/training.types";
import { resolveExerciseImageSrc } from "./exercise-images";
import { resistanceLabel, usesCableResistanceEquipment } from "./training-labels";
import trainingStyles from "./training.module.css";
import { EXERCISE_PICKER_URL_PARAMS, ensureExercisePickerUrlDefaults, updateExercisePickerUrl } from "./exercise-picker-url-state";
import {
  EXERCISE_PICKER_CATEGORIES,
  exercisePickerMetadata,
  normalizeExercisePickerSearch,
  type ExercisePickerCategoryId,
  type ExercisePickerEquipment,
  type ExercisePickerSubcategory,
} from "./exercise-picker-catalog";
import styles from "./exercise-picker.module.css";

const EQUIPMENT_ORDER: readonly ExercisePickerEquipment[] = [
  "dumbbells", "barbell", "ez-bar", "cable", "bodyweight", "bench", "handles", "pull-up-bar", "machine", "other",
];

function equipmentLabel(value: ExercisePickerEquipment, uk: boolean): string {
  const labels: Record<ExercisePickerEquipment, [string, string]> = {
    dumbbells: ["Гантелі", "Dumbbells"],
    barbell: ["Штанга", "Barbell"],
    "ez-bar": ["EZ-гриф", "EZ bar"],
    cable: ["Блок", "Cable"],
    bodyweight: ["Вага тіла", "Bodyweight"],
    bench: ["Лава", "Bench"],
    handles: ["Ручки", "Handles"],
    "pull-up-bar": ["Перекладина", "Pull-up bar"],
    machine: ["Тренажер", "Machine"],
    other: ["Інше обладнання", "Other equipment"],
  };
  return labels[value][uk ? 0 : 1];
}

function resistanceDescription(exercise: ExerciseCatalogDto, uk: boolean): string {
  const metadata = exercisePickerMetadata(exercise);
  const resistance = recommendedResistanceTypeForCatalogStableKey(exercise.stableKey);
  if (metadata?.requiresBodyweightSetup) {
    return uk ? "Вага тіла · частка не задана" : "Bodyweight · share not set";
  }
  if (resistance === RESISTANCE.BODYWEIGHT) return uk ? "Вага тіла" : "Bodyweight";
  if (resistance === RESISTANCE.RESISTANCE_BAND) {
    return usesCableResistanceEquipment(exercise.stableKey, exercise.name)
      ? (uk ? "Опір блока" : "Cable resistance")
      : resistanceLabel(resistance, uk, exercise.stableKey, exercise.name);
  }
  if ([
    "lying_two_hand_dumbbell_triceps_extension_flat",
    "overhead_two_hand_dumbbell_triceps_extension_incline_30",
    "overhead_two_hand_dumbbell_triceps_extension_seated_90",
    "barbell_upright_row",
    "romanian_deadlift",
    "barbell_hip_thrust",
    "lying_ez_bar_triceps_extension_flat_0",
    "lying_ez_bar_triceps_extension_incline_30",
    "overhead_ez_bar_triceps_extension_seated_90",
    "overhead_ez_bar_triceps_extension_seated_30",
  ].includes(exercise.stableKey ?? "")) {
    return uk ? "Загальна зовнішня вага" : "Total external load";
  }
  if (metadata?.repsPerSide) return uk ? "Зовнішня вага · повтори на бік" : "External load · reps per side";
  if (metadata?.equipment.includes("dumbbells")) return uk ? "Зовнішня вага · на гантелю" : "External load · per dumbbell";
  return uk ? "Зовнішня вага" : "External load";
}

function subcategoryLabel(value: ExercisePickerSubcategory, uk: boolean): string {
  const labels: Record<ExercisePickerSubcategory, [string, string]> = {
    biceps: ["Біцепс", "Biceps"],
    triceps: ["Трицепс", "Triceps"],
    forearms: ["Передпліччя", "Forearms"],
  };
  return labels[value][uk ? 0 : 1];
}

function matchesSearch(exercise: ExerciseCatalogDto, query: string, uk: boolean): boolean {
  if (!query) return true;
  const meta = exercisePickerMetadata(exercise);
  const searchable = [
    exercise.name,
    exercise.stableKey ?? "",
    ...(meta?.aliases ?? []),
    ...(meta?.equipment ?? []).map((item) => equipmentLabel(item, uk)),
    ...(meta?.subcategory ? [subcategoryLabel(meta.subcategory, uk)] : []),
  ].join(" ");
  return normalizeExercisePickerSearch(searchable).includes(query);
}

function parsePickerUrlState(urlSearch: string) {
  const params = new URLSearchParams(urlSearch);
  const rawCategory = params.get(EXERCISE_PICKER_URL_PARAMS.category);
  const category = rawCategory === "all"
    || rawCategory === "categories"
    || EXERCISE_PICKER_CATEGORIES.some((item) => item.id === rawCategory)
    ? rawCategory === "categories" ? null : rawCategory as ExercisePickerCategoryId | "all"
    : null;
  const rawSubcategory = params.get(EXERCISE_PICKER_URL_PARAMS.subcategory);
  const subcategory: ExercisePickerSubcategory | "all" = rawSubcategory === "biceps" || rawSubcategory === "triceps" || rawSubcategory === "forearms"
    ? rawSubcategory
    : "all";
  const rawEquipment = params.get(EXERCISE_PICKER_URL_PARAMS.equipment);
  const equipment = rawEquipment === "all" || EQUIPMENT_ORDER.includes(rawEquipment as ExercisePickerEquipment)
    ? rawEquipment as ExercisePickerEquipment | "all"
    : "all";

  return {
    category,
    subcategory,
    equipment,
    search: params.get(EXERCISE_PICKER_URL_PARAMS.search) ?? "",
  };
}

export function ExercisePicker({
  open,
  exercises,
  uk,
  selectedId,
  loading = false,
  busy = false,
  error = null,
  onSelect,
  onConfirm,
  onClose,
  onRetry,
  confirmLabel,
  footerContent,
}: {
  open: boolean;
  exercises: ExerciseCatalogDto[];
  uk: boolean;
  selectedId: number | null;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  onSelect: (exercise: ExerciseCatalogDto) => void;
  onConfirm: () => void;
  onClose: () => void;
  onRetry?: () => void;
  confirmLabel: string;
  footerContent?: ReactNode;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const initialUrlState = parsePickerUrlState(typeof window === "undefined" ? "" : window.location.search);
  const [category, setCategory] = useState<ExercisePickerCategoryId | "all" | null>(initialUrlState.category);
  const [subcategory, setSubcategory] = useState<ExercisePickerSubcategory | "all">(initialUrlState.subcategory);
  const [equipment, setEquipment] = useState<ExercisePickerEquipment | "all">(initialUrlState.equipment);
  const [search, setSearch] = useState(initialUrlState.search);

  useEffect(() => {
    if (!open) return;
    ensureExercisePickerUrlDefaults();
    wasOpenRef.current = true;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        previousFocusRef.current?.focus();
      }
    };
  }, [open]);

  const selected = exercises.find((exercise) => exercise.id === selectedId) ?? null;
  const query = normalizeExercisePickerSearch(search.trim());
  const scopedExercises = useMemo(() => exercises.filter((exercise) => {
    const meta = exercisePickerMetadata(exercise);
    const categoryMatch = query || category === "all" || category === null
      ? true
      : meta?.category === category;
    const subcategoryMatch = query || category !== "arms" || subcategory === "all"
      ? true
      : meta?.subcategory === subcategory;
    return categoryMatch && subcategoryMatch && matchesSearch(exercise, query, uk);
  }), [category, exercises, query, subcategory, uk]);
  const availableEquipment = useMemo(() => {
    const found = new Set<ExercisePickerEquipment>();
    for (const exercise of scopedExercises) {
      const meta = exercisePickerMetadata(exercise);
      if (!meta) found.add("other");
      else for (const item of meta.equipment) found.add(item);
    }
    return EQUIPMENT_ORDER.filter((item) => found.has(item));
  }, [scopedExercises]);
  const effectiveEquipment = equipment === "all" || availableEquipment.includes(equipment) ? equipment : "all";
  const categoryCounts = useMemo(() => {
    const counts = new Map<ExercisePickerCategoryId, number>();
    for (const exercise of exercises) {
      const itemCategory = exercisePickerMetadata(exercise)?.category;
      if (itemCategory) counts.set(itemCategory, (counts.get(itemCategory) ?? 0) + 1);
    }
    return counts;
  }, [exercises]);
  const armSubcategoryCounts = useMemo(() => {
    const counts = new Map<ExercisePickerSubcategory, number>();
    for (const exercise of exercises) {
      const meta = exercisePickerMetadata(exercise);
      if (meta?.category === "arms" && meta.subcategory) counts.set(meta.subcategory, (counts.get(meta.subcategory) ?? 0) + 1);
    }
    return counts;
  }, [exercises]);
  const results = useMemo(() => scopedExercises.filter((exercise) => {
    const meta = exercisePickerMetadata(exercise);
    return effectiveEquipment === "all"
      || (meta ? meta.equipment.includes(effectiveEquipment) : effectiveEquipment === "other");
  }), [effectiveEquipment, scopedExercises]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget.querySelector<HTMLElement>("[role='dialog']");
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.closest("[hidden]"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open || typeof document === "undefined") return null;

  const title = query
    ? (uk ? "Результати пошуку" : "Search results")
    : category === null
      ? (uk ? "Каталог вправ" : "Exercise catalog")
      : category === "all"
        ? (uk ? "Усі вправи" : "All exercises")
        : EXERCISE_PICKER_CATEGORIES.find((item) => item.id === category)?.[uk ? "nameUk" : "nameEn"] ?? (uk ? "Вправи" : "Exercises");
  const showResults = query.length > 0 || category !== null;

  return createPortal(
    <div className={`${styles.backdrop} ${trainingStyles.exercisePickerPortalScope}`} onKeyDown={handleKeyDown} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} tabIndex={-1}>
        <header className={styles.header}>
          <div className={styles.headingGroup}>
            <p className={styles.eyebrow}>{uk ? "ТРЕНУВАННЯ · КАТАЛОГ" : "TRAINING · EXERCISE LIBRARY"}</p>
            <h2 id={headingId}>{title}</h2>
            <p id={descriptionId} className={styles.description}>
              {uk ? "Знайдіть рух за назвою, обладнанням або групою м’язів." : "Find a movement by name, equipment, or muscle group."}
            </p>
          </div>
          <button type="button" className={styles.closeButton} aria-label={uk ? "Закрити каталог" : "Close exercise picker"} onClick={onClose}>×</button>
        </header>

        <div className={styles.toolbar}>
          {showResults && (
            <button type="button" className={styles.backButton} onClick={() => {
              setCategory(null);
              setSubcategory("all");
              setEquipment("all");
              setSearch("");
              updateExercisePickerUrl({
                [EXERCISE_PICKER_URL_PARAMS.category]: "categories",
                [EXERCISE_PICKER_URL_PARAMS.subcategory]: "all",
                [EXERCISE_PICKER_URL_PARAMS.equipment]: "all",
                [EXERCISE_PICKER_URL_PARAMS.search]: null,
              });
              searchRef.current?.focus();
            }}>
              <span aria-hidden="true">←</span>{uk ? "До категорій" : "Back to categories"}
            </button>
          )}
          <label className={styles.searchBox}>
            <span className={styles.searchIcon} aria-hidden="true">⌕</span>
            <span className={styles.visuallyHidden}>{uk ? "Пошук усіх вправ" : "Search all exercises"}</span>
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => {
                const value = event.target.value;
                setSearch(value);
                updateExercisePickerUrl({ [EXERCISE_PICKER_URL_PARAMS.search]: value || null });
              }}
              placeholder={uk ? "Пошук вправ…" : "Search exercises…"}
              autoComplete="off"
              enterKeyHint="search"
            />
            {search && <button type="button" className={styles.clearSearch} aria-label={uk ? "Очистити пошук" : "Clear search"} onClick={() => {
              setSearch("");
              updateExercisePickerUrl({ [EXERCISE_PICKER_URL_PARAMS.search]: null });
            }}>×</button>}
          </label>
        </div>

        {error && <div className={styles.error} role="alert">{error}{onRetry && <button type="button" onClick={onRetry}>{uk ? "Спробувати ще раз" : "Try again"}</button>}</div>}
        {loading ? (
          <div className={styles.status} role="status">{uk ? "Завантаження каталогу…" : "Loading exercise catalog…"}</div>
        ) : showResults ? (
          <div className={styles.content}>
            <div className={styles.resultHeader}>
              {category === "arms" && !query && (
                <div className={styles.subcategories} aria-label={uk ? "Підгрупа рук" : "Arm subgroup"}>
                  {(["all", "biceps", "triceps", "forearms"] as const).map((item) => (
                    <button key={item} type="button" className={subcategory === item ? styles.filterActive : styles.filter}
                      aria-pressed={subcategory === item} onClick={() => {
                        setSubcategory(item);
                        setEquipment("all");
                        updateExercisePickerUrl({
                          [EXERCISE_PICKER_URL_PARAMS.subcategory]: item,
                          [EXERCISE_PICKER_URL_PARAMS.equipment]: "all",
                        });
                      }}>
                      {item === "all" ? (uk ? "Усі руки" : "All arms") : subcategoryLabel(item, uk)}
                      {item !== "all" && <span>{armSubcategoryCounts.get(item) ?? 0}</span>}
                    </button>
                  ))}
                </div>
              )}
              {query && <p className={styles.resultCount} aria-live="polite">{uk ? `Знайдено: ${results.length}` : `Found: ${results.length}`}</p>}
            </div>
            <div className={styles.filters} aria-label={uk ? "Фільтр за обладнанням" : "Filter by equipment"}>
              <button type="button" className={effectiveEquipment === "all" ? styles.filterActive : styles.filter} aria-pressed={effectiveEquipment === "all"} onClick={() => {
                setEquipment("all");
                updateExercisePickerUrl({ [EXERCISE_PICKER_URL_PARAMS.equipment]: "all" });
              }}>{uk ? "Усе обладнання" : "All equipment"}</button>
              {availableEquipment.map((item) => (
                <button key={item} type="button" className={effectiveEquipment === item ? styles.filterActive : styles.filter} aria-pressed={effectiveEquipment === item} onClick={() => {
                  setEquipment(item);
                  updateExercisePickerUrl({ [EXERCISE_PICKER_URL_PARAMS.equipment]: item });
                }}>{equipmentLabel(item, uk)}</button>
              ))}
            </div>
            {results.length > 0 ? (
              <div className={styles.exerciseGrid}>
                {results.map((exercise) => {
                  const meta = exercisePickerMetadata(exercise);
                  const imageSrc = resolveExerciseImageSrc({ stableKey: exercise.stableKey, catalogName: exercise.name });
                  const isSelected = selectedId === exercise.id;
                  const equipmentList = meta?.equipment ?? ["other"];
                  return (
                    <button key={exercise.id} type="button" className={isSelected ? styles.exerciseCardSelected : styles.exerciseCard}
                      aria-pressed={isSelected} onClick={() => {
                        updateExercisePickerUrl({ [EXERCISE_PICKER_URL_PARAMS.movement]: exercise.stableKey ?? String(exercise.id) });
                        onSelect(exercise);
                      }}>
                      <span className={styles.exerciseImage}>
                        {imageSrc
                          ? <Image src={imageSrc} alt="" fill sizes="(max-width: 640px) 45vw, (max-width: 980px) 30vw, 18rem" unoptimized={process.env.NODE_ENV !== "production"} />
                          : <span className={styles.imagePlaceholder} aria-hidden="true"><span>＋</span></span>}
                        {isSelected && <span className={styles.selectedMark} aria-hidden="true">✓</span>}
                      </span>
                      <span className={styles.exerciseText}>
                        {meta?.subcategory && <span className={styles.subcategoryTag}>{subcategoryLabel(meta.subcategory, uk)}</span>}
                        <strong>{exercise.name}</strong>
                        <span className={styles.equipmentLine}>{equipmentList.map((item) => equipmentLabel(item, uk)).join(" · ")}</span>
                        <span className={styles.resistanceTag}>{resistanceDescription(exercise, uk)}</span>
                        {(meta?.noteUk || meta?.noteEn) && <span className={styles.movementNote}>{uk ? meta.noteUk : meta.noteEn}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={styles.empty} role="status">{uk ? "Нічого не знайдено. Змініть пошук або фільтр." : "No exercises found. Try another search or filter."}</div>
            )}
          </div>
        ) : (
          <div className={styles.content}>
            <div className={styles.categoryGrid}>
              {EXERCISE_PICKER_CATEGORIES.map((item) => (
                <button key={item.id} type="button" className={styles.categoryCard} onClick={() => {
                  setCategory(item.id);
                  setSubcategory("all");
                  setEquipment("all");
                  setSearch("");
                  updateExercisePickerUrl({
                    [EXERCISE_PICKER_URL_PARAMS.category]: item.id,
                    [EXERCISE_PICKER_URL_PARAMS.subcategory]: "all",
                    [EXERCISE_PICKER_URL_PARAMS.equipment]: "all",
                    [EXERCISE_PICKER_URL_PARAMS.search]: null,
                  });
                }}>
                  <span className={styles.categoryImage}><Image src={item.imageSrc} alt="" fill sizes="(max-width: 640px) 42vw, (max-width: 980px) 28vw, 16rem" unoptimized={process.env.NODE_ENV !== "production"} /></span>
                  <span className={styles.categoryText}>
                    <strong>{uk ? item.nameUk : item.nameEn}</strong>
                    <span>{uk ? `${categoryCounts.get(item.id) ?? 0} вправ` : `${categoryCounts.get(item.id) ?? 0} exercises`}</span>
                  </span>
                  <span className={styles.categoryArrow} aria-hidden="true">→</span>
                </button>
              ))}
              <button type="button" className={`${styles.categoryCard} ${styles.allCategoryCard}`} onClick={() => {
                setCategory("all");
                setSubcategory("all");
                setEquipment("all");
                setSearch("");
                updateExercisePickerUrl({
                  [EXERCISE_PICKER_URL_PARAMS.category]: "all",
                  [EXERCISE_PICKER_URL_PARAMS.subcategory]: "all",
                  [EXERCISE_PICKER_URL_PARAMS.equipment]: "all",
                  [EXERCISE_PICKER_URL_PARAMS.search]: null,
                });
              }}>
                <span className={styles.allIcon} aria-hidden="true"><i /><i /><i /><i /></span>
                <span className={styles.categoryText}>
                  <strong>{uk ? "Усі вправи" : "All exercises"}</strong>
                  <span>{uk ? `${exercises.length} доступно` : `${exercises.length} available`}</span>
                </span>
                <span className={styles.categoryArrow} aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        )}

        <footer className={styles.footer}>
          {selected && <p className={styles.selectedSummary}><span>{uk ? "Обрано" : "Selected"}</span><strong>{selected.name}</strong></p>}
          {footerContent && <div className={styles.footerContent}>{footerContent}</div>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>{uk ? "Скасувати" : "Cancel"}</button>
            <button type="button" className={styles.confirmButton} disabled={!selected || busy || loading} onClick={onConfirm}>{busy ? (uk ? "Додавання…" : "Adding…") : confirmLabel}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
