"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import type { ProfileDto } from "@/modules/profile/profile.types";
import styles from "./profile.module.css";

type ProfileField = "sex" | "dateOfBirth" | "heightCm" | "targetWeightKg" | "targetDate";
type FormValues = Record<ProfileField, string>;
type FieldErrors = Partial<Record<ProfileField, string>>;

const emptyForm: FormValues = {
  sex: "",
  dateOfBirth: "",
  heightCm: "",
  targetWeightKg: "",
  targetDate: "",
};

function formFromProfile(profile: ProfileDto): FormValues {
  return {
    sex: profile.sex,
    dateOfBirth: profile.dateOfBirth,
    heightCm: String(profile.heightCm),
    targetWeightKg: profile.targetWeightKg === null ? "" : String(profile.targetWeightKg),
    targetDate: profile.targetDate ?? "",
  };
}

async function readError(response: Response): Promise<{ message: string; fields: FieldErrors }> {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = await response.json() as {
      error?: string;
      details?: Array<{ path?: Array<string | number>; message?: string }>;
    };
    const fields: FieldErrors = {};
    for (const detail of body.details ?? []) {
      const field = detail.path?.[0];
      if (typeof field === "string" && field in emptyForm && detail.message) {
        fields[field as ProfileField] = detail.message;
      }
    }
    return { message: body.details?.[0]?.message ?? body.error ?? fallback, fields };
  } catch {
    return { message: fallback, fields: {} };
  }
}

export function ProfileClient() {
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
        if (!response.ok) throw new Error((await readError(response)).message);
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
        const issue = await readError(response);
        setFieldErrors(issue.fields);
        throw new Error(issue.message);
      }
      const body = await response.json() as { profile: ProfileDto };
      setValues(formFromProfile(body.profile));
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/dashboard">
          BodyCast
          <span>Health workspace</span>
        </Link>
        <AppNav active="profile" />
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Settings</p>
        <h1>Your profile.</h1>
        <p>Keep the basic personal inputs and optional weight goal that future BodyCast models will use.</p>
      </section>

      <section className={styles.card} aria-labelledby="profile-form-title">
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.eyebrow}>Personal inputs</p>
            <h2 id="profile-form-title">Profile &amp; goal</h2>
          </div>
          <p>Required fields are marked with *</p>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading profile…</div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Sex *</span>
                <select
                  value={values.sex}
                  onChange={(event) => updateField("sex", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.sex)}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                {fieldErrors.sex && <small role="alert">{fieldErrors.sex}</small>}
              </label>

              <label className={styles.field}>
                <span>Date of birth *</span>
                <input
                  type="date"
                  value={values.dateOfBirth}
                  onChange={(event) => updateField("dateOfBirth", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.dateOfBirth)}
                />
                {fieldErrors.dateOfBirth && <small role="alert">{fieldErrors.dateOfBirth}</small>}
              </label>

              <label className={styles.field}>
                <span>Height *</span>
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
                <span>Target weight</span>
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
                <span>Target date</span>
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
              <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              {saved && <p className={styles.success} role="status">Profile saved.</p>}
              {error && <p className={styles.error} role="alert">{error}</p>}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
