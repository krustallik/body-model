import type { Locale } from "@/i18n/i18n-provider";
import type { PhysiologyDayResultV7 } from "@/model/physiology-v7/daily-runtime-v7";

export type ProvenanceTone = "observed" | "estimated" | "carried" | "unavailable" | "info";

export type ProvenanceChip = {
  key: string;
  tone: ProvenanceTone;
  label: string;
  detail: string;
};

export type WorkoutEnergyProvenanceKind = "device-estimate" | "shadow-diary-estimate" | "unavailable";

type WorkoutScenarioPlan = {
  strengthDaysPerWeek: number;
  strengthTrainingMinutes: number;
  otherTrainingDaysPerWeek: number;
  otherTrainingMinutes: number;
};

/** Device active kcal is an estimate when present; null is unavailable, never zero. */
export function workoutEnergyProvenanceKind(
  activeEnergyKcal: number | null | undefined,
): WorkoutEnergyProvenanceKind {
  return activeEnergyKcal !== null && activeEnergyKcal !== undefined && activeEnergyKcal > 0
    ? "device-estimate"
    : "unavailable";
}

export function workoutEnergyProvenanceChip(
  activeEnergyKcal: number | null | undefined,
  locale: Locale = "en",
  source?: WorkoutEnergyProvenanceKind,
): ProvenanceChip {
  const uk = locale === "uk";
  const kind = source ?? workoutEnergyProvenanceKind(activeEnergyKcal);
  if (kind === "shadow-diary-estimate") {
    return {
      key: "workout-energy",
      tone: "estimated",
      label: uk ? "Shadow-оцінка щоденника" : "Diary shadow estimate",
      detail: uk
        ? "Оцінка активних ккал з даних щоденника; Garmin-тренування для цієї сесії не синхронізовано."
        : "Active-kcal estimate from diary evidence; no Garmin workout is synced for this session.",
    };
  }
  if (kind === "device-estimate") {
    return {
      key: "workout-energy",
      tone: "observed",
      label: uk ? "Оцінка пристрою" : "Device estimate",
      detail: uk
        ? "Garmin/пристрій передав active kcal. Це оцінка, не лабораторна істина."
        : "Garmin/device reported active kcal. This is an estimate, not lab truth.",
    };
  }
  return {
    key: "workout-energy",
    tone: "unavailable",
    label: uk ? "Енергія недоступна" : "Energy unavailable",
    detail: uk
      ? "Active kcal відсутні. Це не 0 ккал і не привід вигадувати витрату."
      : "Active kcal are missing. That is not 0 kcal and must not invent burn.",
  };
}

export function workoutFeedProvenanceChip(
  workoutFeedObserved: boolean | null | undefined,
  locale: Locale = "en",
): ProvenanceChip | null {
  const uk = locale === "uk";
  if (workoutFeedObserved === true) {
    return {
      key: "workout-feed",
      tone: "observed",
      label: uk ? "Стрічка тренувань є" : "Workout feed observed",
      detail: uk
        ? "Синхронізовано на цей день. Порожня стрічка може означати відпочинок."
        : "Synced for this day. An empty feed can mean a rest day.",
    };
  }
  if (workoutFeedObserved === false) {
    return {
      key: "workout-feed",
      tone: "unavailable",
      label: uk ? "Стрічка тренувань відсутня" : "Workout feed missing",
      detail: uk
        ? "Відсутня стрічка ≠ день відпочинку. Активність може бути невідомою."
        : "Missing feed ≠ rest day. Activity may be unknown.",
    };
  }
  if (workoutFeedObserved === null) {
    return {
      key: "workout-feed",
      tone: "info",
      label: uk ? "Стрічка невідома" : "Workout feed unknown",
      detail: uk
        ? "Старі записи без покриття стрічки. Не трактуйте відсутність як 0."
        : "Legacy rows lack feed coverage. Do not treat absence as zero.",
    };
  }
  return null;
}

export function dataQualityChip(
  dataQuality: string | null | undefined,
  locale: Locale = "en",
): ProvenanceChip | null {
  const uk = locale === "uk";
  switch (dataQuality) {
    case "observed":
      return {
        key: "data-quality",
        tone: "observed",
        label: uk ? "Спостережено" : "Observed",
        detail: uk ? "День зібраний з доступних вимірювань." : "Day assembled from available measurements.",
      };
    case "estimated":
      return {
        key: "data-quality",
        tone: "estimated",
        label: uk ? "Оцінено" : "Estimated",
        detail: uk
          ? "Частину полів оцінено (наприклад, bridged nutrition). Це не пряме вимірювання."
          : "Some fields were estimated (for example bridged nutrition). Not a direct measurement.",
      };
    case "incomplete":
      return {
        key: "data-quality",
        tone: "unavailable",
        label: uk ? "Неповні дані" : "Incomplete",
        detail: uk
          ? "Бракує полів для повного переходу. Незаповнене ≠ 0."
          : "Fields needed for a full transition are missing. Missing ≠ 0.",
      };
    case "blocked":
      return {
        key: "data-quality",
        tone: "unavailable",
        label: uk ? "Заблоковано" : "Blocked",
        detail: uk ? "День не пройшов повний фізіологічний розрахунок." : "Day did not complete a full physiological calculation.",
      };
    default:
      return null;
  }
}

