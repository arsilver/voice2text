import test from "node:test";
import assert from "node:assert/strict";

import type { AppSettings } from "../../shared/types";
import { resolveSessionTranscriptionPlan } from "./session-plan";

const BASE_SETTINGS: Pick<AppSettings, "defaultProvider" | "fallbackEnabled" | "fallbackOrder"> = {
  defaultProvider: "whisper-local",
  fallbackEnabled: true,
  fallbackOrder: ["openai", "groq", "deepgram"],
};

test("uses the selected whisper provider when it is available", () => {
  const plan = resolveSessionTranscriptionPlan(BASE_SETTINGS, {
    "whisper-local": true,
    openai: true,
    groq: false,
    deepgram: false,
  });

  assert.equal(plan.selectedProvider, "whisper-local");
  assert.equal(plan.activeProvider, "whisper-local");
  assert.equal(plan.adapterKind, "batch-upload");
  assert.equal(plan.chunkIntervalMs, 0);
  assert.deepEqual(plan.backupProviders, ["openai"]);
});

test("uses the selected OpenAI provider with explicit backups", () => {
  const plan = resolveSessionTranscriptionPlan(
    {
      ...BASE_SETTINGS,
      defaultProvider: "openai",
    },
    {
      "whisper-local": true,
      openai: true,
      groq: true,
      deepgram: false,
    }
  );

  assert.equal(plan.selectedProvider, "openai");
  assert.equal(plan.activeProvider, "openai");
  assert.equal(plan.adapterKind, "batch-upload");
  assert.equal(plan.chunkIntervalMs, 0);
  assert.deepEqual(plan.backupProviders, ["groq", "whisper-local"]);
});

test("uses the selected Groq provider with rolling chunks", () => {
  const plan = resolveSessionTranscriptionPlan(
    {
      ...BASE_SETTINGS,
      defaultProvider: "groq",
    },
    {
      "whisper-local": true,
      openai: true,
      groq: true,
      deepgram: false,
    }
  );

  assert.equal(plan.selectedProvider, "groq");
  assert.equal(plan.activeProvider, "groq");
  assert.equal(plan.adapterKind, "batch-upload");
  assert.equal(plan.chunkIntervalMs, 0);
});

test("promotes an explicit backup when the selected provider is unavailable", () => {
  const plan = resolveSessionTranscriptionPlan(
    {
      ...BASE_SETTINGS,
      defaultProvider: "openai",
    },
    {
      "whisper-local": true,
      openai: false,
      groq: true,
      deepgram: false,
    }
  );

  assert.equal(plan.selectedProvider, "openai");
  assert.equal(plan.activeProvider, "groq");
  assert.equal(plan.selectedProviderUnavailable, true);
  assert.equal(plan.adapterKind, "batch-upload");
  assert.deepEqual(plan.backupProviders, ["whisper-local"]);
});

test("returns no active provider when nothing is available and backups are off", () => {
  const plan = resolveSessionTranscriptionPlan(
    {
      defaultProvider: "openai",
      fallbackEnabled: false,
      fallbackOrder: ["groq", "deepgram"],
    },
    {
      "whisper-local": false,
      openai: false,
      groq: false,
      deepgram: false,
    }
  );

  assert.equal(plan.selectedProvider, "openai");
  assert.equal(plan.activeProvider, null);
  assert.equal(plan.adapterKind, "batch-upload");
  assert.equal(plan.selectedProviderUnavailable, true);
  assert.deepEqual(plan.backupProviders, []);
});

test("appends local Whisper as an explicit last backup when available", () => {
  const plan = resolveSessionTranscriptionPlan(
    {
      defaultProvider: "deepgram",
      fallbackEnabled: true,
      fallbackOrder: ["openai", "groq"],
    },
    {
      "whisper-local": true,
      openai: true,
      groq: true,
      deepgram: true,
    }
  );

  assert.deepEqual(plan.backupProviders, ["openai", "groq", "whisper-local"]);
});
