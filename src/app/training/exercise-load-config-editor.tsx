"use client";

import { useState } from "react";
import {
  CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1,
  calculateLoadAccountingV1,
  LEGACY_LOAD_CONFIGS_V1,
  loadConfigV1Schema,
  type LoadConfigV1,
} from "@/modules/training/load-accounting-v1";
import { RESISTANCE, type ResistanceType } from "@/modules/training/training.constants";
import { parseTrainingDecimal } from "@/modules/training/parse-training-decimal";
import { readApiError } from "./training-labels";
import styles from "./training.module.css";

type ConfigMode =
  | "external-per-side"
  | "external-whole-setup"
  | "band-logged-side"
  | "band-each-side"
  | "bodyweight-per-movement"
  | "bodyweight-per-side";

const EXAMPLE_LOCAL_DATE = "2026-10-01";
const EXAMPLE_REPS = 12;
const EXAMPLE_LOAD_KG = 20;
const EXAMPLE_BODYWEIGHT_KG = 80;

function matchesResistance(config: LoadConfigV1 | null, resistanceType: ResistanceType): boolean {
  return config !== null && (
    (resistanceType === RESISTANCE.EXTERNAL_WEIGHT && config.resistanceType === "external")
    || (resistanceType === RESISTANCE.RESISTANCE_BAND && config.resistanceType === "band-nominal")
    || (resistanceType === RESISTANCE.BODYWEIGHT && config.resistanceType === "bodyweight")
  );
}

function legacyDefaultFor(stableKey: string | null | undefined): LoadConfigV1 | null {
  if (!stableKey || !Object.hasOwn(LEGACY_LOAD_CONFIGS_V1, stableKey)) return null;
  return LEGACY_LOAD_CONFIGS_V1[stableKey as keyof typeof LEGACY_LOAD_CONFIGS_V1] ?? null;
}

function modeFor(config: LoadConfigV1 | null, resistanceType: ResistanceType): ConfigMode {
  if (config && matchesResistance(config, resistanceType)) {
    if (config.accountingKind === "external-per-implement-per-side"
        || config.accountingKind === "external-per-implement-per-movement") return "external-per-side";
    if (config.accountingKind === "external-complete-setup-per-movement") return "external-whole-setup";
    if (config.accountingKind === "band-nominal-per-logged-side") return "band-logged-side";
    if (config.accountingKind === "band-nominal-per-side") return "band-each-side";
    if (config.accountingKind === "bodyweight-reference-per-side") return "bodyweight-per-side";
    if (config.accountingKind === "bodyweight-reference-per-movement") return "bodyweight-per-movement";
  }
  if (resistanceType === RESISTANCE.RESISTANCE_BAND) return "band-logged-side";
  if (resistanceType === RESISTANCE.BODYWEIGHT) return "bodyweight-per-movement";
  return "external-whole-setup";
}

