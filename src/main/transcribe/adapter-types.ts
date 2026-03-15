import type {
  AppSettings,
  ProviderId,
  RecordingAdapterKind,
  RecordingChunkSubmission,
  TranscriptionResult,
} from "@shared/types";

export interface AdapterFinalizeResult {
  text: string;
  rawText: string;
  provider: ProviderId;
  model: string;
}

export type PartialTranscriptCallback = (text: string) => void;

export interface ProviderTranscriptionAdapter {
  readonly provider: ProviderId;
  readonly adapterKind: RecordingAdapterKind;
  readonly model: string;
  onPartialTranscript?: PartialTranscriptCallback;
  start(): Promise<void>;
  pushChunk(submission: RecordingChunkSubmission): Promise<void>;
  finalize(): Promise<AdapterFinalizeResult>;
  close(): Promise<void>;
}

export interface ProviderAdapterContext {
  settings: AppSettings;
  durationMs: number;
}

export interface ProviderFailure {
  provider: ProviderId;
  message: string;
  error: Error;
}

export function toFallbackResult(
  base: TranscriptionResult,
  selectedProvider: ProviderId,
  failureMessage: string | null
): TranscriptionResult {
  return {
    ...base,
    selectedProvider,
    usedFallback: base.provider !== selectedProvider,
    fallbackProvider: base.provider !== selectedProvider ? base.provider : null,
    selectedProviderFailed: base.provider !== selectedProvider,
    failureMessage: base.provider !== selectedProvider ? failureMessage : null,
  };
}
