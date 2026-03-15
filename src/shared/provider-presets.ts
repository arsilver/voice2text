import type { AppSettings, ProviderId, ProviderPresetOption, ProviderTier, RemoteProviderId } from "./types";

type CloudPresetCatalog = Record<RemoteProviderId, Record<ProviderTier, ProviderPresetOption>>;

export interface LocalWhisperCatalogEntry extends ProviderPresetOption {
  downloadUrl: string;
  sizeBytes: number | null;
}

export const CLOUD_PROVIDER_PRESETS: CloudPresetCatalog = {
  openai: {
    economy: {
      provider: "openai",
      value: "economy",
      label: "Economy",
      description: "Lowest-cost OpenAI transcription preset.",
      model: "gpt-4o-mini-transcribe",
    },
    best: {
      provider: "openai",
      value: "best",
      label: "Best",
      description: "Highest-quality OpenAI transcription preset.",
      model: "gpt-4o-transcribe",
    },
  },
  groq: {
    economy: {
      provider: "groq",
      value: "economy",
      label: "Economy",
      description: "Lowest-cost Groq speech preset.",
      model: "whisper-large-v3-turbo",
    },
    best: {
      provider: "groq",
      value: "best",
      label: "Best",
      description: "Highest-quality Groq speech preset.",
      model: "whisper-large-v3",
    },
  },
  deepgram: {
    economy: {
      provider: "deepgram",
      value: "economy",
      label: "Economy",
      description: "Lower-cost Deepgram preset.",
      model: "nova-2",
    },
    best: {
      provider: "deepgram",
      value: "best",
      label: "Best",
      description: "Highest-quality Deepgram preset.",
      model: "nova-3",
    },
  },
};

export const LOCAL_WHISPER_PRESETS: LocalWhisperCatalogEntry[] = [
  {
    provider: "whisper-local",
    value: "ggml-base.en.bin",
    label: "Fast",
    description: "Faster local preset with lighter accuracy.",
    model: "ggml-base.en.bin",
    downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sizeBytes: 148000000,
  },
  {
    provider: "whisper-local",
    value: "ggml-small.en.bin",
    label: "Better",
    description: "Better-quality local preset with a heavier model.",
    model: "ggml-small.en.bin",
    downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    sizeBytes: 488000000,
  },
  {
    provider: "whisper-local",
    value: "ggml-medium.en.bin",
    label: "Best",
    description: "Highest-quality local preset with a heavier model and slower runtime.",
    model: "ggml-medium.en.bin",
    downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
    sizeBytes: 1530000000,
  },
];

export const DEFAULT_LOCAL_WHISPER_PRESET = LOCAL_WHISPER_PRESETS[1];

export function getCloudPresetOptions(provider: RemoteProviderId) {
  return Object.values(CLOUD_PROVIDER_PRESETS[provider]);
}

export function resolveCloudPresetTier(provider: RemoteProviderId, model: string): ProviderTier | null {
  const entry = Object.entries(CLOUD_PROVIDER_PRESETS[provider]).find(([, preset]) => preset.model === model);
  return (entry?.[0] as ProviderTier | undefined) ?? null;
}

export function getCloudPreset(provider: RemoteProviderId, tier: ProviderTier) {
  return CLOUD_PROVIDER_PRESETS[provider][tier];
}

export function resolveProviderModelLabel(provider: ProviderId, model: string) {
  if (provider === "whisper-local") {
    const localPreset = LOCAL_WHISPER_PRESETS.find((preset) => preset.model === model);
    return localPreset ? `${localPreset.label} (${localPreset.model})` : prettifyLocalWhisperModel(model);
  }

  const tier = resolveCloudPresetTier(provider, model);
  if (!tier) {
    return model;
  }

  const preset = getCloudPreset(provider, tier);
  return `${preset.label} (${preset.model})`;
}

export function getPreferredModelPatch(provider: ProviderId, selection: string): Partial<AppSettings> {
  switch (provider) {
    case "whisper-local":
      return { whisperModel: selection };
    case "openai":
      return { openaiModel: getCloudPreset("openai", selection as ProviderTier).model };
    case "groq":
      return { groqModel: getCloudPreset("groq", selection as ProviderTier).model };
    case "deepgram":
      return { deepgramModel: getCloudPreset("deepgram", selection as ProviderTier).model };
  }
}

export function prettifyLocalWhisperModel(model: string) {
  return model
    .replace(/^ggml-/, "")
    .replace(/\.bin$/i, "")
    .replace(/[._-]+/g, " ")
    .replace(/\ben\b/i, "English")
    .replace(/\b(\w)/g, (match) => match.toUpperCase());
}
