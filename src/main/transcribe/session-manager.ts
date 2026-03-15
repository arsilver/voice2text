import { randomUUID } from "node:crypto";

import { getSettings } from "@main/db/settings";
import { getLogger } from "@main/utils/logger";
import type { RecordingChunkSubmission, RecordingFinishSubmission, RecordingSessionInfo, TranscriptionResult } from "@shared/types";
import type { ProviderTranscriptionAdapter } from "./adapter-types";
import { getFrozenTranscriptionPlan, transcribeAudioWithPlan } from "./router";

const SESSION_TTL_MS = 5 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;

interface TranscriptionSession {
  id: string;
  createdAt: number;
  plan: ReturnType<typeof getFrozenTranscriptionPlan>;
  adapter: ProviderTranscriptionAdapter | null;
  queuedWork: Promise<void>;
  startPromise: Promise<void>;
  adapterFailed: boolean;
  failureMessage: string | null;
}

const log = getLogger("session-manager");
const sessions = new Map<string, TranscriptionSession>();

export function beginTranscriptionSession(): RecordingSessionInfo {
  const settings = getSettings();
  const plan = getFrozenTranscriptionPlan(settings);

  if (!plan.activeProvider) {
    throw new Error(`No transcription provider is ready for ${plan.selectedProvider}. Configure the selected provider or enable an explicit backup.`);
  }

  const failureMessage =
    plan.activeProvider !== plan.selectedProvider
      ? `${plan.selectedProvider} is not ready. ${plan.activeProvider} backup will be used for this recording.`
      : null;
  const session: TranscriptionSession = {
    id: randomUUID(),
    createdAt: Date.now(),
    plan,
    adapter: null,
    queuedWork: Promise.resolve(),
    startPromise: Promise.resolve(),
    adapterFailed: false,
    failureMessage,
  };

  sessions.set(session.id, session);

  return {
    sessionId: session.id,
    selectedProvider: plan.selectedProvider,
    activeProvider: plan.activeProvider,
    adapterKind: plan.adapterKind,
    transport: plan.transport,
    captureSampleRate: plan.captureSampleRate,
    captureFormat: plan.captureFormat,
    chunkIntervalMs: plan.chunkIntervalMs,
    rollingWindowMs: plan.rollingWindowMs,
    overlapMs: plan.overlapMs,
    backupProviders: plan.backupProviders,
    selectedProviderUnavailable: plan.selectedProviderUnavailable,
  };
}

export function submitTranscriptionChunk(submission: RecordingChunkSubmission) {
  const session = getSession(submission.sessionId);

  if (!session || !session.adapter) {
    return;
  }

  session.queuedWork = session.queuedWork
    .then(async () => {
      if (session.adapterFailed) {
        return;
      }

      await session.startPromise;

      if (session.adapterFailed) {
        return;
      }

      await session.adapter!.pushChunk(submission);
    })
    .catch((error) => {
      session.adapterFailed = true;
      session.failureMessage = error instanceof Error ? error.message : "Chunk submission failed.";
      log.warn("Incremental adapter failed; falling back to batch on finish", {
        activeProvider: session.plan.activeProvider,
        chunkIndex: submission.chunkIndex,
        error,
        sessionId: session.id,
      });
    });
}

export async function finishTranscriptionSession(submission: RecordingFinishSubmission): Promise<TranscriptionResult> {
  const session = getRequiredSession(submission.sessionId);
  const settings = getSettings();
  const audioBuffer = Buffer.from(submission.audioBytes);

  try {
    await session.queuedWork;

    if (!session.adapterFailed && session.adapter) {
      try {
        const result = await session.adapter.finalize();
        return {
          provider: result.provider,
          model: result.model,
          text: result.text,
          rawText: result.rawText,
          durationMs: submission.durationMs,
          transcriptionMs: 0,
          usedFallback: result.provider !== session.plan.selectedProvider,
          selectedProvider: session.plan.selectedProvider,
          fallbackProvider: result.provider !== session.plan.selectedProvider ? result.provider : null,
          selectedProviderFailed: result.provider !== session.plan.selectedProvider,
          failureMessage: result.provider !== session.plan.selectedProvider ? session.failureMessage : null,
        };
      } catch (error) {
        session.adapterFailed = true;
        session.failureMessage = error instanceof Error ? error.message : "Adapter finalize failed.";
        log.warn("Incremental adapter finalize failed; attempting batch fallback", {
          activeProvider: session.plan.activeProvider,
          error,
          sessionId: session.id,
        });
      }
    }

    const failedProvider = session.adapterFailed ? session.plan.activeProvider ?? undefined : undefined;
    return transcribeAudioWithPlan(audioBuffer, submission.durationMs, settings, {
      selectedProvider: session.plan.selectedProvider,
      providerChain: buildBatchFallbackChain(session.plan, failedProvider),
      failureMessage: session.failureMessage,
    });
  } finally {
    await session.adapter?.close().catch((error) => {
      log.warn("Failed to close provider adapter cleanly", {
        error,
        sessionId: session.id,
      });
    });
    sessions.delete(session.id);
  }
}

function buildBatchFallbackChain(plan: ReturnType<typeof getFrozenTranscriptionPlan>, failedProvider?: string) {
  if (!plan.activeProvider) {
    return [];
  }

  return [plan.activeProvider, ...plan.backupProviders]
    .filter((provider) => provider !== failedProvider)
    .filter((provider, index, providers) => providers.indexOf(provider) === index);
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup() {
  if (cleanupInterval) {
    return;
  }

  cleanupInterval = setInterval(() => {
    const now = Date.now();

    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        log.warn("Cleaning up stale session", { sessionId, ageMs: now - session.createdAt });
        session.adapter?.close().catch(() => {});
        sessions.delete(sessionId);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
}

export function closeAllSessions() {
  for (const [sessionId, session] of sessions.entries()) {
    session.adapter?.close().catch(() => {});
    sessions.delete(sessionId);
  }

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

function getSession(sessionId: string) {
  return sessions.get(sessionId) ?? null;
}

function getRequiredSession(sessionId: string) {
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("Recording session not found.");
  }

  return session;
}
