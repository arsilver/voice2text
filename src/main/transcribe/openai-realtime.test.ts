import assert from "node:assert/strict";
import test from "node:test";

import { createOpenAiRealtimeSocketConfig } from "./openai-realtime-config";
import { createOpenAiRealtimeSessionUpdate, shouldResolveOpenAiRealtimeDrain } from "./openai-realtime-protocol";

test("builds realtime websocket headers with bearer auth", () => {
  const socketConfig = createOpenAiRealtimeSocketConfig("test-key");

  assert.equal(socketConfig.headers.Authorization, "Bearer test-key");
  assert.equal(socketConfig.headers["OpenAI-Beta"], undefined);
  assert.equal(socketConfig.perMessageDeflate, false);
});

test("builds GA session update payload for transcription with server_vad", () => {
  const payload = createOpenAiRealtimeSessionUpdate("gpt-4o-transcribe");

  assert.equal(payload.type, "session.update");
  assert.equal(payload.session.type, "transcription");
  assert.equal(payload.session.audio.input.format.type, "audio/pcm");
  assert.equal(payload.session.audio.input.format.rate, 24000);
  assert.equal(payload.session.audio.input.transcription.model, "gpt-4o-transcribe");
  assert.equal(payload.session.audio.input.transcription.language, "en");
  assert.equal(payload.session.audio.input.noise_reduction.type, "near_field");
  assert.deepEqual(payload.session.audio.input.turn_detection, {
    type: "server_vad",
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
  });
});

test("waits for quiet period when no commits at all (no speech detected)", () => {
  assert.equal(
    shouldResolveOpenAiRealtimeDrain({
      clientCommitCount: 0,
      serverCommitCount: 0,
      pendingItemCount: 0,
      failedItemCount: 0,
      lastServerEventAt: 1000,
      now: 1100,
    }),
    false
  );

  assert.equal(
    shouldResolveOpenAiRealtimeDrain({
      clientCommitCount: 0,
      serverCommitCount: 0,
      pendingItemCount: 0,
      failedItemCount: 0,
      lastServerEventAt: 1000,
      now: 3000,
      quietPeriodMs: 1500,
    }),
    true
  );
});

test("resolves immediately when all items completed with no pending", () => {
  assert.equal(
    shouldResolveOpenAiRealtimeDrain({
      clientCommitCount: 1,
      serverCommitCount: 2,
      pendingItemCount: 0,
      failedItemCount: 0,
      lastServerEventAt: 1000,
      now: 1100,
    }),
    true
  );
});

test("resolves immediately when all items failed with no pending", () => {
  assert.equal(
    shouldResolveOpenAiRealtimeDrain({
      clientCommitCount: 1,
      serverCommitCount: 3,
      pendingItemCount: 0,
      failedItemCount: 3,
      lastServerEventAt: 1000,
      now: 1100,
    }),
    true
  );
});

test("waits for pending items even with some failures", () => {
  assert.equal(
    shouldResolveOpenAiRealtimeDrain({
      clientCommitCount: 1,
      serverCommitCount: 3,
      pendingItemCount: 1,
      failedItemCount: 1,
      lastServerEventAt: Date.now(),
      now: Date.now(),
    }),
    false
  );
});

test("resolves with pending items after quiet period", () => {
  assert.equal(
    shouldResolveOpenAiRealtimeDrain({
      clientCommitCount: 1,
      serverCommitCount: 3,
      pendingItemCount: 1,
      failedItemCount: 1,
      lastServerEventAt: 1000,
      now: 3000,
      quietPeriodMs: 1500,
    }),
    true
  );
});

test("resolves when server_vad detected turns but all completed", () => {
  assert.equal(
    shouldResolveOpenAiRealtimeDrain({
      clientCommitCount: 0,
      serverCommitCount: 3,
      pendingItemCount: 0,
      failedItemCount: 0,
      lastServerEventAt: 1000,
      now: 1100,
    }),
    true
  );
});
