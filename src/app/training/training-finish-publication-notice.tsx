"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { updateTrainingSearchParams, useTrainingSearchParam } from "./training-url-state";
import styles from "./training.module.css";

export function TrainingFinishPublicationNotice() {
  const { locale } = useI18n();
  const { value } = useTrainingSearchParam("finishPublication");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (value !== "stale" && value !== "unknown") return;
    // Retain the one-shot result after its URL marker is removed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotice(value === "stale"
      ? locale === "uk"
        ? "Тренування завершено. Публікація моделі ще оновлюється; похідні дані можуть тимчасово бути неактуальними."
        : "Workout finished. Model publication is still updating, so derived data may be temporarily stale."
      : locale === "uk"
        ? "Тренування завершено. Не вдалося підтвердити актуальність публікації моделі."
        : "Workout finished. Model publication currentness could not be confirmed.");
    updateTrainingSearchParams({ finishPublication: null }, true);
  }, [locale, value]);

  return notice ? <p className={styles.liveProgress} role="status" aria-live="polite">{notice}</p> : null;
}
