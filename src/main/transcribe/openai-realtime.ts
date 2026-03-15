import { getLogger } from "@main/utils/logger";
import WebSocket from "ws";

import { createOpenAiRealtimeSocketConfig } from "./openai-realtime-config";
import {
  createOpenAiRealtimeSessionUpdate,
  OPENAI_REALTIME_QUIET_PERIOD_MS,
  shouldResolveOpenAiRealtimeDrain,
} from "./openai-realtime-protocol";
import { cleanTranscriptText } from "./transcript-merge";

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const READY_TIMEOUT_MS = 5000;
const DRAIN_TIMEOUT_MS = 6000;
const POLL_INTERVAL_MS = 100;
type OpenAiRealtimeItemStatus = "pending" | "completed" | "failed";

interface OpenAiRealtimeItem {
  commitIndex: number;
  previousItemId: string | null;
  transcript: string;
  status: OpenAiRealtimeItemStatus;
}

interface OpenAiRealtimeOptions {
  apiKey: string;
  model: string;
  onPartialTranscript?: (text: string) => void;
}

const log = getLogger("openai-realtime");

export class OpenAiRealtimeTranscriptionClient {
  private readonly options: OpenAiRealtimeOptions;
  private websocket: WebSocket | null = null;
  private readyDeferred = createDeferred<void>();
  private socketStarted = false;
  private sendQueue = Promise.resolve();
  private fatalError: Error | null = null;
  private isClosing = false;
  private clientAppendCount = 0;
  private serverCommitCount = 0;
  private lastItemError: string | null = null;
  private commitOrder: string[] = [];
  private items = new Map<string, OpenAiRealtimeItem>();
  private lastServerEventAt = 0;

  constructor(options: OpenAiRealtimeOptions) {
    this.options = options;
  }

  async warm() {
    await this.ensureReady();
  }

  async submitChunk(audioBytes: Uint8Array) {
    if (audioBytes.length === 0) {
      return;
    }

    await this.ensureReady();
    this.sendQueue = this.sendQueue.then(async () => {
      this.throwIfFatal();
      this.sendJson({
        type: "input_audio_buffer.append",
        audio: Buffer.from(audioBytes).toString("base64"),
      });
      this.clientAppendCount += 1;
    });

    return this.sendQueue;
  }

  async finalize() {
    await this.ensureReady();
    await this.sendQueue;

    if (this.clientAppendCount > 0) {
      this.sendJson({ type: "input_audio_buffer.commit" });
    }

    await waitForCondition(
      () =>
        shouldResolveOpenAiRealtimeDrain({
          clientCommitCount: this.clientAppendCount > 0 ? 1 : 0,
          serverCommitCount: this.serverCommitCount,
          pendingItemCount: this.getPendingItemCount(),
          failedItemCount: this.getFailedItemCount(),
          lastServerEventAt: this.lastServerEventAt,
          now: Date.now(),
          quietPeriodMs: OPENAI_REALTIME_QUIET_PERIOD_MS,
        }),
      DRAIN_TIMEOUT_MS,
      `OpenAI realtime transcription did not finish in time. ${this.describeState()}`
    );
    this.throwIfFatal();

    for (const [itemId, item] of this.items.entries()) {
      log.info("finalize-item", { itemId: itemId.slice(0, 12), status: item.status, transcriptLen: item.transcript.length, commitIndex: item.commitIndex });
    }

    const failedItemCount = this.getFailedItemCount();

    if (failedItemCount > 0 && failedItemCount === this.items.size) {
      await this.close();
      const reason = this.lastItemError ? ` Reason: ${this.lastItemError}` : "";
      throw new Error(`OpenAI realtime: all ${this.items.size} items failed.${reason} ${this.describeState()}`);
    }

    if (failedItemCount > 0) {
      log.warn("OpenAI realtime had partial failures", { failedItemCount, totalItems: this.items.size, items: this.describeItems() });
    }

    const merged = buildOrderedTranscript(this.items, this.commitOrder);
    const hasPendingItems = this.getPendingItemCount() > 0;
    await this.close();

    if (!merged) {
      throw new Error(`OpenAI realtime returned no transcript. ${this.describeState()} items=[${this.describeItems()}]`);
    }

    if (hasPendingItems) {
      log.warn("OpenAI realtime drained with unresolved items; using best-effort transcript", this.describeState());
    }

    return merged;
  }