function initialLoadedSides(config: LoadConfigV1 | null, resistanceType: ResistanceType): 1 | 2 {
  if (!config || !matchesResistance(config, resistanceType)) return 2;
  if (config.accountingKind === "external-per-implement-per-movement") return config.implementsPerMovement;
  return config.loadedSides;
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

function formatNumber(value: number, uk: boolean): string {
  return new Intl.NumberFormat(uk ? "uk-UA" : "en-GB", { maximumFractionDigits: 2 }).format(value);
}

function exampleResult(config: LoadConfigV1) {
  const asymmetricBand = config.accountingKind === "band-nominal-per-side";
  const result = calculateLoadAccountingV1({
    localDate: EXAMPLE_LOCAL_DATE,
    exercises: [{
      identity: { status: "unverified", stableKey: null },
      resistanceHint: config.resistanceType,
      configSnapshot: config,
      sets: [{
        reps: EXAMPLE_REPS,
        weightKg: EXAMPLE_LOAD_KG,
        bandNominalResistanceKg: EXAMPLE_LOAD_KG,
        override: asymmetricBand ? {
          repsMeaning: "per-side",
          reps: { kind: "asymmetric-per-side", left: EXAMPLE_REPS, right: EXAMPLE_REPS },
        } : null,
      }],
    }],
    bodyweightReference: config.resistanceType === "bodyweight" ? {
      status: "observed",
      valueKg: EXAMPLE_BODYWEIGHT_KG,
      localDate: EXAMPLE_LOCAL_DATE,
      source: "apple-health-shortcut",
      sourceId: "ui-example",
    } : undefined,
  });

  if (config.resistanceType === "external") {
    return { kind: "external" as const, value: result.externalLoadVolume.value };
  }
  if (config.resistanceType === "band-nominal") {
    return asymmetricBand
      ? { kind: "band-sides" as const, left: result.bandNominalIndex.leftSide.value, right: result.bandNominalIndex.rightSide.value }
      : { kind: "band" as const, value: result.bandNominalIndex.perLoggedSide.value };
  }
  return { kind: "bodyweight" as const, value: result.bodyweight.referenceVolume.value };
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
  const parsedCurrent = loadConfigV1Schema.safeParse(configuration);
  const current = parsedCurrent.success ? parsedCurrent.data : null;
  const legacyDefault = legacyDefaultFor(stableKey);
  const displayedConfig = current ?? legacyDefault;
  const [mode, setMode] = useState<ConfigMode>(() => modeFor(displayedConfig, resistanceType));
  const inventoryCount = displayedConfig?.inventoryCount ?? 1;
  const [loadedSides, setLoadedSides] = useState<1 | 2>(initialLoadedSides(displayedConfig, resistanceType));
  const execution = displayedConfig?.execution ?? "simultaneous";
  const [bodyweightFractionPercent, setBodyweightFractionPercent] = useState(String(
    100 * (displayedConfig && "bodyweightFraction" in displayedConfig
      ? displayedConfig.bodyweightFraction
      : stableKey === "pushup_handles" ? CANONICAL_PUSH_UP_BODYWEIGHT_FRACTION_V1 : 1),
  ));
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modeLabels: Record<ConfigMode, [string, string]> = {
    "external-per-side": ["Вага одного снаряда", "Weight of one implement"],
    "external-whole-setup": ["Повна вага руху", "Full movement load"],
    "band-logged-side": ["Опір на сторону підходу", "Resistance for the logged side"],
    "band-each-side": ["Опір кожної сторони", "Resistance on each side"],
    "bodyweight-per-movement": ["Маса на один рух", "Body mass per movement"],
    "bodyweight-per-side": ["Маса на кожну сторону", "Body mass per side"],
  };

  function selectedConfig(configVersion: string): LoadConfigV1 | null {
    const parsedPercent = parseTrainingDecimal(bodyweightFractionPercent);
    const effectiveExecution = execution;
    const requiredInventory = mode === "external-per-side" && effectiveExecution === "simultaneous"
      ? loadedSides
      : 1;
    const derivedInventory = Math.max(inventoryCount, requiredInventory) as 1 | 2;
    const equipmentSetup = matchesResistance(displayedConfig, resistanceType)
      ? displayedConfig!.equipment
      : { equipmentId: defaultEquipment(resistanceType), setupId: mode };
    const candidate = makeConfig({
      mode,
      configVersion,
      inventoryCount: derivedInventory,
      loadedSides,
      execution: effectiveExecution,
      bodyweightFraction: parsedPercent / 100,
      equipmentId: equipmentSetup.equipmentId,
      setupId: equipmentSetup.setupId,
    });
    const parsed = loadConfigV1Schema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  const previewConfig = selectedConfig("training-ui-example");
  const preview = previewConfig ? exampleResult(previewConfig) : null;
  const previewBodyweightFraction = previewConfig && "bodyweightFraction" in previewConfig
    ? previewConfig.bodyweightFraction : 1;
  const number = (value: number | null) => value === null ? null : formatNumber(value, uk);
  const previewLine = preview && previewConfig
    ? preview.kind === "external"
      ? uk
        ? mode === "external-per-side"
          ? `20 кг за снаряд × 12 однакових повторів × ${loadedSides} ${loadedSides === 1 ? "бік" : "боки"} → ${number(preview.value)} кг·повторів`
          : `20 кг повної ваги × 12 повторів → ${number(preview.value)} кг·повторів`
        : mode === "external-per-side"
          ? `20 kg per implement × 12 equal reps × ${loadedSides} sides → ${number(preview.value)} kg·reps`
          : `20 kg full movement load × 12 reps → ${number(preview.value)} kg·reps`
      : preview.kind === "band"
        ? uk ? `20 кг номінального опору × 12 повторів → ${number(preview.value)} номінальних кг·повторів` : `20 kg nominal resistance × 12 reps → ${number(preview.value)} nominal kg·reps`
        : preview.kind === "band-sides"
          ? uk ? `20 кг на сторону × (12 зліва + 12 справа) → по ${number(preview.left)} номінальних кг·повторів на сторону` : `20 kg per side × (12 left + 12 right) → ${number(preview.left)} nominal kg·reps per side`
          : uk
            ? `Умовний приклад: 80 кг × ${formatNumber(previewBodyweightFraction * 100, true)}% маси × 12${mode === "bodyweight-per-side" ? ` однакових повторів × ${loadedSides} стор.` : " рухів"} → ${number(preview.value)} референсних кг·повторів`
            : `Example: 80 kg × ${formatNumber(previewBodyweightFraction * 100, false)}% body mass × 12${mode === "bodyweight-per-side" ? ` equal reps × ${loadedSides} sides` : " movements"} → ${number(preview.value)} reference kg·reps`
    : null;

  const explanation = mode === "external-whole-setup"
    ? uk ? "Введіть повну зовнішню вагу на один рух. BodyCast врахує її один раз." : "Enter the full external load for one movement. BodyCast counts it once."
    : mode === "external-per-side"
      ? uk
        ? `Введіть вагу одного снаряда (наприклад, однієї гантелі). Одне число повторів застосовується однаково до ${loadedSides === 1 ? "одного боку" : "обох боків"}.`
        : `Enter the weight of one implement (for example, one dumbbell). The same entered rep count applies equally to ${loadedSides === 1 ? "one side" : "both sides"}.`
        : mode === "band-logged-side"
          ? uk ? "Номінальний опір рахується окремо від зовнішньої ваги: значення для підходу × записані повтори." : "Nominal band resistance stays separate from external load: the set value × entered repetitions."
          : mode === "band-each-side"
            ? uk ? "Одне введене число повторів застосовується однаково ліворуч і праворуч; приклад показує внесок кожної сторони окремо." : "The entered rep count applies equally to the left and right; the example shows each side's contribution separately."
            : mode === "bodyweight-per-side"
              ? uk ? "Одне число повторів застосовується однаково до кожної навантаженої сторони; частка маси враховується для обох." : "The same entered rep count applies to each loaded side; the selected share of body mass is counted for both."
              : uk ? "Вибрана частка референсної маси застосовується один раз до кожного завершеного руху." : "The selected share of reference body mass applies once to each completed movement.";

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
    const config = selectedConfig(`training-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    if (!config) {
      setError(uk ? "Перевірте введену частку маси: потрібно значення від 1% до 100%." : "Check the body mass share: enter a value from 1% to 100%.");
      return;
    }
    void save(config);
  }

  return (
    <section className={styles.loadConfigEditor}>
      <button type="button" className={styles.loadConfigToggle} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? (uk ? "Згорнути налаштування навантаження" : "Hide load settings") : (uk ? "Як враховувати навантаження" : "How load is accounted")}
      </button>
      {expanded && (
        <div className={styles.loadConfigBody}>
          <label className={styles.field}>
            <span>{uk ? "Що означає введена вага?" : "What does the entered load mean?"}</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as ConfigMode)}>
              {(resistanceType === RESISTANCE.EXTERNAL_WEIGHT
                ? ["external-whole-setup", "external-per-side"] as const
                : resistanceType === RESISTANCE.RESISTANCE_BAND
                  ? ["band-logged-side", "band-each-side"] as const
                  : ["bodyweight-per-movement", "bodyweight-per-side"] as const
              ).map((value) => <option key={value} value={value}>{modeLabels[value][uk ? 0 : 1]}</option>)}
            </select>
          </label>

          {(mode === "external-per-side" || mode === "bodyweight-per-side") && (
            <label className={styles.field}>
              <span>{uk ? "Скільки боків враховувати однаково?" : "How many sides count equally?"}</span>
              <select value={loadedSides} onChange={(event) => setLoadedSides(Number(event.target.value) as 1 | 2)}>
                <option value={1}>{uk ? "1 сторона" : "1 side"}</option>
                <option value={2}>{uk ? "2 сторони" : "2 sides"}</option>
              </select>
            </label>
          )}

          {mode.startsWith("bodyweight-") && (
            <label className={styles.field}>
              <span>{uk ? "Яку частку маси враховувати?" : "What share of body mass should count?"}</span>
              <div className={styles.loadConfigPercentField}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={bodyweightFractionPercent}
                  onChange={(event) => setBodyweightFractionPercent(event.target.value)}
                  aria-label={uk ? "Частка маси у відсотках" : "Body mass share percent"}
                  aria-describedby="load-config-bodyweight-help"
                />
                <span aria-hidden="true">%</span>
              </div>
              <span id="load-config-bodyweight-help" className={styles.loadConfigNote}>
                {uk ? "Наприклад, 70% — приблизна частка для віджимань від ручок." : "For example, 70% is the approximate share for handle push-ups."}
              </span>
            </label>
          )}

          <p className={styles.loadConfigExplanation}>{explanation}</p>
          {previewLine
            ? <p className={styles.loadConfigPreview} aria-live="polite" aria-atomic="true">{previewLine}</p>
            : <p className={styles.loadConfigPreview} role="status">{uk ? "Приклад недоступний. Перевірте вибране правило." : "Example unavailable. Check the selected rule."}</p>}

          <p className={styles.loadConfigNote}>
            {uk
              ? "Зміна правила стосується майбутніх програмних знімків. Завершені тренування зберігають правило, з яким їх було записано."
              : "This rule applies to future program snapshots. Completed workouts keep the rule captured when they were recorded."}
          </p>
          {current
            ? <p className={styles.loadConfigCurrent}>{uk ? "Для каталогу вже є збережене власне правило." : "A custom rule is saved for this catalog exercise."}</p>
            : legacyDefault && <p className={styles.loadConfigNote}>{uk ? "Зараз діє базове правило цієї вправи." : "The exercise's built-in rule is currently in use."}</p>}
          {error && <p className={styles.accountingError} role="alert">{error}</p>}
          <div className={styles.formActions}>
            {current && <button type="button" className={styles.textButton} disabled={busy} onClick={() => void save(null)}>{uk ? "Очистити власне правило" : "Clear custom rule"}</button>}
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={saveSelected}>
              {busy ? (uk ? "Збереження…" : "Saving…") : (uk ? "Зберегти правило" : "Save load rule")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
