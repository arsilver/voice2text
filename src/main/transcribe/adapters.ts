import WebSocket from "ws";

import { getLogger } from "@main/utils/logger";
import type { AppSettings, RecordingChunkSubmission } from "@shared/types";

import type { AdapterFinalizeResult, PartialTranscriptCallback, ProviderTranscriptionAdapter } from "./adapter-types";
import { SegmentLedger } from "./segment-ledger";
import { getPromptTail } from "./transcript-merge";
import { warmWhisperServer } from "./whisper-local";

const log = getLogger("transcribe-adapters");
const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";

export class DeepgramLiveAdapter implements ProviderTranscriptionAdapter {
  readonly provider = "deepgram" as const;
  readonly adapterKind = "deepgram-live" as const;
  readonly model: string;

  private websocket: WebSocket | null = null;
  private readonly readyDeferred = createDeferred<void>();
  private readonly ledger = new SegmentLedger();
  private fatalError: Error | null = null;
  private socketStarted = false;
  private isClosing = false;
  private lastServerEventAt = 0;
  private nextSegmentIndex = 0;

  constructor(private readonly settings: AppSettings) {
    this.model = settings.deepgramModel;
  }

  async start() {
    if (!this.socketStarted) {
      this.openSocket();
    }

    await this.readyDeferred.promise;
    this.throwIfFatal();
  }

  async pushChunk(submission: RecordingChunkSubmission) {
    if (submission.format !== "pcm16") {
      throw new Error("Deepgram live transcription requires pcm16 chunks.");
    }

    await this.start();
    this.throwIfFatal();

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error("Deepgram websocket is not open.");
    }

    this.websocket.send(Buffer.from(submission.audioBytes));
  }

  async finalize(): Promise<AdapterFinalizeResult> {
    await this.start();
    this.throwIfFatal();

    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({ type: "Finalize" }));
    }

    await waitForCondition(() => Date.now() - this.lastServerEventAt >= 700, 5000, "Deepgram live transcription did not settle in time.");
    this.throwIfFatal();
    const rawText = this.ledger.buildTranscript();

    if (!rawText) {
      throw new Error("Deepgram live transcription returned no transcript.");
    }

    return {
      provider: this.provider,
      model: this.model,
      text: rawText,
      rawText,
    };
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

      socket.once("close", () => resolve());
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "CloseStream" }));
      }
      socket.close(1000, "done");
    });
  }

  private openSocket() {
    this.socketStarted = true;
    this.lastServerEventAt = Date.now();

    const searchParams = new URLSearchParams({
      model: this.settings.deepgramModel,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      language: "en-US",
      interim_results: "true",
      smart_format: "true",
      endpointing: "300",
    });

    const socket = new WebSocket(`${DEEPGRAM_WS_URL}?${searchParams.toString()}`, {
      headers: {
        Authorization: `Token ${this.settings.deepgramApiKey}`,
      },
      perMessageDeflate: false,
    });

    this.websocket = socket;

    socket.once("open", () => {
      this.readyDeferred.resolve();
    });

    socket.on("message", (rawData) => {
      this.lastServerEventAt = Date.now();

      try {
        const payload = parseJsonMessage(rawData) as DeepgramLiveMessage;

        if (payload.type === "Results") {
          const transcript = payload.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
          if (payload.is_final && transcript) {
            this.ledger.setText(this.nextSegmentIndex, transcript);
            this.nextSegmentIndex += 1;
          }
          return;
        }

        if (payload.type === "Error") {
          this.setFatalError(new Error(payload.message ?? "Deepgram live transcription failed."));
        }
      } catch (error) {
        this.setFatalError(error instanceof Error ? error : new Error("Failed to parse Deepgram live event."));
      }
    });

    socket.once("error", (error) => {
      this.setFatalError(error instanceof Error ? error : new Error("Deepgram websocket reported an error."));
    });

    socket.once("close", (code) => {
      if (this.isClosing || code === 1000) {
        return;
      }

      this.setFatalError(new Error(`Deepgram websocket closed unexpectedly (${code}).`));
    });
  }

  private setFatalError(error: Error) {
    if (this.fatalError) {
      return;
    }

    this.fatalError = error;
    this.readyDeferred.reject(error);
    log.warn("Deepgram live session failed", error);
  }

  private throwIfFatal() {
    if (this.fatalError) {
      throw this.fatalError;
    }
  }
}

