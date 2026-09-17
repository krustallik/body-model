"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { useI18n } from "@/i18n/i18n-provider";
import { RESISTANCE, type ResistanceType } from "@/modules/training/training.constants";
import type { ExerciseCatalogDto, TrainingProgramDto } from "@/modules/training/training.types";
import { readApiError, resistanceLabel } from "./training-labels";
import styles from "./training.module.css";

type DraftExercise = {
  key: string;
  catalogId: number;
  catalogName: string;
  plannedSets: number;
  resistanceType: ResistanceType;
};

function newKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ProgramEditorClient({
  programId,
}: {
  programId?: number;
}) {
  const { locale } = useI18n();
  const uk = locale === "uk";
  const router = useRouter();
  const isEdit = programId !== undefined;

  const [name, setName] = useState("");
  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [catalog, setCatalog] = useState<ExerciseCatalogDto[]>([]);
  const [addCatalogId, setAddCatalogId] = useState<string>("");
  const [addPlannedSets, setAddPlannedSets] = useState("3");
  const [addResistance, setAddResistance] = useState<ResistanceType>(RESISTANCE.EXTERNAL_WEIGHT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const catalogRes = await fetch("/api/v1/training/exercises", { cache: "no-store" });
        if (!catalogRes.ok) {
          if (!cancelled) setError(await readApiError(catalogRes, uk));
          return;
        }
        const catalogBody = await catalogRes.json() as { exercises: ExerciseCatalogDto[] };
        if (!cancelled) {
          setCatalog(catalogBody.exercises);
          if (catalogBody.exercises[0]) setAddCatalogId(String(catalogBody.exercises[0].id));
        }

        if (programId !== undefined) {
          const programRes = await fetch(`/api/v1/training/programs/${programId}`, { cache: "no-store" });
          if (!programRes.ok) {
            if (!cancelled) setError(await readApiError(programRes, uk));
            return;
          }
          const programBody = await programRes.json() as { program: TrainingProgramDto };
          if (!cancelled) {
            setName(programBody.program.name);
            setExercises(programBody.program.exercises
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((exercise) => ({
                key: newKey(),
                catalogId: exercise.catalogId,
                catalogName: exercise.catalogName,
                plannedSets: exercise.plannedSets,
                resistanceType: exercise.resistanceType,
              })));
          }
        }
      } catch {
        if (!cancelled) setError(uk ? "Не вдалося завантажити редактор." : "Could not load the editor.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [programId, uk]);

  function addExercise() {
    const catalogId = Number(addCatalogId);
    const plannedSets = Number(addPlannedSets);
    const item = catalog.find((entry) => entry.id === catalogId);
    if (!item || !Number.isFinite(plannedSets) || plannedSets < 1) {
      setError(uk ? "Оберіть вправу та кількість підходів." : "Pick an exercise and planned sets.");
      return;
    }
    setExercises((current) => [
      ...current,
      {
        key: newKey(),
        catalogId: item.id,
        catalogName: item.name,
        plannedSets,
        resistanceType: addResistance,
      },
    ]);
    setError(null);
  }

  function moveExercise(index: number, direction: -1 | 1) {
    setExercises((current) => {
      const next = current.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return next;
    });
  }

  function removeExercise(index: number) {
    setExercises((current) => current.filter((_, i) => i !== index));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError(uk ? "Вкажіть назву програми." : "Enter a program name.");
      return;
    }
    if (exercises.length === 0) {
      setError(uk ? "Додайте хоча б одну вправу." : "Add at least one exercise.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      exercises: exercises.map((exercise, order) => ({
        catalogId: exercise.catalogId,
        plannedSets: exercise.plannedSets,
        resistanceType: exercise.resistanceType,
        order,
      })),
    };
    try {
      const response = await fetch(
        isEdit ? `/api/v1/training/programs/${programId}` : "/api/v1/training/programs",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      router.push("/training");
      router.refresh();
    } catch {
      setError(uk ? "Не вдалося зберегти програму." : "Could not save the program.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (programId === undefined) return;
    if (!window.confirm(uk ? "Архівувати програму?" : "Archive this program?")) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/programs/${programId}/archive`, { method: "POST" });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      router.push("/training");
      router.refresh();
    } catch {
      setError(uk ? "Не вдалося архівувати." : "Could not archive.");
    } finally {
      setSaving(false);
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
          <p className={styles.eyebrow}>{uk ? "Конструктор програм" : "Program builder"}</p>
          <h1>{isEdit ? (uk ? "Редагувати програму" : "Edit program") : (uk ? "Нова програма" : "New program")}</h1>
          <p className={styles.intro}>
            {uk
              ? "Вправи з каталогу API. Порядок — стрілками вгору/вниз."
              : "Exercises come from the catalog API. Reorder with up/down."}
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/training">{uk ? "Назад" : "Back"}</Link>
      </header>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      {loading ? (
        <p className={styles.cardMeta}>{uk ? "Завантаження…" : "Loading…"}</p>
      ) : (
        <form className={styles.panel} onSubmit={(event) => void onSubmit(event)}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{uk ? "Параметри" : "Details"}</h2>
              <p>{uk ? "Назва та склад програми" : "Name and exercise list"}</p>
            </div>
          </div>
          <div className={`${styles.panelBody} ${styles.formGrid}`}>
            <label className={styles.field}>
              <span>{uk ? "Назва" : "Name"}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} />
            </label>

            <div className={styles.exerciseEditor}>
              <strong>{uk ? "Вправи" : "Exercises"}</strong>
              {exercises.length === 0 ? (
                <div className={styles.empty}>
                  <span>{uk ? "Додайте вправи з каталогу нижче." : "Add exercises from the catalog below."}</span>
                </div>
              ) : exercises.map((exercise, index) => (
                <article className={styles.exerciseRow} key={exercise.key}>
                  <div className={styles.exerciseRowHeader}>
                    <strong>{exercise.catalogName}</strong>
                    <div className={styles.rowActions}>
                      <button className={styles.textButton} type="button" onClick={() => moveExercise(index, -1)} disabled={index === 0}>
                        ↑
                      </button>
                      <button className={styles.textButton} type="button" onClick={() => moveExercise(index, 1)} disabled={index === exercises.length - 1}>
                        ↓
                      </button>
                      <button className={styles.textButton} type="button" onClick={() => removeExercise(index)}>
                        {uk ? "Прибрати" : "Remove"}
                      </button>
                    </div>
                  </div>
                  <div className={styles.exerciseFields}>
                    <label className={styles.field}>
                      <span>{uk ? "Підходи" : "Planned sets"}</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={exercise.plannedSets}
                        onChange={(event) => {
                          const plannedSets = Number(event.target.value);
                          setExercises((current) => current.map((item, i) => (
                            i === index ? { ...item, plannedSets: Number.isFinite(plannedSets) ? plannedSets : item.plannedSets } : item
                          )));
                        }}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>{uk ? "Опір" : "Resistance"}</span>
                      <select
                        value={exercise.resistanceType}
                        onChange={(event) => {
                          const resistanceType = event.target.value as ResistanceType;
                          setExercises((current) => current.map((item, i) => (
                            i === index ? { ...item, resistanceType } : item
                          )));
                        }}
                      >
                        <option value={RESISTANCE.EXTERNAL_WEIGHT}>{resistanceLabel(RESISTANCE.EXTERNAL_WEIGHT, uk)}</option>
                        <option value={RESISTANCE.RESISTANCE_BAND}>{resistanceLabel(RESISTANCE.RESISTANCE_BAND, uk)}</option>
                        <option value={RESISTANCE.BODYWEIGHT}>{resistanceLabel(RESISTANCE.BODYWEIGHT, uk)}</option>
                      </select>
                    </label>
                  </div>
                </article>
              ))}

              <div className={styles.addExercise}>
                <label className={styles.field}>
                  <span>{uk ? "З каталогу" : "From catalog"}</span>
                  <select value={addCatalogId} onChange={(event) => setAddCatalogId(event.target.value)}>
                    {catalog.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{uk ? "Підходи" : "Sets"}</span>
                  <input type="number" min={1} max={50} value={addPlannedSets} onChange={(event) => setAddPlannedSets(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>{uk ? "Опір" : "Resistance"}</span>
                  <select value={addResistance} onChange={(event) => setAddResistance(event.target.value as ResistanceType)}>
                    <option value={RESISTANCE.EXTERNAL_WEIGHT}>{resistanceLabel(RESISTANCE.EXTERNAL_WEIGHT, uk)}</option>
                    <option value={RESISTANCE.RESISTANCE_BAND}>{resistanceLabel(RESISTANCE.RESISTANCE_BAND, uk)}</option>
                    <option value={RESISTANCE.BODYWEIGHT}>{resistanceLabel(RESISTANCE.BODYWEIGHT, uk)}</option>
                  </select>
                </label>
                <button className={styles.secondaryButton} type="button" onClick={addExercise}>
                  {uk ? "Додати" : "Add"}
                </button>
              </div>
            </div>

            <div className={styles.formActions}>
              {isEdit && (
                <button className={styles.dangerButton} type="button" disabled={saving} onClick={() => void archive()}>
                  {uk ? "Архівувати" : "Archive"}
                </button>
              )}
              <button className={styles.primaryButton} type="submit" disabled={saving}>
                {saving ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти" : "Save")}
              </button>
            </div>
          </div>
        </form>
      )}
    </main>
  );
}
