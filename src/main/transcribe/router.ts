import { getSettings } from "@main/db/settings";
import { normalizeFallbackOrder } from "@shared/provider-order";
import type { AppSettings, ProviderId, ProviderTestResult, TranscriptionResult } from "@shared/types";
import { getLogger } from "@main/utils/logger";

import { transcribeWithDeepgram, testRemoteProvider, transcribeWithGroq, transcribeWithOpenAi } from "./providers";
import {
  resolveSessionTranscriptionPlan,
  type FrozenTranscriptionPlan,
  type ProviderAvailabilitySnapshot,
} from "./session-plan";
import { getWhisperHealth, transcribeWithWhisper } from "./whisper-local";

const log = getLogger("router");

export async function transcribeAudio(buffer: Buffer, durationMs: number) {
  const settings = getSettings();
  const plan = getFrozenTranscriptionPlan(settings);
  return transcribeAudioWithPlan(buffer, durationMs, settings, {
    selectedProvider: plan.selectedProvider,
    providerChain: [plan.selectedProvider, ...plan.backupProviders].filter((provider, index, providers) => providers.indexOf(provider) === index),
    failureMessage: null,
  });
}

export async function transcribeAudioWithPlan(
  buffer: Buffer,
  durationMs: number,
  settings: AppSettings,
  plan: {
    selectedProvider: ProviderId;
    providerChain: ProviderId[];
    failureMessage: string | null;
  }
) {
  let lastError: Error | null = null;
  let lastErrorMessage: string | null = null;

  if (plan.providerChain.length === 0) {
    throw new Error("No transcription provider is ready. Add a cloud key or restore the local Whisper assets.");
  }

  for (let index = 0; index < plan.providerChain.length; index += 1) {
    const provider = plan.providerChain[index];

    try {
      const result = await runProvider(provider, buffer, durationMs, settings);
      const isFallback = provider !== plan.selectedProvider || index > 0;
      return {
        ...result,
        selectedProvider: plan.selectedProvider,
        usedFallback: isFallback,
        fallbackProvider: isFallback ? provider : null,
        selectedProviderFailed: isFallback,
        failureMessage: isFallback ? (plan.failureMessage || lastErrorMessage) : null,
      };
    } catch (error) {
      lastError = error as Error;
      lastErrorMessage = lastError.message;
      log.warn(`Provider ${provider} failed`, error);
    }
  }

  throw lastError ?? new Error("No transcription providers available.");
}

export function getFrozenTranscriptionPlan(settings = getSettings()) {
  const availability = getProviderAvailability(settings);
  const plan = resolveSessionTranscriptionPlan(settings, availability);

  for (const [provider, available] of Object.entries(availability) as Array<[ProviderId, boolean]>) {
    if (!available) {
      log.info(`Skipping unavailable provider ${provider}`);
    }
  }

  return plan;
}

export function getProviderAvailability(settings: AppSettings): ProviderAvailabilitySnapshot {
  return {
    "whisper-local": getWhisperHealth(settings).available,
    openai: Boolean(settings.openaiApiKey),
    groq: Boolean(settings.groqApiKey),
    deepgram: Boolean(settings.deepgramApiKey),
  };
}

export async function testProvider(provider: ProviderId, draft?: Partial<AppSettings>): Promise<ProviderTestResult> {
  const settings = mergeSettings(draft);

  if (provider === "whisper-local") {
    const health = getWhisperHealth(settings);
    return {
      provider,
      ok: health.available,
      message: health.message,
    };
  }

  return testRemoteProvider(provider, settings);
}

export function runProvider(provider: ProviderId, buffer: Buffer, durationMs: number, settings: AppSettings): Promise<TranscriptionResult> {
  switch (provider) {
    case "whisper-local":
      return transcribeWithWhisper(buffer, durationMs, settings);
    case "openai":
      return transcribeWithOpenAi(buffer, durationMs, settings);
    case "groq":
      return transcribeWithGroq(buffer, durationMs, settings);
    case "deepgram":
      return transcribeWithDeepgram(buffer, durationMs, settings);
  }
}

function mergeSettings(draft?: Partial<AppSettings>) {
  if (!draft) {
    return getSettings();
  }

  const current = getSettings();
  return {
    ...current,
    ...draft,
    fallbackOrder: draft.fallbackOrder ? normalizeFallbackOrder(draft.fallbackOrder) : current.fallbackOrder,
  };
}