export class RollingWindowAdapter implements ProviderTranscriptionAdapter {
  readonly adapterKind: "whisper-rolling" | "openai-rolling" | "groq-rolling";
  readonly model: string;

  private readonly ledger = new SegmentLedger();
  private queuedWork = Promise.resolve();
  private fatalError: Error | null = null;

  constructor(
    readonly provider: "whisper-local" | "openai" | "groq",
    private readonly settings: AppSettings,
    private readonly transcribeWindow: (buffer: Buffer, prompt: string | undefined) => Promise<string>
  ) {
    this.adapterKind = provider === "whisper-local" ? "whisper-rolling" : provider === "openai" ? "openai-rolling" : "groq-rolling";
    this.model = provider === "whisper-local" ? settings.whisperModel : provider === "openai" ? settings.openaiModel : settings.groqModel;
  }

  async start() {
    if (this.provider === "whisper-local") {
      await warmWhisperServer(this.settings);
    }
  }

  async pushChunk(submission: RecordingChunkSubmission) {
    if (submission.format !== "wav") {
      throw new Error(`${this.provider} rolling transcription requires wav chunks.`);
    }

    this.ledger.markPending(submission.chunkIndex);

    this.queuedWork = this.queuedWork.then(async () => {
      this.throwIfFatal();
      const prompt = getPromptTail(this.ledger.buildTranscript());
      const rawText = await this.transcribeWindow(Buffer.from(submission.audioBytes), prompt || undefined);
      this.ledger.setText(submission.chunkIndex, rawText);
    });

    await this.queuedWork.catch((error) => {
      this.fatalError = error instanceof Error ? error : new Error(`${this.provider} rolling transcription failed.`);
      throw this.fatalError;
    });
  }

  async finalize(): Promise<AdapterFinalizeResult> {
    await this.queuedWork;
    this.throwIfFatal();

    const rawText = this.ledger.buildTranscript();
    if (!rawText) {
      throw new Error(`${this.provider} rolling transcription returned no transcript.`);
    }

    return {
      provider: this.provider,
      model: this.model,
      text: rawText,
      rawText,
    };
  }

  async close() {}

  private throwIfFatal() {
    if (this.fatalError) {
      throw this.fatalError;
    }
  }
}

export async function transcribeOpenAiWindow(buffer: Buffer, settings: AppSettings, prompt?: string) {
  if (!settings.openaiApiKey) {
    throw new Error("Missing OpenAI API key.");
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/wav" }), "recording.wav");
  form.append("model", settings.openaiModel);

  if (prompt?.trim()) {
    form.append("prompt", prompt.trim());
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`OpenAI rolling transcription failed (${response.status}).`);
  }

  const json = (await response.json()) as { text?: string };
  return json.text?.trim() ?? "";
}

export async function transcribeGroqWindow(buffer: Buffer, settings: AppSettings, prompt?: string) {
  if (!settings.groqApiKey) {
    throw new Error("Missing Groq API key.");
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/wav" }), "recording.wav");
  form.append("model", settings.groqModel);

  if (prompt?.trim()) {
    form.append("prompt", prompt.trim());
  }

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.groqApiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Groq rolling transcription failed (${response.status}).`);
  }

  const json = (await response.json()) as { text?: string };
  return json.text?.trim() ?? "";
}

function parseJsonMessage(rawData: WebSocket.RawData) {
  if (typeof rawData === "string") {
    return JSON.parse(rawData) as { type?: string };
  }

  if (Buffer.isBuffer(rawData)) {
    return JSON.parse(rawData.toString("utf8")) as { type?: string };
  }

  if (Array.isArray(rawData)) {
    return JSON.parse(Buffer.concat(rawData).toString("utf8")) as { type?: string };
  }

  return JSON.parse(Buffer.from(rawData).toString("utf8")) as { type?: string };
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

async function waitForCondition(predicate: () => boolean, timeoutMs: number, timeoutMessage: string) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(timeoutMessage);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface DeepgramLiveMessage {
  type?: string;
  is_final?: boolean;
  message?: string;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
}
