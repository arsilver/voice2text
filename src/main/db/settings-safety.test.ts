import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRuntimeSafetyOverrides,
  buildStabilityResetMigrationPatch,
  buildWidgetRestoreMigrationPatch,
  coerceUnsafeSettingsPatch,
  isKnownSettingsKey,
} from "./settings-safety";

test("stability reset migration disables paste and widget while keeping clipboard enabled", () => {
  assert.deepEqual(buildStabilityResetMigrationPatch(), {
    autoPaste: false,
    autoCopyClipboard: true,
    showFloatingWidget: false,
  });
});

test("runtime safety overrides keep clipboard-only delivery and safe mode hides the widget", () => {
  const overridden = applyRuntimeSafetyOverrides(
    {
      defaultProvider: "whisper-local",
      fallbackEnabled: true,
      fallbackOrder: ["openai", "groq", "deepgram"],
      whisperModel: "ggml-small.en.bin",
      openaiModel: "gpt-4o-mini-transcribe",
      groqModel: "whisper-large-v3-turbo",
      deepgramModel: "nova-3",
      groqApiKey: "",
      openaiApiKey: "",
      deepgramApiKey: "",
      hotkey: "Alt+D",
      autoPaste: true,
      autoCopyClipboard: false,
      playSounds: false,
      aiTextPolish: false,
      showFloatingWidget: true,
      widgetPosition: { x: -1, y: -1 },
      selectedMicrophoneId: "",
      theme: "dark",
      improverTool: "claude",
      improverSystemPrompt: "",
      improverAutoCopy: true,
    },
    true
  );

  assert.equal(overridden.autoPaste, false);
  assert.equal(overridden.autoCopyClipboard, true);
  assert.equal(overridden.showFloatingWidget, false);
});

test("widget restore migration re-enables the widget after the stabilization reset", () => {
  assert.deepEqual(buildWidgetRestoreMigrationPatch(), {
    showFloatingWidget: true,
  });
});

test("saving settings coerces clipboard-only values and ignores unknown keys", () => {
  assert.deepEqual(coerceUnsafeSettingsPatch({ autoPaste: true, autoCopyClipboard: false, hotkey: "Ctrl+Shift+D" }), {
    autoPaste: false,
    autoCopyClipboard: true,
    hotkey: "Ctrl+Shift+D",
  });
  assert.equal(isKnownSettingsKey("hotkey"), true);
  assert.equal(isKnownSettingsKey("__stability_reset_batch_only_v1__"), false);
});
