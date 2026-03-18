import { getSettings } from "@main/db/settings";
import { getLogger } from "@main/utils/logger";
import { normalizeFallbackOrder } from "@shared/provider-order";
import type { AppSettings, ProviderId, ProviderTestResult, TranscriptionResult } from "@shared/types";

import { transcribeWithDeepgram, testRemoteProvider, transcribeWithGroq, transcribeWithOpenAi } from "./providers";
import { getWhisperHealth, transcribeWithWhisper } from "./whisper-local";

const log = getLogger("router");

export async function transcribeAudio(buffer: Buffer, durationMs: number, settings = getSettings()) {
  const availability = getProviderAvailability(settings);
  const providerChain = buildProviderChain(settings, availability);
  const failureMessage =
    providerChain.length > 0 && providerChain[0] !== settings.defaultProvider
      ? `${settings.defaultProvider} is not ready. ${providerChain[0]} backup will be used for this recording.`
      : null;

  return transcribeAudioWithPlan(buffer, durationMs, settings, {
    failureMessage,
    providerChain,
    selectedProvider: settings.defaultProvider,
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

export function buildProviderChain(settings = getSettings(), availability = getProviderAvailability(settings)) {
  const selectedProvider = settings.defaultProvider;
  const providerChain: ProviderId[] = [];

  if (availability[selectedProvider]) {
    providerChain.push(selectedProvider);
  }

  if (settings.fallbackEnabled) {
    for (const provider of normalizeFallbackOrder(settings.fallbackOrder)) {
      if (provider === selectedProvider || !availability[provider] || providerChain.includes(provider)) {
        continue;
      }

      providerChain.push(provider);
    }

    if (selectedProvider !== "whisper-local" && availability["whisper-local"] && !providerChain.includes("whisper-local")) {
      providerChain.push("whisper-local");
    }
  }

  for (const [provider, available] of Object.entries(availability) as Array<[ProviderId, boolean]>) {
    if (!available) {
      log.info(`Skipping unavailable provider ${provider}`);
    }
  }

  return providerChain;
}

export function getProviderAvailability(settings: AppSettings): Record<ProviderId, boolean> {
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
