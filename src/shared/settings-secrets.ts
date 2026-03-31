import type { AppSettings, SecretSettingKey, SettingsSaveInput } from "./types";

export const SECRET_SETTING_KEY_LIST: SecretSettingKey[] = ["groqApiKey", "openaiApiKey", "deepgramApiKey"];

export function redactSettingsSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    groqApiKey: "",
    openaiApiKey: "",
    deepgramApiKey: "",
  };
}

export function normalizeSettingsSaveInput(input: Partial<AppSettings> | SettingsSaveInput): SettingsSaveInput {
  if ("patch" in input) {
    return {
      patch: { ...input.patch },
      clearSecrets: input.clearSecrets ? [...input.clearSecrets] : [],
    };
  }

  return {
    patch: { ...input },
    clearSecrets: [],
  };
}

export function resolveSettingsSave(current: AppSettings, input: Partial<AppSettings> | SettingsSaveInput): AppSettings {
  const normalized = normalizeSettingsSaveInput(input);
  const clearSecrets = new Set(normalized.clearSecrets);
  const next = {
    ...current,
    ...normalized.patch,
  };

  for (const key of SECRET_SETTING_KEY_LIST) {
    if (clearSecrets.has(key)) {
      next[key] = "";
      continue;
    }

    const candidate = normalized.patch[key];
    if (candidate === undefined) {
      next[key] = current[key];
      continue;
    }

    next[key] = candidate.trim().length > 0 ? candidate : current[key];
  }

  return next;
}
