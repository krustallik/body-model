import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN } from "@/modules/planning-scenario/planning-scenario";
import { isForecastBrowserSettings, isGoalBrowserSettings, goalSettingsFromForm } from "@/modules/browser-settings/planning-settings";
import {
  BROWSER_SETTINGS_VERSION,
  FORECAST_SETTINGS_KEY,
  GOAL_SETTINGS_KEY,
  readVersionedSettings,
  resetVersionedSettings,
  writeVersionedSettings,
  readBrowserSettings,
} from "@/modules/browser-settings/versioned-settings";
import { defaultGoalForm } from "@/modules/model-goal-planning/goal-planning-ui";

class MemoryStorage {
  values = new Map<string, string>();
  failRead = false;
  failWrite = false;
  getItem(key: string) { if (this.failRead) throw new DOMException("blocked", "SecurityError"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw new DOMException("blocked", "SecurityError"); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const form = defaultGoalForm("2026-08-24", 80);
const goalSettings = goalSettingsFromForm(form, null);
const forecastSettings = { horizon: 90 as const, mode: "fixed" as const, plan: { ...DEFAULT_PLAN, workCategory: "manualModerate" as const, plannedWork: true } };

describe("versioned browser settings", () => {
  it("round-trips valid v1 and preserves date-only values and canonical work enums", () => {
    const storage = new MemoryStorage();
    expect(writeVersionedSettings(storage, GOAL_SETTINGS_KEY, { ...goalSettings, form: { ...goalSettings.form, goalDate: "2026-11-22" } })).toBe(true);
    const restored = readVersionedSettings(storage, GOAL_SETTINGS_KEY, isGoalBrowserSettings);
    expect(restored?.form.goalDate).toBe("2026-11-22");
    expect(new Date(`${restored!.form.goalDate}T12:00:00.000Z`).toISOString().slice(0, 10)).toBe("2026-11-22");
    expect(isForecastBrowserSettings(forecastSettings)).toBe(true);
    expect(forecastSettings.plan.workCategory).toBe("manualModerate");
    expect("caloriesKcal" in goalSettings.form.plan).toBe(false);
    expect(goalSettings.manualNutrition).toBeNull();
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing version", JSON.stringify({ settings: goalSettings })],
    ["old version", JSON.stringify({ version: 0, settings: goalSettings })],
    ["future version", JSON.stringify({ version: BROWSER_SETTINGS_VERSION + 1, settings: goalSettings })],
    ["missing field", JSON.stringify({ version: 1, settings: { ...goalSettings, form: { ...goalSettings.form, mode: undefined } } })],
    ["invalid enum", JSON.stringify({ version: 1, settings: { ...goalSettings, form: { ...goalSettings.form, plan: { ...goalSettings.form.plan, workCategory: "Стояча робота" } } } })],
    ["invalid numeric", JSON.stringify({ version: 1, settings: { ...forecastSettings, plan: { ...forecastSettings.plan, averageStepsPerDay: Number.POSITIVE_INFINITY } } })],
    ["invalid date", JSON.stringify({ version: 1, settings: { ...goalSettings, form: { ...goalSettings.form, goalDate: "2026-02-30" } } })],
  ])("ignores %s", (_label, raw) => {
    const storage = new MemoryStorage();
    storage.values.set(GOAL_SETTINGS_KEY, raw);
    expect(readVersionedSettings(storage, GOAL_SETTINGS_KEY, isGoalBrowserSettings)).toBeNull();
  });

  it("ignores a valid-looking payload with an invalid forecast category", () => {
    const storage = new MemoryStorage();
    storage.setItem(FORECAST_SETTINGS_KEY, JSON.stringify({ version: 1, settings: { ...forecastSettings, plan: { ...DEFAULT_PLAN, workCategory: "manualish" } } }));
    expect(readVersionedSettings(storage, FORECAST_SETTINGS_KEY, isForecastBrowserSettings)).toBeNull();
  });

  it("survives read/write storage exceptions and reset removes only the selected key", () => {
    const storage = new MemoryStorage();
    expect(readVersionedSettings(storage, GOAL_SETTINGS_KEY, isGoalBrowserSettings)).toBeNull();
    storage.failRead = true;
    expect(readVersionedSettings(storage, GOAL_SETTINGS_KEY, isGoalBrowserSettings)).toBeNull();
    storage.failRead = false;
    storage.failWrite = true;
    expect(writeVersionedSettings(storage, GOAL_SETTINGS_KEY, goalSettings)).toBe(false);
    storage.failWrite = false;
    storage.setItem(GOAL_SETTINGS_KEY, "goal");
    storage.setItem(FORECAST_SETTINGS_KEY, "forecast");
    expect(resetVersionedSettings(storage, GOAL_SETTINGS_KEY)).toBe(true);
    expect(storage.getItem(GOAL_SETTINGS_KEY)).toBeNull();
    expect(storage.getItem(FORECAST_SETTINGS_KEY)).toBe("forecast");
  });

  it("renders safely when browser storage is unavailable", () => {
    expect(readBrowserSettings(GOAL_SETTINGS_KEY, isGoalBrowserSettings)).toBeNull();
  });
});
