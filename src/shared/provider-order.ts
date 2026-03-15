import type { AppSettings, ProviderId, RemoteProviderId } from "./types";

export const REMOTE_PROVIDER_IDS: RemoteProviderId[] = ["openai", "groq", "deepgram"];

export function isRemoteProvider(provider: ProviderId): provider is RemoteProviderId {
  return provider !== "whisper-local";
}

export function normalizeFallbackOrder(order: ProviderId[]) {
  const normalized: RemoteProviderId[] = [];

  for (const provider of [...order, ...REMOTE_PROVIDER_IDS]) {
    if (!isRemoteProvider(provider) || normalized.includes(provider)) {
      continue;
    }

    normalized.push(provider);
  }

  return normalized;
}

export function buildProviderPreference(settings: Pick<AppSettings, "defaultProvider" | "fallbackEnabled" | "fallbackOrder">) {
  const ordered: ProviderId[] = [settings.defaultProvider];

  if (settings.fallbackEnabled) {
    for (const provider of normalizeFallbackOrder(settings.fallbackOrder)) {
      if (provider !== settings.defaultProvider && !ordered.includes(provider)) {
        ordered.push(provider);
      }
    }
  }

  if (settings.fallbackEnabled && settings.defaultProvider !== "whisper-local" && !ordered.includes("whisper-local")) {
    ordered.push("whisper-local");
  }

  return ordered;
}

export function buildEffectiveProviderChain(
  settings: Pick<AppSettings, "defaultProvider" | "fallbackEnabled" | "fallbackOrder">,
  availableProviders: Iterable<ProviderId>
) {
  const available = new Set(availableProviders);
  return buildProviderPreference(settings).filter((provider) => available.has(provider));
}

export function formatProviderName(provider: ProviderId) {
  switch (provider) {
    case "whisper-local":
      return "Local Whisper";
    case "openai":
      return "OpenAI";
    case "groq":
      return "Groq";
    case "deepgram":
      return "Deepgram";
  }
}
