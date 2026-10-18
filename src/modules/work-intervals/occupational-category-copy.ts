import { OCCUPATIONAL_CATEGORIES, type OccupationalCategory } from "@/model/occupational-activity";

export type OccupationalCategoryCopy = { label: string; description: string };

const UK_COPY: Record<OccupationalCategory, OccupationalCategoryCopy> = {
  standingLight: {
    label: "Дуже легка стояча",
    description: "Переважно стояння або очікування, легкі рухи руками, мало перенесення предметів.",
  },
  manualLight: {
    label: "Легка ручна",
    description: "Пакування, сортування, розміщення легких речей або інколи легкі коробки.",
  },
  standingLightModerate: {
    label: "Активна легка ручна",
    description: "Часте поповнення запасів або безперервна легка робота всім тілом.",
  },
  manualModerate: {
    label: "Помірна ручна",
    description: "Повторне підіймання, штовхання чи тягнення помірно важких предметів.",
  },
};

export function occupationalCategoryCopy(
  category: OccupationalCategory,
  locale: "uk" | "en",
): OccupationalCategoryCopy {
  return locale === "uk" ? UK_COPY[category] : OCCUPATIONAL_CATEGORIES[category];
}
