import { resolveCloudPresetTier, resolveProviderModelLabel } from "@shared/provider-presets";
import type { AppSettings, ProviderId, ProviderTestResult, TranscriptionResult } from "@shared/types";

const PROVIDER_REQUEST_TIMEOUT_MS = 120000;
const PROVIDER_VALIDATION_TIMEOUT_MS = 15000;

export async function transcribeWithOpenAi(buffer: Buffer, durationMs: number, settings: AppSettings): Promise<TranscriptionResult> {
  if (!settings.openaiApiKey) {
    throw new Error("Missing OpenAI API key.");
  }

  const startedAt = Date.now();
  const bytes = new Uint8Array(buffer);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "recording.wav");
  form.append("model", settings.openaiModel);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI transcription failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as { text?: string };
  const text = json.text?.trim() ?? "";

  return {
    provider: "openai",
    model: settings.openaiModel,
    text,
    rawText: text,
    durationMs,
    transcriptionMs: Date.now() - startedAt,
    usedFallback: false,
    selectedProvider: "openai",
    fallbackProvider: null,
    selectedProviderFailed: false,
    failureMessage: null,
  };
}

export async function transcribeWithGroq(buffer: Buffer, durationMs: number, settings: AppSettings): Promise<TranscriptionResult> {
  if (!settings.groqApiKey) {
    throw new Error("Missing Groq API key.");
  }

  const startedAt = Date.now();
  const bytes = new Uint8Array(buffer);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "recording.wav");
  form.append("model", settings.groqModel);

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.groqApiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq transcription failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as { text?: string };
  const text = json.text?.trim() ?? "";

  return {
    provider: "groq",
    model: settings.groqModel,
    text,
    rawText: text,
    durationMs,
    transcriptionMs: Date.now() - startedAt,
    usedFallback: false,
    selectedProvider: "groq",
    fallbackProvider: null,
    selectedProviderFailed: false,
    failureMessage: null,
  };
}

export async function transcribeWithDeepgram(buffer: Buffer, durationMs: number, settings: AppSettings): Promise<TranscriptionResult> {
  if (!settings.deepgramApiKey) {
    throw new Error("Missing Deepgram API key.");
  }

  const startedAt = Date.now();
  const bytes = new Uint8Array(buffer);
  // Send a full WAV container. Do not also force encoding/sample_rate — those params
  // make Deepgram treat the body as raw PCM (including the RIFF header), which can
  // yield empty or garbage transcripts.
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", settings.deepgramModel);
  url.searchParams.set("smart_format", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${settings.deepgramApiKey}`,
      "Content-Type": "audio/wav",
    },
    body: bytes,
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Deepgram transcription failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as DeepgramResponse;
  const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";

  return {
    provider: "deepgram",
    model: settings.deepgramModel,
    text,
    rawText: text,
    durationMs,
    transcriptionMs: Date.now() - startedAt,
    usedFallback: false,
    selectedProvider: "deepgram",
    fallbackProvider: null,
    selectedProviderFailed: false,
    failureMessage: null,
  };
}

export async function testRemoteProvider(provider: ProviderId, settings: AppSettings): Promise<ProviderTestResult> {
  switch (provider) {
    case "openai":
      return validateOpenAi(settings);
    case "groq":
      return validateGroq(settings);
    case "deepgram":
      return validateDeepgram(settings);
    default:
      return { provider, ok: false, message: "Use local whisper health for this provider." };
  }
}

async function validateOpenAi(settings: AppSettings): Promise<ProviderTestResult> {
  if (!settings.openaiApiKey) {
    return { provider: "openai", ok: false, message: "OpenAI API key is missing." };
  }

  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(settings.openaiModel)}`, {
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
    },
    signal: AbortSignal.timeout(PROVIDER_VALIDATION_TIMEOUT_MS),
  });

  if (response.ok) {
    return { provider: "openai", ok: true, message: `OpenAI is ready with ${resolveProviderModelLabel("openai", settings.openaiModel)}.` };
  }

  return {
    provider: "openai",
    ok: false,
    message: mapValidationError("OpenAI", response.status, settings.openaiModel),
  };
}

async function validateGroq(settings: AppSettings): Promise<ProviderTestResult> {
  if (!settings.groqApiKey) {
    return { provider: "groq", ok: false, message: "Groq API key is missing." };
  }

  const response = await fetch("https://api.groq.com/openai/v1/models", {
    headers: {
      Authorization: `Bearer ${settings.groqApiKey}`,
    },
    signal: AbortSignal.timeout(PROVIDER_VALIDATION_TIMEOUT_MS),
  });

  if (!response.ok) {
    return {
      provider: "groq",
      ok: false,
      message: mapValidationError("Groq", response.status, settings.groqModel),
    };
  }

  const json = (await response.json()) as { data?: Array<{ id?: string }> };
  const modelFound = json.data?.some((item) => item.id === settings.groqModel);

  return modelFound
    ? { provider: "groq", ok: true, message: `Groq is ready with ${resolveProviderModelLabel("groq", settings.groqModel)}.` }
    : { provider: "groq", ok: false, message: `Groq key works, but model ${settings.groqModel} was not found.` };
}

async function validateDeepgram(settings: AppSettings): Promise<ProviderTestResult> {
  if (!settings.deepgramApiKey) {
    return { provider: "deepgram", ok: false, message: "Deepgram API key is missing." };
  }

  if (!resolveCloudPresetTier("deepgram", settings.deepgramModel)) {
    return { provider: "deepgram", ok: false, message: `Deepgram model ${settings.deepgramModel} is not part of the available presets.` };
  }

  const response = await fetch("https://api.deepgram.com/v1/auth/token", {
    headers: {
      Authorization: `Token ${settings.deepgramApiKey}`,
    },
    signal: AbortSignal.timeout(PROVIDER_VALIDATION_TIMEOUT_MS),
  });

  if (response.ok) {
    return {
      provider: "deepgram",
      ok: true,
      message: `Deepgram is ready with ${resolveProviderModelLabel("deepgram", settings.deepgramModel)}.`,
    };
  }

  return {
    provider: "deepgram",
    ok: false,
    message: mapValidationError("Deepgram", response.status, settings.deepgramModel),
  };
}

function mapValidationError(label: string, status: number, model: string) {
  switch (status) {
    case 401:
    case 403:
      return `${label} rejected the API key.`;
    case 404:
      return `${label} could not find model ${model}.`;
    case 429:
      return `${label} validation was rate-limited. Try again in a moment.`;
    default:
      return `${label} validation failed (${status}).`;
  }
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}