  async close() {
    this.isClosing = true;

    if (!this.websocket || this.websocket.readyState === WebSocket.CLOSED) {
      return;
    }

    await new Promise<void>((resolve) => {
      const socket = this.websocket;

      if (!socket) {
        resolve();
        return;
      }

      socket.once("close", () => {
        resolve();
      });
      socket.close(1000, "done");
    });
  }

  private async ensureReady() {
    if (!this.socketStarted) {
      this.openSocket();
    }

    await Promise.race([
      this.readyDeferred.promise,
      timeout(READY_TIMEOUT_MS, "OpenAI realtime connection did not become ready."),
    ]);
    this.throwIfFatal();
  }

  private openSocket() {
    this.socketStarted = true;

    const socket = new WebSocket(OPENAI_REALTIME_URL, createOpenAiRealtimeSocketConfig(this.options.apiKey));
    this.websocket = socket;

    socket.once("open", () => {
      this.sendJson(createOpenAiRealtimeSessionUpdate(this.options.model));
    });

    socket.on("message", (data) => {
      this.handleMessage(data);
    });

    socket.once("error", (error) => {
      this.setFatalError(error instanceof Error ? error : new Error("OpenAI realtime websocket reported an error."));
    });

    socket.once("close", (code) => {
      if (this.isClosing || code === 1000) {
        return;
      }

      this.setFatalError(new Error(`OpenAI realtime websocket closed unexpectedly (${code}).`));
    });
  }

  private handleMessage(rawData: unknown) {
    try {
      const payload = parseRealtimeMessage(rawData);
      const eventType = asString(payload.type);
      this.lastServerEventAt = Date.now();

      switch (eventType) {
        case "session.created":
        case "transcription_session.created":
          return;
        case "session.updated":
        case "transcription_session.updated":
          this.readyDeferred.resolve();
          return;
        case "input_audio_buffer.committed": {
          const itemId = asString(payload.item_id);

          this.serverCommitCount += 1;
          this.commitOrder.push(itemId);
          this.items.set(itemId, {
            commitIndex: this.commitOrder.length - 1,
            previousItemId: asNullableString(payload.previous_item_id),
            transcript: this.items.get(itemId)?.transcript ?? "",
            status: this.items.get(itemId)?.status ?? "pending",
          });
          return;
        }
        case "conversation.item.input_audio_transcription.delta": {
          const itemId = asString(payload.item_id);
          const existing = this.items.get(itemId);

          this.items.set(itemId, {
            commitIndex: existing?.commitIndex ?? this.commitOrder.length,
            previousItemId: existing?.previousItemId ?? null,
            transcript: cleanTranscriptText(`${existing?.transcript ?? ""} ${asString(payload.delta)}`),
            status: existing?.status ?? "pending",
          });

          if (this.options.onPartialTranscript) {
            const partial = buildOrderedTranscript(this.items, this.commitOrder);
            if (partial) {
              this.options.onPartialTranscript(partial);
            }
          }
          return;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const itemId = asString(payload.item_id);
          const existing = this.items.get(itemId);

          this.items.set(itemId, {
            commitIndex: existing?.commitIndex ?? this.commitOrder.length,
            previousItemId: existing?.previousItemId ?? null,
            transcript: cleanTranscriptText(asString(payload.transcript)),
            status: "completed",
          });
          return;
        }
        case "conversation.item.input_audio_transcription.failed": {
          const itemId = asString(payload.item_id);
          const existing = this.items.get(itemId);
          const errorMessage = asErrorMessage(payload.error);

          this.items.set(itemId, {
            commitIndex: existing?.commitIndex ?? this.commitOrder.length,
            previousItemId: existing?.previousItemId ?? null,
            transcript: existing?.transcript ?? "",
            status: "failed",
          });

          if (!this.lastItemError) {
            this.lastItemError = errorMessage;
          }

          log.warn("OpenAI realtime item failed", {
            itemId,
            error: payload.error,
            errorMessage,
          });
          return;
        }
        case "input_audio_buffer.speech_started":
          log.info("Speech started (server_vad)");
          return;
        case "input_audio_buffer.speech_stopped":
          log.info("Speech stopped (server_vad)");
          return;
        case "error":
          this.setFatalError(new Error(asErrorMessage(payload.error)));
          return;
        default:
          return;
      }
    } catch (error) {
      this.setFatalError(error instanceof Error ? error : new Error("Failed to parse OpenAI realtime event."));
    }
  }

