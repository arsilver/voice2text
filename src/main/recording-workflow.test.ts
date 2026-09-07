import assert from "node:assert/strict";
import test from "node:test";

import { processRecordingSubmission } from "./recording-workflow";

test("processes batch recordings, copies text, and persists clipboard-only results", async () => {
  const clipboardWrites: string[] = [];
  const savedInputs: Array<{ finalText: string; rawText: string; wasPasted: boolean }> = [];
  const logEvents: unknown[][] = [];

  const result = await processRecordingSubmission(
    {
      recordingId: "rec-123",
      audioBytes: new Uint8Array(128).fill(1),
      durationMs: 1500,
      sampleRate: 16000,
    },
    {
      applyDictionary: (text) => text.replace("teh", "the"),
      logger: {
        info: (...args) => logEvents.push(args),
        error: (...args) => logEvents.push(args),
      },
      now: (() => {
        let current = 1000;
        return () => {
          current += 250;
          return current;
        };
      })(),
      saveToClipboard: (text) => {
        clipboardWrites.push(text);
      },
      saveTranscription: (input) => {
        savedInputs.push({
          finalText: input.finalText,
          rawText: input.rawText,
          wasPasted: input.wasPasted,
        });
        return { transcriptionMs: input.transcriptionMs };
      },
      transcribeAudio: async () => ({
        provider: "whisper-local",
        model: "ggml-small.en.bin",
        text: "teh quick brown fox",
        rawText: "teh quick brown fox",
        durationMs: 1500,
        transcriptionMs: 0,
        usedFallback: false,
        selectedProvider: "whisper-local",
        fallbackProvider: null,
        selectedProviderFailed: false,
        failureMessage: null,
      }),
    }
  );

  assert.equal(result.text, "the quick brown fox");
  assert.equal(result.wasPasted, false);
  assert.deepEqual(clipboardWrites, ["the quick brown fox"]);
  assert.deepEqual(savedInputs, [
    {
      finalText: "the quick brown fox",
      rawText: "teh quick brown fox",
      wasPasted: false,
    },
  ]);
  assert.ok(logEvents.some((event) => JSON.stringify(event).includes("transcription-start")));
  assert.ok(logEvents.some((event) => JSON.stringify(event).includes("clipboard-updated")));
});

test("rejects empty provider transcripts so silent captures surface as errors", async () => {
  await assert.rejects(
    () =>
      processRecordingSubmission(
        {
          recordingId: "rec-empty",
          audioBytes: new Uint8Array(100),
          durationMs: 1200,
          sampleRate: 16000,
        },
        {
          applyDictionary: (text) => text,
          logger: {
            info: () => undefined,
            error: () => undefined,
          },
          saveToClipboard: () => undefined,
          saveTranscription: () => ({ transcriptionMs: 0 }),
          transcribeAudio: async () => ({
            provider: "deepgram",
            model: "nova-3",
            text: "   ",
            rawText: "   ",
            durationMs: 1200,
            transcriptionMs: 40,
            usedFallback: false,
            selectedProvider: "deepgram",
            fallbackProvider: null,
            selectedProviderFailed: false,
            failureMessage: null,
          }),
        }
      ),
    /No speech detected/
  );
});
