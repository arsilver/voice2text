import { DEFAULT_SETTINGS } from "../../shared/constants";
import type { AppSettings } from "../../shared/types";

export const STABILITY_RESET_SETTING_KEY = "__stability_reset_batch_only_v1__";
export const WIDGET_RESTORE_SETTING_KEY = "__widget_restore_after_batch_reset_v1__";

const KNOWN_BOOLEAN_KEYS = new Set<keyof AppSettings>([
  "fallbackEnabled",
  "autoPaste",
  "autoCopyClipboard",
  "playSounds",
  "aiTextPolish",
  "showFloatingWidget",
  "improverAutoCopy",
]);

const KNOWN_JSON_KEYS = new Set<keyof AppSettings>([
  "fallbackOrder",
  "widgetPosition",
]);

export const STABILITY_RESET_PATCH: Pick<AppSettings, "autoPaste" | "autoCopyClipboard" | "showFloatingWidget"> = {
  autoPaste: false,
  autoCopyClipboard: true,
  showFloatingWidget: false,
};

export const WIDGET_RESTORE_PATCH: Pick<AppSettings, "showFloatingWidget"> = {
  showFloatingWidget: true,
};

export function isKnownSettingsKey(key: string): key is keyof AppSettings {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

export function isBooleanSettingsKey(key: keyof AppSettings) {
  return KNOWN_BOOLEAN_KEYS.has(key);
}

export function isJsonSettingsKey(key: keyof AppSettings) {
  return KNOWN_JSON_KEYS.has(key);
}

export function buildStabilityResetMigrationPatch() {
  return { ...STABILITY_RESET_PATCH };
}

export function buildWidgetRestoreMigrationPatch() {
  return { ...WIDGET_RESTORE_PATCH };
}

export function coerceUnsafeSettingsPatch(patch: Partial<AppSettings>) {
  return {
    ...patch,
    autoPaste: false,
    autoCopyClipboard: true,
  } satisfies Partial<AppSettings>;
}

export function applyRuntimeSafetyOverrides(settings: AppSettings, safeMode: boolean): AppSettings {
  return {
    ...settings,
    autoPaste: false,
    autoCopyClipboard: true,
    showFloatingWidget: safeMode ? false : settings.showFloatingWidget,
  };
}