export function nutritionSourceChip(
  nutritionSource: string | null | undefined,
  locale: Locale = "en",
): ProvenanceChip | null {
  const uk = locale === "uk";
  switch (nutritionSource) {
    case "observed":
      return {
        key: "nutrition",
        tone: "observed",
        label: uk ? "Харчування спостережене" : "Nutrition observed",
        detail: uk ? "Калорії/макроси з записів дня." : "Calories/macros from the day’s records.",
      };
    case "imputed-local":
    case "imputed-fallback":
      return {
        key: "nutrition",
        tone: "estimated",
        label: uk ? "Харчування оцінене" : "Nutrition estimated",
        detail: uk
          ? "Прогалину заповнено оцінкою. Це не спостережені макроси."
          : "A gap was filled by estimation. These are not observed macros.",
      };
    case "missing":
      return {
        key: "nutrition",
        tone: "unavailable",
        label: uk ? "Харчування недоступне" : "Nutrition unavailable",
        detail: uk ? "Макроси відсутні. Відсутність ≠ нульове харчування." : "Macros are missing. Absence ≠ zero intake.",
      };
    default:
      return null;
  }
}

type CompartmentView = {
  availability: "available" | "unavailable";
  transitionStatus?: string;
  provenance?: string | null;
};

function compartmentChip(
  key: string,
  labelObserved: string,
  labelCarried: string,
  labelUnavailable: string,
  compartment: CompartmentView | null | undefined,
  locale: Locale,
): ProvenanceChip {
  const uk = locale === "uk";
  if (!compartment || compartment.availability === "unavailable"
      || compartment.transitionStatus === "unavailable") {
    return {
      key,
      tone: "unavailable",
      label: labelUnavailable,
      detail: uk
        ? "Недоступно ≠ 0. Значення не підставляється нулем."
        : "Unavailable ≠ 0. The value is not replaced with zero.",
    };
  }
  if (compartment.transitionStatus === "carried-forward"
      || compartment.provenance === "carried-forward-prior-state") {
    return {
      key,
      tone: "carried",
      label: labelCarried,
      detail: uk
        ? "Перенесено з попереднього стану. Це не нове вимірювання «без змін»."
        : "Carried from prior state. That is not a new “measured unchanged” observation.",
    };
  }
  return {
    key,
    tone: "observed",
    label: labelObserved,
    detail: uk ? "Числове значення доступне в v7 стані." : "A numeric value is available in v7 state.",
  };
}

/** Qualitative v7 compartment status for UI only; never invents physiology. */
export function physiologyV7CompartmentChips(
  result: PhysiologyDayResultV7 | null | undefined,
  locale: Locale = "en",
): ProvenanceChip[] {
  const uk = locale === "uk";
  const compartments = result?.resultingState.compartments;
  return [
    compartmentChip(
      "skeletal-muscle",
      uk ? "М’язи скелета: числові" : "Skeletal muscle: numeric",
      uk ? "М’язи скелета: перенесені" : "Skeletal muscle: carried",
      uk ? "М’язи скелета: недоступні" : "Skeletal muscle: unavailable",
      compartments?.skeletalMuscleKg,
      locale,
    ),
    compartmentChip(
      "glycogen",
      uk ? "Глікоген: числовий" : "Glycogen: numeric",
      uk ? "Глікоген: перенесений" : "Glycogen: carried",
      uk ? "Глікоген: недоступний" : "Glycogen: unavailable",
      compartments?.glycogenKg,
      locale,
    ),
    compartmentChip(
      "glycogen-water",
      uk ? "Вода глікогену: числова" : "Glycogen water: numeric",
      uk ? "Вода глікогену: перенесена" : "Glycogen water: carried",
      uk ? "Вода глікогену: недоступна" : "Glycogen water: unavailable",
      compartments?.glycogenWaterKg,
      locale,
    ),
  ];
}

