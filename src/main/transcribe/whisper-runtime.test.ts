import assert from "node:assert/strict";
import test from "node:test";

import type { AppSettings } from "@shared/types";

import { transcribeWithPreferredWhisperRuntime } from "./whisper-runtime";

const BASE_SETTINGS: AppSettings = {
  defaultProvider: "whisper-local",
  fallbackEnabled: true,
  fallbackOrder: ["openai", "groq", "deepgram"],
  whisperModel: "ggml-small.en.bin",
  openaiModel: "gpt-4o-mini-transcribe",
  groqModel: "whisper-large-v3-turbo",
  deepgramModel: "nova-3",
  groqApiKey: "",
  openaiApiKey: "",
  deepgramApiKey: "",
  hotkey: "Alt+D",
  autoPaste: false,
  autoCopyClipboard: true,
  playSounds: false,
  aiTextPolish: false,
  showFloatingWidget: true,
  widgetPosition: { x: -1, y: -1 },
  selectedMicrophoneId: "",
  theme: "dark",
  improverTool: "claude",
  improverSystemPrompt: "",
  improverAutoCopy: true,
};

test("local whisper starts the persistent server on first use", async () => {
  const logEvents: unknown[][] = [];
  let serverStarts = 0;
  let cliCalls = 0;
  let serverCalls = 0;

  const result = await transcribeWithPreferredWhisperRuntime(1800, BASE_SETTINGS, {
    ensureServerReady: async () => {
      serverStarts += 1;
    },
    getServerStatus: () => ({
      activeModel: "",
      healthy: false,
      isStarting: false,
    }),
    logger: {
      error: (...args) => logEvents.push(args),
      info: (...args) => logEvents.push(args),
      warn: (...args) => logEvents.push(args),
    },
    modelPath: "D:/models/ggml-small.en.bin",
    now: createClock(),
    safeMode: false,
    transcribeWithCli: async () => {
      cliCalls += 1;
      return "cli fallback";
    },
    transcribeWithServer: async () => {
      serverCalls += 1;
      return "server text";
    },
  });

  assert.equal(result.text, "server text");
  assert.equal(serverStarts, 1);
  assert.equal(serverCalls, 1);
  assert.equal(cliCalls, 0);
  assert.ok(logEvents.some((event) => JSON.stringify(event).includes("server-start")));
});

test("local whisper reuses a warm server for later recordings", async () => {
  const logEvents: unknown[][] = [];
  let serverStarts = 0;
  let cliCalls = 0;
  let serverCalls = 0;

  const result = await transcribeWithPreferredWhisperRuntime(2200, BASE_SETTINGS, {
    ensureServerReady: async () => {
      serverStarts += 1;
    },
    getServerStatus: () => ({
      activeModel: "D:/models/ggml-small.en.bin",
      healthy: true,
      isStarting: false,
    }),
    logger: {
      error: (...args) => logEvents.push(args),
      info: (...args) => logEvents.push(args),
      warn: (...args) => logEvents.push(args),
    },
    modelPath: "D:/models/ggml-small.en.bin",
    now: createClock(),
    safeMode: false,
    transcribeWithCli: async () => {
      cliCalls += 1;
      return "cli fallback";
    },
    transcribeWithServer: async () => {
      serverCalls += 1;
      return "warm server text";
    },
  });

  assert.equal(result.text, "warm server text");
  assert.equal(serverStarts, 1);
  assert.equal(serverCalls, 1);
  assert.equal(cliCalls, 0);
  assert.ok(logEvents.some((event) => JSON.stringify(event).includes("server-reuse")));
});

test("local whisper falls back to cli when the server request fails", async () => {
  const logEvents: unknown[][] = [];
  let cliCalls = 0;
  let serverCalls = 0;

  const result = await transcribeWithPreferredWhisperRuntime(2500, BASE_SETTINGS, {
    ensureServerReady: async () => undefined,
    getServerStatus: () => ({
      activeModel: "",
      healthy: false,
      isStarting: false,
    }),
    logger: {
      error: (...args) => logEvents.push(args),
      info: (...args) => logEvents.push(args),
      warn: (...args) => logEvents.push(args),
    },
    modelPath: "D:/models/ggml-small.en.bin",
    now: createClock(),
    safeMode: false,
    transcribeWithCli: async () => {
      cliCalls += 1;
      return "cli recovered text";
    },
    transcribeWithServer: async () => {
      serverCalls += 1;
      throw new Error("server request failed");
    },
  });

  assert.equal(result.text, "cli recovered text");
  assert.equal(serverCalls, 1);
  assert.equal(cliCalls, 1);
  assert.ok(logEvents.some((event) => JSON.stringify(event).includes("cli-fallback")));
});

function createClock(step = 120) {
  let current = 1000;
  return () => {
    current += step;
    return current;
  };
}
