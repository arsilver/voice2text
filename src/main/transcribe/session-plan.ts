import type {
  AppSettings,
  ProviderId,
  RecordingAdapterKind,
  RecordingChunkFormat,
  RecordingChunkTransport,
} from "../../shared/types";

export interface ProviderAvailabilitySnapshot {
  "whisper-local": boolean;
  openai: boolean;
  groq: boolean;
  deepgram: boolean;
}

export interface FrozenTranscriptionPlan {
  selectedProvider: ProviderId;
  activeProvider: ProviderId | null;
  backupProviders: ProviderId[];
  adapterKind: RecordingAdapterKind;
  transport: RecordingChunkTransport;
  captureSampleRate: number;
  captureFormat: RecordingChunkFormat;
  chunkIntervalMs: number;
  rollingWindowMs: number;
  overlapMs: number;
  selectedProviderUnavailable: boolean;
}

interface CapturePlan {
  adapterKind: RecordingAdapterKind;
  transport: RecordingChunkTransport;
  captureSampleRate: number;
  captureFormat: RecordingChunkFormat;
  chunkIntervalMs: number;
  rollingWindowMs: number;
  overlapMs: number;
}

const CAPTURE_PLANS: Record<ProviderId, CapturePlan> = {
  "whisper-local": {
    adapterKind: "batch-upload",
    transport: "rolling-window",
    captureSampleRate: 16000,
    captureFormat: "wav",
    chunkIntervalMs: 0,
    rollingWindowMs: 0,
    overlapMs: 0,
  },
  openai: {
    adapterKind: "batch-upload",
    transport: "rolling-window",
    captureSampleRate: 16000,
    captureFormat: "wav",
    chunkIntervalMs: 0,
    rollingWindowMs: 0,
    overlapMs: 0,
  },
  deepgram: {
    adapterKind: "batch-upload",
    transport: "rolling-window",
    captureSampleRate: 16000,
    captureFormat: "wav",
    chunkIntervalMs: 0,
    rollingWindowMs: 0,
    overlapMs: 0,
  },
  groq: {
    adapterKind: "batch-upload",
    transport: "rolling-window",
    captureSampleRate: 16000,
    captureFormat: "wav",
    chunkIntervalMs: 0,
    rollingWindowMs: 0,
    overlapMs: 0,
  },
};

export function resolveSessionTranscriptionPlan(
  settings: Pick<AppSettings, "defaultProvider" | "fallbackEnabled" | "fallbackOrder">,
  availability: ProviderAvailabilitySnapshot
): FrozenTranscriptionPlan {
  const selectedProvider = settings.defaultProvider;
  const orderedBackups = buildExplicitBackupProviders(settings, availability, selectedProvider);
  const selectedProviderUnavailable = !availability[selectedProvider];
  const activeProvider = availability[selectedProvider] ? selectedProvider : orderedBackups[0] ?? null;
  const backupProviders = activeProvider ? orderedBackups.filter((provider) => provider !== activeProvider) : orderedBackups;
  const capturePlan = activeProvider ? CAPTURE_PLANS[activeProvider] : createUnavailableCapturePlan();

  return {
    selectedProvider,
    activeProvider,
    backupProviders,
    selectedProviderUnavailable,
    ...capturePlan,
  };
}

function buildExplicitBackupProviders(
  settings: Pick<AppSettings, "defaultProvider" | "fallbackEnabled" | "fallbackOrder">,
  availability: ProviderAvailabilitySnapshot,
  selectedProvider: ProviderId
) {
  if (!settings.fallbackEnabled) {
    return [];
  }

  const ordered: ProviderId[] = [];

  for (const provider of settings.fallbackOrder) {
    if (provider === selectedProvider || !availability[provider] || ordered.includes(provider)) {
      continue;
    }

    ordered.push(provider);
  }

  if (selectedProvider !== "whisper-local" && availability["whisper-local"] && !ordered.includes("whisper-local")) {
    ordered.push("whisper-local");
  }

  return ordered;
}

function createUnavailableCapturePlan(): CapturePlan {
  return {
    adapterKind: "batch-upload",
    transport: "stream",
    captureSampleRate: 16000,
    captureFormat: "wav",
    chunkIntervalMs: 0,
    rollingWindowMs: 0,
    overlapMs: 0,
  };
}
