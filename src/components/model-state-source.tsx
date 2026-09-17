import { HelpTip } from "@/components/help-tip";

export type ModelStateSource = "deterministic" | "recovered" | "degraded" | "awaiting" | "degenerate";

const copy = {
  uk: {
    deterministic: ["прямий розрахунок", "Історія без критичного розриву: поточний стан послідовно розраховано зі збережених даних."],
    recovered: ["відновлена оцінка", "В історії був розрив. Модель оцінила стан після нього за даними до і після пропуску; даних вистачило для прийнятної оцінки."],
    degraded: ["наближена оцінка", "В історії був розрив, а спостережень навколо нього замало або вони недостатньо узгоджені. Модель відновила можливий стан, але впевненість нижча, тому прогноз позначено як обмежений."],
    awaiting: ["очікує даних", "Після розриву ще замало нових спостережень, щоб відновити поточний стан. Прогноз поки недоступний."],
    degenerate: ["ненадійна оцінка", "Спроба відновити стан після розриву не дала достатньо надійного результату. Потрібно доповнити історію або додати нові зважування."],
  },
  en: {
    deterministic: ["direct calculation", "There is no critical break in history, so the current state was calculated sequentially from saved data."],
    recovered: ["recovered estimate", "There was a break in history. The model estimated the state after it from data before and after the gap, with enough evidence for a usable estimate."],
    degraded: ["rough estimate", "There was a break in history and the observations around it are sparse or inconsistent. The model recovered a possible state with lower confidence, so the forecast is marked as limited."],
    awaiting: ["waiting for data", "There are not enough new observations after the gap to recover the current state. Forecasting is not available yet."],
    degenerate: ["unreliable estimate", "The recovery attempt after the gap did not produce a sufficiently reliable result. Complete the history or add new weigh-ins."],
  },
} as const;

export function ModelStateSource({ value, uk }: { value: ModelStateSource; uk: boolean }) {
  const [label, explanation] = copy[uk ? "uk" : "en"][value];
  return <span>{label}<HelpTip label={uk ? `Пояснення типу моделі: ${label}` : `Explain model type: ${label}`}>{explanation}</HelpTip></span>;
}
