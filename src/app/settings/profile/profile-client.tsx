"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { useI18n, type Locale } from "@/i18n/i18n-provider";
import type { ProfileDto } from "@/modules/profile/profile.types";
import styles from "./profile.module.css";

type ProfileField = "locale" | "sex" | "dateOfBirth" | "heightCm" | "targetWeightKg" | "targetDate";
type FormValues = Record<ProfileField, string>;
type FieldErrors = Partial<Record<ProfileField, string>>;

const emptyForm: FormValues = {
  locale: "uk",
  sex: "",
  dateOfBirth: "",
  heightCm: "",
  targetWeightKg: "",
  targetDate: "",
};

function formFromProfile(profile: ProfileDto): FormValues {
  return {
    locale: profile.locale,
    sex: profile.sex,
    dateOfBirth: profile.dateOfBirth,
    heightCm: String(profile.heightCm),
    targetWeightKg: profile.targetWeightKg === null ? "" : String(profile.targetWeightKg),
    targetDate: profile.targetDate ?? "",
  };
}

async function readError(response: Response, uk = false): Promise<{ message: string; fields: FieldErrors }> {
  const fallback = uk ? `Помилка запиту (${response.status})` : `Request failed (${response.status})`;
  try {
    const body = await response.json() as {
      error?: string;
      details?: Array<{ path?: Array<string | number>; message?: string }>;
    };
    const fields: FieldErrors = {};
    for (const detail of body.details ?? []) {
      const field = detail.path?.[0];
      if (typeof field === "string" && field in emptyForm && detail.message) {
        fields[field as ProfileField] = uk ? "Перевірте значення цього поля." : detail.message;
      }
    }
    return { message: uk && body.details?.length ? "Перевірте дані профілю." : body.details?.[0]?.message ?? body.error ?? fallback, fields };
  } catch {
    return { message: fallback, fields: {} };
  }
}

export function ProfileClient() {
  const { locale, setLocale } = useI18n();
  const uk = locale === "uk";
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await readError(response, document.documentElement.lang === "uk")).message);
        return response.json() as Promise<{ profile: ProfileDto | null }>;
      })
      .then((body) => {
        if (active) setValues(body.profile ? formFromProfile(body.profile) : emptyForm);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load profile");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateField(field: ProfileField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === "locale") setLocale(value as Locale);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);

    try {
      const response = await fetch("/api/v1/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const issue = await readError(response, uk);
        setFieldErrors(issue.fields);
        throw new Error(issue.message);
      }
      const body = await response.json() as { profile: ProfileDto };
      setValues(formFromProfile(body.profile));
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : uk ? "Не вдалося зберегти профіль" : "Unable to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/dashboard">
          BodyCast
          <span>{uk ? "Простір здоров’я" : "Health workspace"}</span>
        </Link>
        <AppNav active="profile" />
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>{uk ? "Налаштування" : "Settings"}</p>
        <h1>{uk ? "Ваш профіль." : "Your profile."}</h1>
        <p>{uk ? "Збережіть основні персональні дані, мову інтерфейсу та необов’язкову ціль ваги для моделей BodyCast." : "Keep the basic personal inputs, interface language, and optional weight goal that BodyCast models will use."}</p>
      </section>

      <section className={styles.card} aria-labelledby="profile-form-title">
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.eyebrow}>{uk ? "Персональні дані" : "Personal inputs"}</p>
            <h2 id="profile-form-title">{uk ? "Профіль і ціль" : "Profile & goal"}</h2>
          </div>
          <p>{uk ? "Обов’язкові поля позначені *" : "Required fields are marked with *"}</p>
        </div>

        {loading ? (
          <div className={styles.loading}>{uk ? "Завантаження профілю…" : "Loading profile…"}</div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>{uk ? "Мова інтерфейсу *" : "Interface language *"}</span>
                <select value={values.locale} onChange={(event) => updateField("locale", event.target.value)}>
                  <option value="uk">Українська</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>{uk ? "Стать *" : "Sex *"}</span>
                <select
                  value={values.sex}
                  onChange={(event) => updateField("sex", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.sex)}
                >
                  <option value="">{uk ? "Оберіть" : "Select"}</option>
                  <option value="male">{uk ? "Чоловіча" : "Male"}</option>
                  <option value="female">{uk ? "Жіноча" : "Female"}</option>
                </select>
                {fieldErrors.sex && <small role="alert">{fieldErrors.sex}</small>}
              </label>

              <label className={styles.field}>
                <span>{uk ? "Дата народження *" : "Date of birth *"}</span>
                <input
                  type="date"
                  value={values.dateOfBirth}
                  onChange={(event) => updateField("dateOfBirth", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.dateOfBirth)}
                />
                {fieldErrors.dateOfBirth && <small role="alert">{fieldErrors.dateOfBirth}</small>}
              </label>

              <label className={styles.field}>
                <span>{uk ? "Зріст *" : "Height *"}</span>
                <div className={styles.unitInput}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={values.heightCm}
                    onChange={(event) => updateField("heightCm", event.target.value)}
                    placeholder="180"
                    aria-invalid={Boolean(fieldErrors.heightCm)}
                  />
                  <span>cm</span>
                </div>
                {fieldErrors.heightCm && <small role="alert">{fieldErrors.heightCm}</small>}
              </label>

              <label className={styles.field}>
                <span>{uk ? "Цільова вага" : "Target weight"}</span>
                <div className={styles.unitInput}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={values.targetWeightKg}
                    onChange={(event) => updateField("targetWeightKg", event.target.value)}
                    placeholder="81,4"
                    aria-invalid={Boolean(fieldErrors.targetWeightKg)}
                  />
                  <span>kg</span>
                </div>
                {fieldErrors.targetWeightKg && <small role="alert">{fieldErrors.targetWeightKg}</small>}
              </label>

              <label className={styles.field}>
                <span>{uk ? "Цільова дата" : "Target date"}</span>
                <input
                  type="date"
                  value={values.targetDate}
                  onChange={(event) => updateField("targetDate", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.targetDate)}
                />
                {fieldErrors.targetDate && <small role="alert">{fieldErrors.targetDate}</small>}
              </label>
            </div>

            <div className={styles.actions}>
              <button type="submit" disabled={saving}>{saving ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти" : "Save")}</button>
              {saved && <p className={styles.success} role="status">{uk ? "Профіль збережено." : "Profile saved."}</p>}
              {error && <p className={styles.error} role="alert">{error}</p>}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
