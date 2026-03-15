import electronMain from "electron/main";
import fs from "node:fs";

import { getDb } from "./database";
import { DEFAULT_SETTINGS, SECRET_SETTING_KEYS } from "@shared/constants";
import { normalizeFallbackOrder } from "@shared/provider-order";
import { LOCAL_WHISPER_PRESETS, prettifyLocalWhisperModel, resolveProviderModelLabel } from "@shared/provider-presets";
import type { AppSettings, ProviderHealth, ProviderId, WhisperModelOption } from "@shared/types";
import { getWhisperExecutablePath, getWhisperModelPath, getWhisperModelsDir } from "@main/utils/paths";

const { safeStorage } = electronMain;

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value, is_secret FROM settings").all() as DbSettingsRow[];
  const current = { ...DEFAULT_SETTINGS };

  for (const row of rows) {
    const key = row.key as keyof AppSettings;
    const value = row.is_secret ? decryptValue(row.value) : row.value;

    if (key === "fallbackEnabled" || key === "autoPaste" || key === "autoCopyClipboard" || key === "playSounds" || key === "aiTextPolish" || key === "showFloatingWidget") {
      current[key] = (value === "true") as never;
    } else if (key === "fallbackOrder") {
      current[key] = JSON.parse(value) as never;
    } else if (key === "widgetPosition") {
      current[key] = JSON.parse(value) as never;
    } else {
      current[key] = value as never;
    }
  }

  current.fallbackOrder = normalizeFallbackOrder(current.fallbackOrder);
  return current;
}

export function saveSettings(patch: Partial<AppSettings>) {
  const db = getDb();
  const normalizedPatch = { ...patch };

  if (normalizedPatch.fallbackOrder) {
    normalizedPatch.fallbackOrder = normalizeFallbackOrder(normalizedPatch.fallbackOrder);
  }

  const transaction = db.transaction((input: Partial<AppSettings>) => {
    for (const [key, rawValue] of Object.entries(input) as [keyof AppSettings, AppSettings[keyof AppSettings]][]) {
      const isSecret = SECRET_SETTING_KEYS.has(key);
      const value = serializeValue(rawValue);
      db.prepare(
        `INSERT INTO settings (key, value, is_secret)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret`
      ).run(key, isSecret ? encryptValue(value) : value, isSecret ? 1 : 0);
    }
  });

  transaction(normalizedPatch);
  return getSettings();
}

export function getProviderHealth(inputSettings = getSettings()): ProviderHealth[] {
  const settings = inputSettings;
  const whisperReady = fs.existsSync(getWhisperExecutablePath()) && fs.existsSync(getWhisperModelPath(settings.whisperModel));

  return [
    {
      provider: "whisper-local",
      configured: whisperReady,
      available: whisperReady,
      message: fs.existsSync(getWhisperExecutablePath())
        ? fs.existsSync(getWhisperModelPath(settings.whisperModel))
          ? "Local whisper binary and model are present."
          : "Whisper binary found, but the selected model is missing."
        : "Whisper runtime is missing. Install it from Settings.",
    },
    {
      provider: "openai",
      configured: settings.openaiApiKey.length > 0,
      available: settings.openaiApiKey.length > 0,
      message: settings.openaiApiKey
        ? `Key saved. ${resolveProviderModelLabel("openai", settings.openaiModel)} is selected. Validate to confirm access.`
        : "Add an OpenAI API key to enable cloud transcription.",
    },
    {
      provider: "groq",
      configured: settings.groqApiKey.length > 0,
      available: settings.groqApiKey.length > 0,
      message: settings.groqApiKey
        ? `Key saved. ${resolveProviderModelLabel("groq", settings.groqModel)} is selected. Validate to confirm access.`
        : "Add a Groq API key to enable cloud transcription.",
    },
    {
      provider: "deepgram",
      configured: settings.deepgramApiKey.length > 0,
      available: settings.deepgramApiKey.length > 0,
      message: settings.deepgramApiKey
        ? `Key saved. ${resolveProviderModelLabel("deepgram", settings.deepgramModel)} is selected. Validate to confirm access.`
        : "Add a Deepgram API key to enable cloud transcription.",
    },
  ];
}

export function getProviderHealthById(provider: ProviderId) {
  return getProviderHealth().find((item) => item.provider === provider);
}

export function listWhisperModels(): WhisperModelOption[] {
  const modelsDir = getWhisperModelsDir();

  if (!fs.existsSync(modelsDir)) {
    return [];
  }

  const order = new Map(LOCAL_WHISPER_PRESETS.map((preset, index) => [preset.model, index]));

  return fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".bin"))
    .map((entry) => ({
      value: entry.name,
      label: LOCAL_WHISPER_PRESETS.find((preset) => preset.model === entry.name)?.label ?? prettifyLocalWhisperModel(entry.name),
    }))
    .sort((left, right) => {
      const leftOrder = order.get(left.value);
      const rightOrder = order.get(right.value);

      if (leftOrder !== undefined && rightOrder !== undefined) {
        return leftOrder - rightOrder;
      }

      if (leftOrder !== undefined) {
        return -1;
      }

      if (rightOrder !== undefined) {
        return 1;
      }

      return left.label.localeCompare(right.label);
    });
}

function serializeValue(value: AppSettings[keyof AppSettings]) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function encryptValue(value: string) {
  if (value.length === 0) {
    return "";
  }

  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString("base64")}`;
  }

  return `plain:${Buffer.from(value, "utf8").toString("base64")}`;
}

function decryptValue(value: string) {
  if (value.length === 0) {
    return "";
  }

  if (value.startsWith("enc:") && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(value.slice(4), "base64"));
  }

  if (value.startsWith("plain:")) {
    return Buffer.from(value.slice(6), "base64").toString("utf8");
  }

  return value;
}

interface DbSettingsRow {
  key: string;
  value: string;
  is_secret: number;
}
