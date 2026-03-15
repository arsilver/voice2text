import type { AppSettings } from "./types";
import { CLOUD_PROVIDER_PRESETS, DEFAULT_LOCAL_WHISPER_PRESET } from "./provider-presets";

export const APP_NAME = "CraftVoice";
export const DEFAULT_RENDERER_ROUTE = "/overview";

export const SECRET_SETTING_KEYS = new Set<keyof AppSettings>([
  "groqApiKey",
  "openaiApiKey",
  "deepgramApiKey",
]);

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: "whisper-local",
  fallbackEnabled: true,
  fallbackOrder: ["openai", "groq", "deepgram"],
  whisperModel: DEFAULT_LOCAL_WHISPER_PRESET.model,
  openaiModel: CLOUD_PROVIDER_PRESETS.openai.economy.model,
  groqModel: CLOUD_PROVIDER_PRESETS.groq.economy.model,
  deepgramModel: CLOUD_PROVIDER_PRESETS.deepgram.economy.model,
  groqApiKey: "",
  openaiApiKey: "",
  deepgramApiKey: "",
  hotkey: "Alt+D",
  autoPaste: false,
  autoCopyClipboard: true,
  playSounds: false,
  aiTextPolish: false,
  showFloatingWidget: true,
  widgetPosition: { x: -1, y: -1 },
  selectedMicrophoneId: "",
  theme: "dark",
};
