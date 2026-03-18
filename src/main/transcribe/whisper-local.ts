import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

import type { AppSettings, ProviderHealth, TranscriptionResult } from "@shared/types";
import { getLogger } from "@main/utils/logger";
import { ensureManagedWhisperAssets } from "@main/local-models";
import { isSafeModeEnabled } from "@main/utils/runtime-flags";
import { getWhisperExecutablePath, getWhisperModelPath, getWhisperWorkingDirectory } from "@main/utils/paths";
import { ensureServerReady, getWhisperServerStatus, WHISPER_SERVER_URL } from "./whisper-server";
import { transcribeWithPreferredWhisperRuntime } from "./whisper-runtime";

const log = getLogger("whisper-local");

export async function transcribeWithWhisper(buffer: Buffer, durationMs: number, settings: AppSettings): Promise<TranscriptionResult> {
  ensureManagedWhisperAssets();
  const binaryPath = getWhisperExecutablePath();
  const modelPath = getWhisperModelPath(settings.whisperModel);

  if (!fs.existsSync(binaryPath)) {
    throw new Error("Whisper binary is missing. Run npm run assets:download.");
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found: ${settings.whisperModel}`);
  }

  return transcribeWithPreferredWhisperRuntime(durationMs, settings, {
    ensureServerReady,
    getServerStatus: getWhisperServerStatus,
    logger: log,
    modelPath,
    safeMode: isSafeModeEnabled(),
    transcribeWithCli: () => transcribeWithWhisperCliBuffer(buffer, binaryPath, modelPath),
    transcribeWithServer: () => transcribeWithWhisperServer(buffer, settings),
  });
}

export async function warmWhisperServer(settings: AppSettings) {
  ensureManagedWhisperAssets();
  const modelPath = getWhisperModelPath(settings.whisperModel);
  await ensureServerReady(modelPath);
}

export async function transcribeWithWhisperServer(buffer: Buffer, settings: AppSettings, prompt?: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/wav" }), "recording.wav");
  form.append("temperature", "0");
  form.append("response-format", "json");
  form.append("no_timestamps", "true");
  form.append("language", "en");

  if (prompt?.trim()) {
    form.append("prompt", prompt.trim());
  }

  const response = await fetch(`${WHISPER_SERVER_URL}/inference`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    throw new Error(`Whisper server transcription failed (${response.status}).`);
  }

  const json = (await response.json()) as { text?: string };
  return json.text?.trim() ?? "";
}

async function transcribeWithWhisperCliBuffer(buffer: Buffer, binaryPath: string, modelPath: string) {
  const tmpDir = getWhisperWorkingDirectory();
  const tmpFileName = `craftvoice_${crypto.randomUUID()}.wav`;
  const tmpFilePath = path.join(tmpDir, tmpFileName);

  try {
    fs.writeFileSync(tmpFilePath, buffer);
    return await runWhisperCli(binaryPath, modelPath, tmpFilePath);
  } finally {
    try {
      fs.unlinkSync(tmpFilePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function runWhisperCli(binaryPath: string, modelPath: string, audioPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-m", modelPath,
      "-f", audioPath,
      "-l", "en",
      "--no-timestamps",
      "--no-prints",
    ];

    log.info(`Running whisper-cli with model: ${modelPath}`);

    execFile(binaryPath, args, {
      cwd: getWhisperWorkingDirectory(),
      windowsHide: true,
      timeout: 120000, // 2 minute timeout
    }, (error, stdout, stderr) => {
      if (error) {
        log.error("whisper-cli error", error);
        log.error("stderr:", stderr);
        reject(new Error(`Whisper CLI failed: ${error.message}`));
        return;
      }

      const text = stdout.trim();
      log.info(`Transcription result (${text.length} chars)`);
      resolve(text);
    });
  });
}

export function getWhisperHealth(settings: AppSettings): ProviderHealth {
  ensureManagedWhisperAssets();
  const binaryPath = getWhisperExecutablePath();
  const modelPath = getWhisperModelPath(settings.whisperModel);

  if (!fs.existsSync(binaryPath)) {
    return {
      provider: "whisper-local",
      configured: false,
      available: false,
      message: "Whisper runtime is missing. Install it from Settings.",
    };
  }

  if (!fs.existsSync(modelPath)) {
    return {
      provider: "whisper-local",
      configured: false,
      available: false,
      message: `Model missing: ${settings.whisperModel}`,
    };
  }

  return {
    provider: "whisper-local",
    configured: true,
    available: true,
    message: "Local whisper binary and model are present.",
  };
}
