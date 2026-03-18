import type { AppSettings, TranscriptionResult } from "@shared/types";

export interface WhisperServerRuntimeStatus {
  activeModel: string;
  healthy: boolean;
  isStarting: boolean;
}

export interface WhisperRuntimeLogger {
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface PreferredWhisperRuntimeDependencies {
  ensureServerReady: (modelPath: string) => Promise<void>;
  getServerStatus: () => WhisperServerRuntimeStatus;
  logger: WhisperRuntimeLogger;
  modelPath: string;
  now?: () => number;
  safeMode: boolean;
  transcribeWithCli: () => Promise<string>;
  transcribeWithServer: () => Promise<string>;
}

export async function transcribeWithPreferredWhisperRuntime(
  durationMs: number,
  settings: AppSettings,
  {
    ensureServerReady,
    getServerStatus,
    logger,
    modelPath,
    now = () => Date.now(),
    safeMode,
    transcribeWithCli,
    transcribeWithServer,
  }: PreferredWhisperRuntimeDependencies
): Promise<TranscriptionResult> {
  const startedAt = now();

  if (safeMode) {
    logger.info("local-whisper-phase", {
      mode: "cli",
      modelPath,
      phase: "cli-selected",
      reason: "safe-mode",
    });

    const text = await transcribeWithCli();
    return buildResult(text, durationMs, settings, now() - startedAt);
  }

  const status = getServerStatus();
  const warmServer = status.healthy && status.activeModel === modelPath;
  const serverMode = warmServer ? "server-reuse" : "server-start";
  const ensureStartedAt = now();

  logger.info("local-whisper-phase", {
    mode: serverMode,
    modelPath,
    phase: "server-selected",
    warmServer,
  });

  try {
    await ensureServerReady(modelPath);
    const ensureMs = now() - ensureStartedAt;

    logger.info("local-whisper-phase", {
      ensureMs,
      mode: serverMode,
      modelPath,
      phase: "server-ready",
      warmServer,
    });

    const requestStartedAt = now();
    const text = await transcribeWithServer();
    const requestMs = now() - requestStartedAt;
    const totalMs = now() - startedAt;

    logger.info("local-whisper-phase", {
      mode: serverMode,
      modelPath,
      phase: "server-complete",
      requestMs,
      totalMs,
      warmServer,
    });

    return buildResult(text, durationMs, settings, totalMs);
  } catch (error) {
    const serverElapsedMs = now() - ensureStartedAt;

    logger.warn(
      "Local Whisper server path failed, falling back to CLI",
      {
        mode: serverMode,
        modelPath,
        phase: "server-fallback",
        serverElapsedMs,
        warmServer,
      },
      error
    );

    const cliStartedAt = now();
    const text = await transcribeWithCli();
    const cliMs = now() - cliStartedAt;
    const totalMs = now() - startedAt;

    logger.info("local-whisper-phase", {
      cliMs,
      mode: "cli-fallback",
      modelPath,
      phase: "cli-complete",
      totalMs,
      warmServer,
    });

    return buildResult(text, durationMs, settings, totalMs);
  }
}

function buildResult(text: string, durationMs: number, settings: AppSettings, transcriptionMs: number): TranscriptionResult {
  return {
    provider: "whisper-local",
    model: settings.whisperModel,
    text,
    rawText: text,
    durationMs,
    transcriptionMs,
    usedFallback: false,
    selectedProvider: "whisper-local",
    fallbackProvider: null,
    selectedProviderFailed: false,
    failureMessage: null,
  };
}
