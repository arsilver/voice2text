import type { AudioSubmission, SaveTranscriptionInput, TranscriptionResult } from "@shared/types";

export interface RecordingWorkflowLogger {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface RecordingWorkflowDependencies {
  applyDictionary: (text: string) => string;
  logger: RecordingWorkflowLogger;
  now?: () => number;
  saveToClipboard: (text: string) => void;
  saveTranscription: (input: SaveTranscriptionInput) => { transcriptionMs: number };
  transcribeAudio: (buffer: Buffer, durationMs: number) => Promise<TranscriptionResult>;
}

export async function processRecordingSubmission(
  submission: AudioSubmission,
  {
    applyDictionary,
    logger,
    now = () => Date.now(),
    saveToClipboard,
    saveTranscription,
    transcribeAudio,
  }: RecordingWorkflowDependencies
) {
  const startedAt = now();
  const transcriptionStartedAt = now();
  logger.info("recording-stage", {
    audioBytes: submission.audioBytes.length,
    durationMs: submission.durationMs,
    recordingId: submission.recordingId,
    sampleRate: submission.sampleRate,
    stage: "transcription-start",
  });

  const result = await transcribeAudio(Buffer.from(submission.audioBytes), submission.durationMs);
  const transcriptionElapsedMs = now() - transcriptionStartedAt;
  const finalText = applyDictionary(result.text);

  logger.info("recording-stage", {
    finalTextLength: finalText.length,
    provider: result.provider,
    providerTranscriptionMs: result.transcriptionMs,
    recordingId: submission.recordingId,
    stage: "transcription-complete",
    totalWorkflowMs: now() - startedAt,
    transcriptionElapsedMs,
    usedFallback: result.usedFallback,
  });

  saveToClipboard(finalText);
  logger.info("recording-stage", {
    copiedChars: finalText.length,
    recordingId: submission.recordingId,
    stage: "clipboard-updated",
  });

  const saved = saveTranscription({
    rawText: result.rawText,
    finalText,
    durationMs: result.durationMs,
    transcriptionMs: now() - startedAt,
    provider: result.provider,
    model: result.model,
    targetApp: "",
    wasPasted: false,
  });

  logger.info("recording-stage", {
    provider: result.provider,
    recordingId: submission.recordingId,
    stage: "workflow-complete",
    totalWorkflowMs: saved.transcriptionMs,
    transcriptionElapsedMs,
  });

  return {
    ...result,
    text: finalText,
    rawText: result.rawText,
    transcriptionMs: saved.transcriptionMs,
    wasPasted: false,
  };
}
