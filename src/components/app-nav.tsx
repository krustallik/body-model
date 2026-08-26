"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/i18n-provider";
import styles from "./app-nav.module.css";

export function AppNav({ active }: { active: "dashboard" | "history" | "forecast" | "goal" | "diagnostics" | "profile" }) {
  const { locale } = useI18n();
  const labels = locale === "uk"
    ? { dashboard: "Огляд", history: "Історія", forecast: "Прогноз", goal: "Ціль", diagnostics: "Стан моделі", profile: "Профіль", aria: "Основна навігація" }
    : { dashboard: "Dashboard", history: "History", forecast: "Forecast", goal: "Goal", diagnostics: "Model status", profile: "Profile", aria: "Primary navigation" };
  return (
    <nav className={styles.nav} aria-label={labels.aria}>
      <Link className={active === "dashboard" ? styles.active : undefined} href="/dashboard">{labels.dashboard}</Link>
      <Link className={active === "history" ? styles.active : undefined} href="/history">{labels.history}</Link>
      <Link className={active === "forecast" ? styles.active : undefined} href="/forecast">{labels.forecast}</Link>
      <Link className={active === "goal" ? styles.active : undefined} href="/goal">{labels.goal}</Link>
      <Link className={active === "diagnostics" ? styles.active : undefined} href="/diagnostics">{labels.diagnostics}</Link>
      <Link className={active === "profile" ? styles.active : undefined} href="/settings/profile">{labels.profile}</Link>
    </nav>
  );
}
