import { useSyncExternalStore } from "react";

export const EXERCISE_PICKER_URL_PARAMS = {
  open: "exercisePicker",
  category: "exercisePickerCategory",
  subcategory: "exercisePickerSubcategory",
  equipment: "exercisePickerEquipment",
  search: "exercisePickerSearch",
  movement: "exercisePickerMovement",
} as const;

export type ExercisePickerUrlParam = typeof EXERCISE_PICKER_URL_PARAMS[keyof typeof EXERCISE_PICKER_URL_PARAMS];
export type ExercisePickerUrlPatch = Partial<Record<ExercisePickerUrlParam, string | null>>;

const PICKER_URL_CHANGE_EVENT = "bodycast:exercise-picker-url-change";

function subscribeToPickerUrl(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(PICKER_URL_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(PICKER_URL_CHANGE_EVENT, onChange);
  };
}

function readPickerOpenFromUrl(): boolean {
  return new URL(window.location.href).searchParams.get(EXERCISE_PICKER_URL_PARAMS.open) === "1";
}

export function useExercisePickerOpenFromUrl(): boolean {
  return useSyncExternalStore(subscribeToPickerUrl, readPickerOpenFromUrl, () => false);
}

export function openExercisePickerUrl(): void {
  if (typeof window === "undefined") return;
  const params = new URL(window.location.href).searchParams;
  updateExercisePickerUrl({
    [EXERCISE_PICKER_URL_PARAMS.open]: "1",
    [EXERCISE_PICKER_URL_PARAMS.category]: params.get(EXERCISE_PICKER_URL_PARAMS.category) ?? "categories",
    [EXERCISE_PICKER_URL_PARAMS.subcategory]: params.get(EXERCISE_PICKER_URL_PARAMS.subcategory) ?? "all",
    [EXERCISE_PICKER_URL_PARAMS.equipment]: params.get(EXERCISE_PICKER_URL_PARAMS.equipment) ?? "all",
  });
}

export function ensureExercisePickerUrlDefaults(): void {
  if (typeof window === "undefined") return;
  const params = new URL(window.location.href).searchParams;
  if (params.get(EXERCISE_PICKER_URL_PARAMS.open) !== "1") return;

  const patch: ExercisePickerUrlPatch = {};
  if (!params.has(EXERCISE_PICKER_URL_PARAMS.category)) patch[EXERCISE_PICKER_URL_PARAMS.category] = "categories";
  if (!params.has(EXERCISE_PICKER_URL_PARAMS.subcategory)) patch[EXERCISE_PICKER_URL_PARAMS.subcategory] = "all";
  if (!params.has(EXERCISE_PICKER_URL_PARAMS.equipment)) patch[EXERCISE_PICKER_URL_PARAMS.equipment] = "all";
  if (Object.keys(patch).length > 0) updateExercisePickerUrl(patch);
}

export function updateExercisePickerUrl(patch: ExercisePickerUrlPatch): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
  window.dispatchEvent(new Event(PICKER_URL_CHANGE_EVENT));
}

export function resolveExercisePickerMovement<T extends { id: number; stableKey: string | null }>(
  exercises: readonly T[],
  value: string | null,
): T | null {
  if (!value) return null;
  return exercises.find((exercise) => exercise.stableKey === value)
    ?? exercises.find((exercise) => String(exercise.id) === value)
    ?? null;
}