  private sendJson(payload: Record<string, unknown>) {
    this.throwIfFatal();

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error("OpenAI realtime websocket is not open.");
    }

    this.websocket.send(JSON.stringify(payload));
  }

  private setFatalError(error: Error) {
    if (this.fatalError) {
      return;
    }

    this.fatalError = error;
    this.readyDeferred.reject(error);
    log.warn("OpenAI realtime session failed", error);
  }

  private throwIfFatal() {
    if (this.fatalError) {
      throw this.fatalError;
    }
  }

  private getPendingItemCount() {
    let pendingCount = 0;

    for (const item of this.items.values()) {
      if (item.status === "pending") {
        pendingCount += 1;
      }
    }

    return pendingCount;
  }

  private getFailedItemCount() {
    let failedCount = 0;

    for (const item of this.items.values()) {
      if (item.status === "failed") {
        failedCount += 1;
      }
    }

    return failedCount;
  }

  private describeState() {
    return `clientAppends=${this.clientAppendCount}, serverCommits=${this.serverCommitCount}, items=${this.items.size}, pendingItems=${this.getPendingItemCount()}, failedItems=${this.getFailedItemCount()}`;
  }

  private describeItems() {
    const summary: string[] = [];

    for (const [itemId, item] of this.items.entries()) {
      summary.push(`${itemId.slice(0, 8)}:${item.status}(len=${item.transcript.length})`);
    }

    return summary.join(", ");
  }
}

function parseRealtimeMessage(rawData: unknown) {
  if (typeof rawData === "string") {
    return JSON.parse(rawData) as { type: string; [key: string]: unknown };
  }

  if (Buffer.isBuffer(rawData)) {
    return JSON.parse(rawData.toString("utf8")) as { type: string; [key: string]: unknown };
  }

  if (rawData instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(rawData).toString("utf8")) as { type: string; [key: string]: unknown };
  }

  if (ArrayBuffer.isView(rawData)) {
    return JSON.parse(Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString("utf8")) as {
      type: string;
      [key: string]: unknown;
    };
  }

  if (Array.isArray(rawData)) {
    return JSON.parse(Buffer.concat(rawData).toString("utf8")) as { type: string; [key: string]: unknown };
  }

  throw new Error("Unsupported OpenAI realtime message payload.");
}


function buildOrderedTranscript(items: Map<string, OpenAiRealtimeItem>, commitOrder: string[]) {
  if (items.size === 0) {
    return "";
  }

  const childrenByPrevious = new Map<string | null, string[]>();

  for (const [itemId, item] of items.entries()) {
    const key = item.previousItemId ?? null;
    const bucket = childrenByPrevious.get(key) ?? [];
    bucket.push(itemId);
    childrenByPrevious.set(key, bucket);
  }

  for (const bucket of childrenByPrevious.values()) {
    bucket.sort((left, right) => (items.get(left)?.commitIndex ?? 0) - (items.get(right)?.commitIndex ?? 0));
  }

  const ordered: string[] = [];
  const seen = new Set<string>();

  function walk(previousItemId: string | null) {
    for (const itemId of childrenByPrevious.get(previousItemId) ?? []) {
      if (seen.has(itemId)) {
        continue;
      }

      seen.add(itemId);
      ordered.push(itemId);
      walk(itemId);
    }
  }

  walk(null);

  for (const itemId of commitOrder) {
    if (!seen.has(itemId)) {
      ordered.push(itemId);
    }
  }

  return ordered
    .map((itemId) => cleanTranscriptText(items.get(itemId)?.transcript ?? ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asErrorMessage(value: unknown) {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }

  return "OpenAI realtime transcription failed.";
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function timeout(ms: number, message: string) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number, timeoutMessage: string) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(timeoutMessage);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
