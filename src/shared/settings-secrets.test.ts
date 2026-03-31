import assert from "node:assert/strict";
import test from "node:test";

import { redactSettingsSecrets, resolveSettingsSave } from "./settings-secrets";
import type { AppSettings, SettingsSaveInput } from "./types";

const BASE_SETTINGS: AppSettings = {
  defaultProvider: "deepgram",
  fallbackEnabled: true,
  fallbackOrder: ["openai", "groq", "deepgram"],
  whisperModel: "ggml-small.en.bin",
  openaiModel: "gpt-4o-mini-transcribe",
  groqModel: "whisper-large-v3-turbo",
  deepgramModel: "nova-3",
  groqApiKey: "groq-secret",
  openaiApiKey: "openai-secret",
  deepgramApiKey: "deepgram-secret",
  hotkey: "Alt+D",
  autoPaste: false,
  autoCopyClipboard: true,
  playSounds: false,
  aiTextPolish: false,
  showFloatingWidget: true,
  widgetPosition: { x: 120, y: 240 },
  selectedMicrophoneId: "default-mic",
  theme: "dark",
  improverTool: "claude",
  improverSystemPrompt: "",
  improverAutoCopy: true,
};

test("redacting settings clears secret values without touching normal settings", () => {
  const redacted = redactSettingsSecrets(BASE_SETTINGS);

  assert.equal(redacted.openaiApiKey, "");
  assert.equal(redacted.groqApiKey, "");
  assert.equal(redacted.deepgramApiKey, "");
  assert.equal(redacted.defaultProvider, BASE_SETTINGS.defaultProvider);
  assert.deepEqual(redacted.widgetPosition, BASE_SETTINGS.widgetPosition);
});

test("blank secret values in a save payload keep the stored secret by default", () => {
  const input: SettingsSaveInput = {
    patch: {
      ...redactSettingsSecrets(BASE_SETTINGS),
      defaultProvider: "openai",
      openaiApiKey: "",
      groqApiKey: "",
      deepgramApiKey: "",
    },
  };

  const resolved = resolveSettingsSave(BASE_SETTINGS, input);

  assert.equal(resolved.defaultProvider, "openai");
  assert.equal(resolved.openaiApiKey, "openai-secret");
  assert.equal(resolved.groqApiKey, "groq-secret");
  assert.equal(resolved.deepgramApiKey, "deepgram-secret");
});

test("save resolution supports explicit secret replacement and clearing", () => {
  const input: SettingsSaveInput = {
    patch: {
      openaiApiKey: "openai-next",
      groqApiKey: "",
    },
    clearSecrets: ["groqApiKey"],
  };

  const resolved = resolveSettingsSave(BASE_SETTINGS, input);

  assert.equal(resolved.openaiApiKey, "openai-next");
  assert.equal(resolved.groqApiKey, "");
  assert.equal(resolved.deepgramApiKey, "deepgram-secret");
});
