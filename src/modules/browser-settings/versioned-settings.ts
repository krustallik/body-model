/** Small, failure-tolerant browser storage primitive. Call only from client effects/events. */
export const GOAL_SETTINGS_KEY = "bodycast.goal.settings.v1";
export const FORECAST_SETTINGS_KEY = "bodycast.forecast.settings.v1";
export const BROWSER_SETTINGS_VERSION = 1;

export type SettingsValidator<T> = (value: unknown) => value is T;

export function readVersionedSettings<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  validator: SettingsValidator<T>,
): T | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== BROWSER_SETTINGS_VERSION || !validator(value.settings)) return null;
    return value.settings;
  } catch {
    return null;
  }
}

export function writeVersionedSettings<T>(
  storage: Pick<Storage, "setItem">,
  key: string,
  settings: T,
): boolean {
  try {
    storage.setItem(key, JSON.stringify({ version: BROWSER_SETTINGS_VERSION, settings }));
    return true;
  } catch {
    return false;
  }
}

export function resetVersionedSettings(storage: Pick<Storage, "removeItem">, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserSettings<T>(key: string, validator: SettingsValidator<T>): T | null {
  try { return typeof window === "undefined" ? null : readVersionedSettings(window.localStorage, key, validator); }
  catch { return null; }
}

export function writeBrowserSettings<T>(key: string, settings: T): boolean {
  try { return typeof window !== "undefined" && writeVersionedSettings(window.localStorage, key, settings); }
  catch { return false; }
}

export function resetBrowserSettings(key: string): boolean {
  try { return typeof window !== "undefined" && resetVersionedSettings(window.localStorage, key); }
  catch { return false; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
