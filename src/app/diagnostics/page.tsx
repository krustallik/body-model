import type { Metadata } from "next";
import { DiagnosticsClient } from "./diagnostics-client";

export const metadata: Metadata = {
  title: "Стан моделі · BodyCast",
  description: "Перевіряйте безперервність даних, персоналізацію, відновлення та готовність прогнозу.",
};

export default function DiagnosticsPage() {
  return <DiagnosticsClient />;
}