export function physiologyV7CacheChip(
  status: "current" | "stale" | "missing" | null | undefined,
  locale: Locale = "en",
): ProvenanceChip {
  const uk = locale === "uk";
  if (status === "current") {
    return {
      key: "v7-cache",
      tone: "observed",
      label: uk ? "v7: актуальний" : "v7: current",
      detail: uk
        ? "Кеш v7 сумісний із поточними версіями. Це не виробничий прогноз TDEE."
        : "v7 cache matches current versions. This is not production TDEE/forecast truth.",
    };
  }
  if (status === "stale") {
    return {
      key: "v7-cache",
      tone: "estimated",
      label: uk ? "v7: застарілий" : "v7: stale",
      detail: uk
        ? "Кеш v7 потребує оновлення після змін джерел."
        : "v7 cache needs refresh after source changes.",
    };
  }
  return {
    key: "v7-cache",
    tone: "unavailable",
    label: uk ? "v7: немає результату" : "v7: missing",
    detail: uk
      ? "Немає збереженого v7 дня. Відсутність ≠ нульові компартменти."
      : "No persisted v7 day. Missing ≠ zero compartments.",
  };
}

/** Production forecast uses Hall lean/glycogen scalars — explain qualitative limits. */
export function forecastMetricSemanticsNotes(locale: Locale = "en"): string[] {
  const uk = locale === "uk";
  return [
    uk
      ? "«М’язи й інше без жиру» — агрегатний lean Hall/Forbes, не окремий скелетний м’яз."
      : "“Lean (non-fat) mass” is Hall/Forbes aggregate lean, not separate skeletal muscle.",
    uk
      ? "Скелетний м’яз у v7 лишається недоступним або перенесеним, доки немає окремого переходу."
      : "v7 skeletal muscle stays unavailable or carried until a separate transition exists.",
    uk
      ? "«Запаси вуглеводів + вода» якісні: якщо глікоген недоступний, це не 0 кг."
      : "“Carb stores + water” is qualitative: unavailable glycogen is not 0 kg.",
    uk
      ? "Тіньова модель жиру/ваги не показується як виробнича істина."
      : "Fat/weight shadow is not shown as production truth.",
  ];
}

export function forecastWorkoutScenarioNotes(
  mode: "recent-behavior" | "fixed" | "target-centered",
  plan: WorkoutScenarioPlan,
  locale: Locale = "en",
): string[] {
  const uk = locale === "uk";
  if (mode === "recent-behavior") {
    return [
      uk
        ? "Сценарій повторює недавні дні: тренування беруться з історії як події, а не як «хв = відпочинок»."
        : "Recent-behavior resamples history days: workouts come from events, not “minutes = rest”.",
      uk
        ? "Дні без стрічки тренувань не вважаються відпочинком і не стають донорами."
        : "Days without workout-feed coverage are not treated as rest and are not donors.",
    ];
  }
  const notes: string[] = [];
  if (plan.strengthDaysPerWeek > 0 && plan.strengthTrainingMinutes > 0) {
    notes.push(uk
      ? "Силові сесії в сценарії — канонічні workout events; без device kcal використовується лише MET fallback для сили."
      : "Strength sessions are canonical workout events; without device kcal only strength MET fallback applies.");
  }
  if (plan.otherTrainingDaysPerWeek > 0 && plan.otherTrainingMinutes > 0) {
    notes.push(uk
      ? "Степер/інше — окремі Stair Climbing events; без active kcal внесок 0 (не вигаданий MET)."
      : "Stepper/other are separate Stair Climbing events; without active kcal contribution is 0 (no invented MET).");
  }
  if (notes.length === 0) {
    notes.push(uk
      ? "Тренування в плані не заплановані; харчування/ходьба лишаються окремими входами."
      : "No training is scheduled in the plan; nutrition/walking stay separate inputs.");
  }
  notes.push(uk
    ? "Зміна лише частоти тренувань не змінює харчування й базову ходьбу сценарію."
    : "Changing only workout frequency does not change scenario nutrition or baseline walking.");
  return notes;
}

export function productionForecastCompartmentNotes(locale: Locale = "en"): ProvenanceChip[] {
  const uk = locale === "uk";
  return [
    {
      key: "skeletal-muscle-production",
      tone: "unavailable",
      label: uk ? "Скелетний м’яз: не в прогнозі" : "Skeletal muscle: not in forecast",
      detail: uk
        ? "Виробничий прогноз не має окремого skeletalMuscleKg."
        : "Production forecast has no separate skeletalMuscleKg.",
    },
    {
      key: "glycogen-production",
      tone: "info",
      label: uk ? "Глікоген/вода: якісний статус" : "Glycogen/water: qualitative",
      detail: uk
        ? "Метрика «запаси + вода» походить від моделі глікогену; недоступне ≠ 0."
        : "“Stores + water” comes from the glycogen model; unavailable ≠ 0.",
    },
  ];
}
