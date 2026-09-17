"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import styles from "../training.module.css";

export default function ActiveSessionEntryPage() {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        const response = await fetch("/api/v1/training/sessions/active", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setMissing(true);
          return;
        }
        const body = await response.json() as { session: StrengthSessionDto | null };
        if (cancelled) return;
        if (body.session) {
          router.replace(`/training/sessions/${body.session.id}`);
          return;
        }
        setMissing(true);
      } catch {
        if (!cancelled) setMissing(true);
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className={styles.page}>
      <div className={styles.navRow}>
        <strong>BodyCast</strong>
        <AppNav active="training" />
      </div>
      {missing ? (
        <div className={styles.empty}>
          <strong>{uk ? "Немає активної сесії" : "No active session"}</strong>
          <Link className={styles.linkLike} href="/training">
            {uk ? "До тренувань" : "Back to training"}
          </Link>
        </div>
      ) : (
        <p className={styles.cardMeta}>{uk ? "Відкриваємо активну сесію…" : "Opening active session…"}</p>
      )}
    </main>
  );
}
