import { HelpTip } from "@/components/help-tip";

export type ModelStateSource = "deterministic" | "recovered" | "bootstrap" | "degraded" | "awaiting" | "degenerate";

const copy = {
  uk: {
    deterministic: ["Послідовний розрахунок", "Стан порахований день за днем із доступної історії без критичного пропуску. Інші типи оцінки можливі, якщо історія неповна або стан відновлюється після пропуску."],
    recovered: ["Стан відновлено", "Стан відновлено після пропуску в історії."],
    bootstrap: ["Стартова оцінка", "Стартова оцінка побудована за короткою історією та доступними даними профілю."],
    degraded: ["Орієнтовна оцінка", "Орієнтовна оцінка через неповні або неузгоджені дані."],
    awaiting: ["Очікуємо дані", "Даних поки недостатньо для повної оцінки."],
    degenerate: ["Ненадійний поточний стан", "Поточний стан моделі недостатньо надійний для звичайної оцінки."],
  },
  en: {
    deterministic: ["Sequential calculation", "The state was calculated day by day from available history without a critical gap. Other estimate types can appear when history is incomplete or the state is recovered after a gap."],
    recovered: ["State recovered", "The state was recovered after a gap in history."],
    bootstrap: ["Starting estimate", "The starting estimate uses a short history and available profile data."],
    degraded: ["Approximate estimate", "This estimate is approximate because some data is missing or inconsistent."],
    awaiting: ["Waiting for data", "There is not enough data yet for a complete estimate."],
    degenerate: ["Unreliable current state", "The model’s current state is not reliable enough for a regular estimate."],
  },
} as const;

export function ModelStateSource({ value, uk }: { value: ModelStateSource; uk: boolean }) {
  const [label, explanation] = copy[uk ? "uk" : "en"][value];
  return <span>{label}<HelpTip label={uk ? `Пояснення: ${label}` : `Explanation: ${label}`}>{explanation}</HelpTip></span>;
}
