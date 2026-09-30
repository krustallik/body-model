"use client";

import { useState } from "react";
import {
  CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
  loadConfigV1Schema,
  type LoadConfigV1,
} from "@/modules/training/load-accounting-v1";
import { RESISTANCE, type ResistanceType } from "@/modules/training/training.constants";
import { parseTrainingDecimal } from "@/modules/training/parse-training-decimal";
import { readApiError } from "./training-labels";
import styles from "./training.module.css";

type ConfigMode =
  | "external-per-side"
  | "external-per-movement"
  | "external-whole-setup"
  | "band-logged-side"
  | "band-each-side"
  | "bodyweight-per-movement"
  | "bodyweight-per-side";

function modeFor(config: LoadConfigV1 | null, resistanceType: ResistanceType): ConfigMode {
  const matchesType = config && (
    (resistanceType === RESISTANCE.EXTERNAL_WEIGHT && config.resistanceType === "external")
    || (resistanceType === RESISTANCE.RESISTANCE_BAND && config.resistanceType === "band-nominal")
    || (resistanceType === RESISTANCE.BODYWEIGHT && config.resistanceType === "bodyweight")
  );
  if (matchesType && config.accountingKind === "external-per-implement-per-side") return "external-per-side";
  if (matchesType && config.accountingKind === "external-per-implement-per-movement") return "external-per-movement";
  if (matchesType && config.accountingKind === "external-complete-setup-per-movement") return "external-whole-setup";
  if (matchesType && config.accountingKind === "band-nominal-per-logged-side") return "band-logged-side";
  if (matchesType && config.accountingKind === "band-nominal-per-side") return "band-each-side";
  if (matchesType && config.accountingKind === "bodyweight-reference-per-side") return "bodyweight-per-side";
  if (matchesType && config.accountingKind === "bodyweight-reference-per-movement") return "bodyweight-per-movement";
  if (resistanceType === RESISTANCE.RESISTANCE_BAND) return "band-logged-side";
  if (resistanceType === RESISTANCE.BODYWEIGHT) return "bodyweight-per-movement";
  return "external-per-side";
}

function configMatchesResistance(config: LoadConfigV1 | null, resistanceType: ResistanceType): boolean {
  if (!config) return false;
  return (resistanceType === RESISTANCE.EXTERNAL_WEIGHT && config.resistanceType === "external")
    || (resistanceType === RESISTANCE.RESISTANCE_BAND && config.resistanceType === "band-nominal")
    || (resistanceType === RESISTANCE.BODYWEIGHT && config.resistanceType === "bodyweight");
}

function defaultEquipment(resistanceType: ResistanceType): string {
  if (resistanceType === RESISTANCE.RESISTANCE_BAND) return "resistance-band";
  if (resistanceType === RESISTANCE.BODYWEIGHT) return "bodyweight";
  return "external-load";
}

function makeConfig(input: {
  mode: ConfigMode;
  configVersion: string;
  inventoryCount: 1 | 2;
  loadedSides: 1 | 2;
  execution: "simultaneous" | "alternating" | "unilateral";
  implementsPerMovement: 1 | 2;
  bodyweightFraction: number;
  equipmentId: string;
  setupId: string;
}): unknown {
  const common = {
    schemaVersion: 1 as const,
    configVersion: input.configVersion,
    inventoryCount: input.inventoryCount,
    loadedSides: input.loadedSides,
    execution: input.execution,
    equipment: { equipmentId: input.equipmentId, setupId: input.setupId },
  };
  if (input.mode === "external-per-side") return {
    ...common,
    accountingKind: "external-per-implement-per-side",
    resistanceType: "external",
    loadInput: "per-implement-kg",
    repsMeaning: "per-side",
  };
  if (input.mode === "external-per-movement") return {
    ...common,
    accountingKind: "external-per-implement-per-movement",
    resistanceType: "external",
    loadInput: "per-implement-kg",
    repsMeaning: "per-movement",
    implementsPerMovement: input.execution === "simultaneous" ? input.implementsPerMovement : 1,
  };
  if (input.mode === "external-whole-setup") return {
    ...common,
    accountingKind: "external-complete-setup-per-movement",
    resistanceType: "external",
    loadInput: "complete-setup-kg",
    repsMeaning: "per-movement",
  };
  if (input.mode === "band-logged-side") return {
    ...common,
    accountingKind: "band-nominal-per-logged-side",
    resistanceType: "band-nominal",
    loadInput: "nominal-kg-per-logged-side",
    repsMeaning: "per-logged-side",
  };
  if (input.mode === "band-each-side") return {
    ...common,
    accountingKind: "band-nominal-per-side",
    resistanceType: "band-nominal",
    loadInput: "nominal-kg-per-logged-side",
    repsMeaning: "per-side",
  };
  if (input.mode === "bodyweight-per-side") return {
    ...common,
    accountingKind: "bodyweight-reference-per-side",
    resistanceType: "bodyweight",
    loadInput: "bodyweight-reference",
    repsMeaning: "per-side",
    bodyweightFraction: input.bodyweightFraction,
  };
  return {
    ...common,
    accountingKind: "bodyweight-reference-per-movement",
    resistanceType: "bodyweight",
    loadInput: "bodyweight-reference",
    repsMeaning: "per-movement",
    bodyweightFraction: input.bodyweightFraction,
  };
}

