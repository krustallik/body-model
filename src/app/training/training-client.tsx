"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import type {
  StrengthSessionDto,
  StrengthSessionSummaryDto,
  TrainingProgramSummaryDto,
} from "@/modules/training/training.types";
import { MATCH_STATUS } from "@/modules/training/training.constants";
import {
  formatDateTime,
  formatDurationMinutes,
  matchStatusLabel,
  readApiError,
} from "./training-labels";
import styles from "./training.module.css";

export function TrainingClient() {
  const { locale, intlLocale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [active, setActive] = useState<StrengthSessionDto | null>(null);
  const [programs, setPrograms] = useState<TrainingProgramSummaryDto[]>([]);
  const [recent, setRecent] = useState<StrengthSessionSummaryDto[]>([]);
  const [attention, setAttention] = useState<StrengthSessionSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [activeRes, programsRes, recentRes, attentionRes] = await Promise.all([
        fetch("/api/v1/training/sessions/active", { cache: "no-store" }),
        fetch("/api/v1/training/programs", { cache: "no-store" }),
        fetch("/api/v1/training/sessions/recent?limit=12", { cache: "no-store" }),
        fetch("/api/v1/training/sessions/match-attention", { cache: "no-store" }),
      ]);
      if (!activeRes.ok || !programsRes.ok || !recentRes.ok || !attentionRes.ok) {
        setError(uk ? "Не вдалося завантажити тренування." : "Could not load training data.");
        return;
      }
      const activeBody = await activeRes.json() as { session: StrengthSessionDto | null };
      const programsBody = await programsRes.json() as { programs: TrainingProgramSummaryDto[] };
      const recentBody = await recentRes.json() as { sessions: StrengthSessionSummaryDto[] };
      const attentionBody = await attentionRes.json() as { sessions: StrengthSessionSummaryDto[] };
      setActive(activeBody.session);
      setPrograms(programsBody.programs);
      setRecent(recentBody.sessions);
      setAttention(attentionBody.sessions);
    } catch {
      setError(uk ? "Не вдалося завантажити тренування." : "Could not load training data.");
    } finally {
      setLoading(false);
    }
  }, [uk]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function startProgram(programId: number) {
    setBusyId(programId);
    setError(null);
    try {
      const response = await fetch("/api/v1/training/sessions/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId }),
      });
      if (response.status === 409) {
        const body = await response.json() as { activeSessionId?: number };
        if (body.activeSessionId) {
          router.push(`/training/sessions/${body.activeSessionId}`);
          return;
        }
      }
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const body = await response.json() as { session: StrengthSessionDto };
      router.push(`/training/sessions/${body.session.id}`);
    } catch {
      setError(uk ? "Не вдалося почати тренування." : "Could not start the session.");
    } finally {
      setBusyId(null);
    }
  }

  async function archiveProgram(programId: number) {
    if (!window.confirm(uk ? "Архівувати програму?" : "Archive this program?")) return;
    setBusyId(programId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/programs/${programId}/archive`, { method: "POST" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      await load();
    } catch {
      setError(uk ? "Не вдалося архівувати програму." : "Could not archive the program.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="training" />
      </div>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{uk ? "Щоденник сили" : "Strength diary"}</p>
          <h1>{uk ? "Тренування" : "Training"}</h1>
          <p className={styles.intro}>
            {uk
              ? "Програми, живі сесії та зіставлення з Garmin."
              : "Programs, live sessions, and Garmin matching."}
          </p>
        </div>
        <Link className={styles.primaryButton} href="/training/programs/new">
          {uk ? "Нова програма" : "New program"}
        </Link>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.stack}>
        <section className={styles.panel} aria-label={uk ? "Активна сесія" : "Active session"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Активна сесія" : "Active session"}</h2>
              <p>{uk ? "Продовжити або почати нове тренування" : "Resume or start a workout"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {loading ? (
              <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
            ) : active ? (
              <article className={styles.card}>
                <div className={styles.cardTop}>
                  <div>
                    <strong>{active.programName}</strong>
                    <p className={styles.cardMeta}>
                      {uk ? "Почато" : "Started"} {formatDateTime(active.webStartedAt, intlLocale)}
                    </p>
                  </div>
                  <span className={styles.badge}>{uk ? "Активна" : "Active"}</span>
                </div>
                <div className={styles.rowActions}>
                  <Link className={styles.primaryButton} href={`/training/sessions/${active.id}`}>
                    {uk ? "Продовжити" : "Resume"}
                  </Link>
                </div>
              </article>
            ) : (
              <div className={styles.empty}>
                <strong>{uk ? "Немає активної сесії" : "No active session"}</strong>
                <span>{uk ? "Оберіть програму нижче, щоб почати." : "Pick a program below to start."}</span>
              </div>
            )}
          </div>
        </section>

        <section className={styles.panel} aria-label={uk ? "Програми" : "Programs"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Програми" : "Programs"}</h2>
              <p>{uk ? "Створення, редагування та старт" : "Create, edit, and start"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {programs.length === 0 ? (
              <div className={styles.empty}>
                <strong>{uk ? "Поки немає програм" : "No programs yet"}</strong>
                <Link className={styles.linkLike} href="/training/programs/new">
                  {uk ? "Створити першу" : "Create the first one"}
                </Link>
              </div>
            ) : (
              <div className={styles.list}>
                {programs.map((program) => (
                  <article className={styles.card} key={program.id}>
                    <div className={styles.cardTop}>
                      <div>
                        <strong>{program.name}</strong>
                        <p className={styles.cardMeta}>
                          {uk
                            ? `${program.exerciseCount} вправ · версія ${program.currentVersionNumber ?? "—"}`
                            : `${program.exerciseCount} exercises · v${program.currentVersionNumber ?? "—"}`}
                        </p>
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        className={styles.primaryButton}
                        type="button"
                        disabled={busyId === program.id || Boolean(active)}
                        onClick={() => void startProgram(program.id)}
                      >
                        {uk ? "Почати" : "Start"}
                      </button>
                      <Link className={styles.secondaryButton} href={`/training/programs/${program.id}`}>
                        {uk ? "Редагувати" : "Edit"}
                      </Link>
                      <button
                        className={styles.textButton}
                        type="button"
                        disabled={busyId === program.id}
                        onClick={() => void archiveProgram(program.id)}
                      >
                        {uk ? "Архів" : "Archive"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={styles.panel} aria-label={uk ? "Увага до зіставлення" : "Match attention"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Увага до зіставлення" : "Match attention"}</h2>
              <p>{uk ? "Неоднозначні або довго очікують Garmin" : "Ambiguous or long-pending Garmin links"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {attention.length === 0 ? (
              <div className={styles.empty}>
                <span>{uk ? "Немає сесій, що потребують уваги." : "No sessions need attention."}</span>
              </div>
            ) : (
              <div className={styles.list}>
                {attention.map((session) => (
                  <article className={styles.card} key={session.id}>
                    <div className={styles.cardTop}>
                      <div>
                        <strong>{session.programName}</strong>
                        <p className={styles.cardMeta}>
                          {formatDateTime(session.webStartedAt, intlLocale)}
                          {" · "}
                          {formatDurationMinutes(session.webStartedAt, session.webEndedAt, intlLocale, uk)}
                        </p>
                      </div>
                      <span className={session.matchStatus === MATCH_STATUS.AMBIGUOUS ? styles.badgeWarn : styles.badgeMuted}>
                        {matchStatusLabel(session.matchStatus, uk)}
                      </span>
                    </div>
                    <Link className={styles.linkLike} href={`/training/sessions/${session.id}`}>
                      {uk ? "Відкрити" : "Open"}
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={styles.panel} aria-label={uk ? "Нещодавні силові сесії" : "Recent strength sessions"}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Нещодавні силові сесії" : "Recent strength sessions"}</h2>
              <p>{uk ? "Дата, програма, тривалість, зіставлення" : "Date, program, duration, match state"}</p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {recent.length === 0 ? (
              <div className={styles.empty}>
                <span>{uk ? "Ще немає завершених сесій." : "No sessions yet."}</span>
              </div>
            ) : (
              <div className={styles.list}>
                {recent.map((session) => (
                  <article className={styles.card} key={session.id}>
                    <div className={styles.cardTop}>
                      <div>
                        <strong>{session.programName}</strong>
                        <p className={styles.cardMeta}>
                          {formatDateTime(session.webStartedAt, intlLocale)}
                          {" · "}
                          {formatDurationMinutes(session.webStartedAt, session.webEndedAt, intlLocale, uk)}
                        </p>
                      </div>
                      <span className={
                        session.matchStatus === MATCH_STATUS.MATCHED ? styles.badge
                          : session.matchStatus === MATCH_STATUS.AMBIGUOUS ? styles.badgeWarn
                            : session.matchStatus === MATCH_STATUS.UNMATCHED ? styles.badgeDanger
                              : styles.badgeMuted
                      }>
                        {matchStatusLabel(session.matchStatus, uk)}
                      </span>
                    </div>
                    <Link className={styles.linkLike} href={`/training/sessions/${session.id}`}>
                      {uk ? "Деталі" : "Details"}
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
