import test from "node:test";
import assert from "node:assert/strict";

import { cleanTranscriptText, getPromptTail, mergeTranscriptText } from "./transcript-merge";

test("removes blank audio markers and normalizes whitespace", () => {
  assert.equal(cleanTranscriptText("  hello   [BLANK_AUDIO]\nworld  "), "hello world");
});

test("merges overlapping chunk text without duplicating shared words", () => {
  assert.equal(
    mergeTranscriptText("hello world this is", "world this is a test"),
    "hello world this is a test"
  );
});

test("keeps both sides when there is no reliable overlap", () => {
  assert.equal(
    mergeTranscriptText("open the settings panel", "and click the microphone toggle"),
    "open the settings panel and click the microphone toggle"
  );
});

test("limits prompt context to the tail of the merged transcript", () => {
  const prompt = getPromptTail("alpha beta gamma delta epsilon", 16);
  assert.equal(prompt, "delta epsilon");
});
