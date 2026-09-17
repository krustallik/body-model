"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/i18n-provider";
import styles from "./app-nav.module.css";

type NavKey = "dashboard" | "history" | "training" | "forecast" | "goal" | "diagnostics" | "profile";

export function AppNav({ active }: { active: NavKey }) {
  const { locale } = useI18n();
  const labels = locale === "uk"
    ? { dashboard: "Огляд", history: "Історія", training: "Тренування", forecast: "Прогноз", goal: "Ціль", diagnostics: "Стан моделі", profile: "Профіль", aria: "Основна навігація" }
    : { dashboard: "Dashboard", history: "History", training: "Training", forecast: "Forecast", goal: "Goal", diagnostics: "Model status", profile: "Profile", aria: "Primary navigation" };

  const items: { key: NavKey; href: string; label: string }[] = [
    { key: "dashboard", href: "/dashboard", label: labels.dashboard },
    { key: "history", href: "/history", label: labels.history },
    { key: "training", href: "/training", label: labels.training },
    { key: "forecast", href: "/forecast", label: labels.forecast },
    { key: "goal", href: "/goal", label: labels.goal },
    { key: "diagnostics", href: "/diagnostics", label: labels.diagnostics },
    { key: "profile", href: "/settings/profile", label: labels.profile },
  ];

  return (
    <nav className={styles.nav} aria-label={labels.aria}>
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <Link
            key={item.key}
            className={isActive ? styles.active : undefined}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
