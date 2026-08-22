"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import type { DailyMetricField } from "@/modules/days/day.types";
import type { DashboardDto } from "@/modules/days/dashboard.types";
import { formatDateTime, formatMetric } from "@/modules/days/metric-format";
import styles from "./dashboard.module.css";

const metricCards: Array<{ key: DailyMetricField; label: string; unit?: string }> = [
  { key: "weightKg", label: "Weight", unit: "kg" },
  { key: "bodyFatPercent", label: "Body Fat", unit: "%" },
  { key: "caloriesKcal", label: "Calories", unit: "kcal" },
  { key: "proteinG", label: "Protein", unit: "g" },
  { key: "fatG", label: "Fat", unit: "g" },
  { key: "carbsG", label: "Carbs", unit: "g" },
  { key: "steps", label: "Steps" },
  { key: "walkingDistanceKm", label: "Walking Distance", unit: "km" },
  { key: "averageWalkingSpeedKmh", label: "Average Walking Speed", unit: "km/h" },
  { key: "strengthTrainingMinutes", label: "Strength Training", unit: "min" },
];

function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function emptyDashboard(): DashboardDto {
  return { today: null, recentDays: [], hasToday: false, lastSync: { at: null, status: null } };
}

async function loadDashboard(): Promise<DashboardDto> {
  const response = await fetch(`/api/v1/dashboard?date=${localToday()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load dashboard (${response.status})`);
  return response.json() as Promise<DashboardDto>;
}

export function DashboardClient() {
  const [dashboard, setDashboard] = useState<DashboardDto>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadDashboard()
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load dashboard");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <LinkBrand />
        <AppNav active="dashboard" />
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Today · {localToday()}</p>
          <h1>Your daily snapshot</h1>
          <p>A clear view of today’s health data and the previous seven records.</p>
        </div>
        <div className={`${styles.todayBadge} ${dashboard.hasToday ? styles.ready : styles.waiting}`}>
          <span aria-hidden="true" />
          {loading ? "Checking today…" : dashboard.hasToday ? "Today is synced" : "No record for today"}
        </div>
      </section>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <section className={styles.metricGrid} aria-busy={loading}>
        {metricCards.map(({ key, label, unit }) => {
          const value = dashboard.today?.[key] ?? null;
          return (
            <article className={styles.metricCard} key={key}>
              <p>{label}</p>
              <strong>{formatMetric(value)}</strong>
              <span>{value === null ? "No data" : unit ?? "today"}</span>
            </article>
          );
        })}
      </section>

      <section className={styles.lowerGrid}>
        <article className={styles.syncCard}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Data freshness</p>
              <h2>Sync status</h2>
            </div>
          </div>
          <dl>
            <div><dt>Latest data update</dt><dd>{formatDateTime(dashboard.lastSync.at)}</dd></div>
            <div><dt>Today’s record</dt><dd>{dashboard.hasToday ? "Available" : "Missing"}</dd></div>
            <div><dt>Today updatedAt</dt><dd>{formatDateTime(dashboard.today?.updatedAt ?? null)}</dd></div>
            <div><dt>Sync event status</dt><dd>{dashboard.lastSync.status ?? "Not tracked"}</dd></div>
          </dl>
          <p className={styles.syncNote}>Dedicated sync events are not stored yet; latest update uses daily metrics timestamps.</p>
        </article>

        <article className={styles.historyCard}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Recent records</p>
              <h2>Last 7 days</h2>
            </div>
          </div>
          {dashboard.recentDays.length === 0 ? (
            <div className={styles.emptyHistory}>No recent daily metrics.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>date</th><th>weight</th><th>calories</th><th>protein</th><th>steps</th><th>strength</th></tr></thead>
                <tbody>
                  {dashboard.recentDays.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{formatMetric(day.weightKg)}</td>
                      <td>{formatMetric(day.caloriesKcal)}</td>
                      <td>{formatMetric(day.proteinG)}</td>
                      <td>{formatMetric(day.steps)}</td>
                      <td>{formatMetric(day.strengthTrainingMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

function LinkBrand() {
  return <Link className={styles.brand} href="/dashboard">BodyCast<span>Health console</span></Link>;
}