export function ExerciseLoadConfigEditor({
  catalogId,
  configuration,
  resistanceType,
  stableKey,
  uk,
  onSaved,
}: {
  catalogId: number;
  configuration: unknown | null | undefined;
  resistanceType: ResistanceType;
  stableKey?: string | null;
  uk: boolean;
  onSaved: (configuration: LoadConfigV1 | null) => void;
}) {
  const existing = loadConfigV1Schema.safeParse(configuration);
  const current = existing.success ? existing.data : null;
  const [mode, setMode] = useState<ConfigMode>(() => modeFor(current, resistanceType));
  const [inventoryCount, setInventoryCount] = useState<1 | 2>(current?.inventoryCount ?? 2);
  const [loadedSides, setLoadedSides] = useState<1 | 2>(current?.loadedSides ?? 2);
  const [execution, setExecution] = useState<"simultaneous" | "alternating" | "unilateral">(current?.execution ?? "simultaneous");
  const [implementsPerMovement, setImplementsPerMovement] = useState<1 | 2>(
    current && "implementsPerMovement" in current ? current.implementsPerMovement : 1,
  );
  const [bodyweightFraction, setBodyweightFraction] = useState(String(
    current && "bodyweightFraction" in current ? current.bodyweightFraction
      : stableKey === "pushup_handles" ? CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1 : 1,
  ));
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modeLabels: Record<ConfigMode, [string, string]> = {
    "external-per-side": ["Вага снаряда на навантажену сторону", "Weight per loaded implement"],
    "external-per-movement": ["Вага снарядів на одне повторення", "Implement weight for each movement"],
    "external-whole-setup": ["Загальна вага всієї системи", "Total weight of the complete setup"],
    "band-logged-side": ["Номінальний опір для записаного підходу", "Nominal resistance entered for the set"],
    "band-each-side": ["Номінальний опір кожної резинки", "Nominal resistance per band"],
    "bodyweight-per-movement": ["Референс маси на одне повторення", "Bodyweight reference for each movement"],
    "bodyweight-per-side": ["Референс маси окремо на сторону", "Bodyweight reference per side"],
  };

  async function save(next: unknown | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/training/exercises/${catalogId}/load-accounting`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loadAccountingConfig: next }),
      });
      if (!response.ok) {
        setError(await readApiError(response, uk));
        return;
      }
      const parsed = next === null ? null : loadConfigV1Schema.parse(next);
      onSaved(parsed);
      setExpanded(false);
    } catch {
      setError(uk ? "Не вдалося зберегти налаштування навантаження." : "Could not save load settings.");
    } finally {
      setBusy(false);
    }
  }

  function saveSelected() {
    const fraction = parseTrainingDecimal(bodyweightFraction);
    const equipmentSetup = current && configMatchesResistance(current, resistanceType)
      ? current.equipment
      : { equipmentId: defaultEquipment(resistanceType), setupId: mode };
    const config = makeConfig({
      mode,
      configVersion: `training-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      inventoryCount,
      loadedSides,
      execution,
      implementsPerMovement,
      bodyweightFraction: fraction,
      equipmentId: equipmentSetup.equipmentId,
      setupId: equipmentSetup.setupId,
    });
    const parsed = loadConfigV1Schema.safeParse(config);
    if (!parsed.success) {
      setError(uk ? "Перевірте сторони, снаряди та частку маси." : "Check loaded sides, implements, and bodyweight fraction.");
      return;
    }
    void save(parsed.data);
  }

  return (
    <section className={styles.loadConfigEditor}>
      <button type="button" className={styles.loadConfigToggle} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? (uk ? "Згорнути налаштування навантаження" : "Hide load settings") : (uk ? "Як враховувати навантаження" : "How load is accounted")}
      </button>
      {expanded && (
        <div className={styles.loadConfigBody}>
          <label className={styles.field}>
            <span>{uk ? "Як введена вага відповідає руху" : "How entered load maps to the movement"}</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as ConfigMode)}>
              {(resistanceType === RESISTANCE.EXTERNAL_WEIGHT
                ? ["external-per-side", "external-per-movement", "external-whole-setup"] as const
                : resistanceType === RESISTANCE.RESISTANCE_BAND
                  ? ["band-logged-side", "band-each-side"] as const
                  : ["bodyweight-per-movement", "bodyweight-per-side"] as const
              ).map((value) => <option key={value} value={value}>{modeLabels[value][uk ? 0 : 1]}</option>)}
            </select>
          </label>
          {(mode.startsWith("external-") || mode.startsWith("band-")) && (
            <div className={styles.loadConfigFields}>
              <label className={styles.field}>
                <span>{uk ? "Снарядів у наборі" : "Implements in the setup"}</span>
                <select value={inventoryCount} onChange={(event) => setInventoryCount(Number(event.target.value) as 1 | 2)}>
                  <option value={1}>{uk ? "1 снаряд" : "1 implement"}</option>
                  <option value={2}>{uk ? "2 снаряди" : "2 implements"}</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>{uk ? "Навантажені сторони" : "Loaded sides"}</span>
                <select value={loadedSides} onChange={(event) => setLoadedSides(Number(event.target.value) as 1 | 2)}>
                  <option value={1}>{uk ? "Одна" : "One"}</option>
                  <option value={2}>{uk ? "Дві" : "Two"}</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>{uk ? "Як виконується рух" : "Movement pattern"}</span>
                <select value={execution} onChange={(event) => setExecution(event.target.value as typeof execution)}>
                  <option value="simultaneous">{uk ? "Одночасно" : "At the same time"}</option>
                  <option value="alternating">{uk ? "Почергово" : "Alternating"}</option>
                  <option value="unilateral">{uk ? "Однією стороною" : "One side at a time"}</option>
                </select>
              </label>
              {mode === "external-per-movement" && (
                <label className={styles.field}>
                  <span>{uk ? "Снарядів на одне повторення" : "Implements per movement"}</span>
                  <select value={execution === "simultaneous" ? implementsPerMovement : 1} onChange={(event) => setImplementsPerMovement(Number(event.target.value) as 1 | 2)}>
                    <option value={1}>{uk ? "Один" : "One"}</option>
                    <option value={2} disabled={inventoryCount < 2}>{uk ? "Два" : "Two"}</option>
                  </select>
                </label>
              )}

            </div>
          )}
          {mode.startsWith("bodyweight-") && (
            <div className={styles.loadConfigFields}>
              <label className={styles.field}>
                <span>{uk ? "Частка маси для цього руху" : "Bodyweight share for this movement"}</span>
                <input inputMode="decimal" value={bodyweightFraction} onChange={(event) => setBodyweightFraction(event.target.value)} />
              </label>
            </div>
          )}
          {stableKey === "pushup_handles" && (
            <p className={styles.loadConfigNote}>
              {uk
                ? "Для віджимань від ручок початкове правило приблизне: 70% маси тіла. Збережені тренування залишають власне правило."
                : "The starting rule for handle push-ups is an approximate 70% of body mass. Saved workouts keep their captured rule."}
            </p>
          )}
          <p className={styles.loadConfigNote}>
            {uk
              ? "Це налаштування впливає на майбутні знімки програми. Збережені тренування зберігають власні історичні налаштування. Зміна опору в програмі — окрема дія."
              : "This setting is captured by future program snapshots. Saved workouts keep their historical settings. Changing a program's resistance type is a separate action."}
          </p>
          {current && <p className={styles.loadConfigCurrent}>{uk ? "Для каталогу вже є збережене правило." : "A load rule is saved for this catalog exercise."}</p>}
          {error && <p className={styles.accountingError} role="alert">{error}</p>}
          <div className={styles.formActions}>
            {current && <button type="button" className={styles.textButton} disabled={busy} onClick={() => void save(null)}>{uk ? "Очистити власне правило" : "Clear custom rule"}</button>}
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={saveSelected}>{busy ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти правило" : "Save load rule")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
