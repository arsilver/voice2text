import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getSettings } from "@main/db/settings";
import { getLogger } from "@main/utils/logger";
import {
  getBundledWhisperExecutablePath,
  getBundledWhisperModelPath,
  getBundledWhisperModelsDir,
  getManagedResourcesRoot,
  getTempDir,
  getWhisperExecutablePath,
  getWhisperModelPath,
  getWhisperModelsDir,
  getWhisperWorkingDirectory,
} from "@main/utils/paths";
import { broadcast } from "@main/windows";
import { IPC_CHANNELS, type LocalModelInfo, type LocalModelProgress } from "@shared/types";
import { LOCAL_WHISPER_PRESETS } from "@shared/provider-presets";

import { getWhisperServerStatus } from "./transcribe/whisper-server";

const log = getLogger("local-models");
const execFileAsync = promisify(execFile);
const WHISPER_BINARY_RELEASE_URL = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip";

export function ensureManagedWhisperAssets() {
  ensureManagedRuntimeFromBundled();
  ensureManagedModelsFromBundled();
}

export function listLocalModels(): LocalModelInfo[] {
  ensureManagedWhisperAssets();

  const settings = getSettings();
  const serverStatus = getWhisperServerStatus();

  return LOCAL_WHISPER_PRESETS.map((preset) => {
    const modelPath = getWhisperModelPath(preset.model);
    const installed = fs.existsSync(modelPath);
    const warm = installed && serverStatus.healthy && serverStatus.activeModel === modelPath;
    const sizeBytes = installed ? fs.statSync(modelPath).size : preset.sizeBytes;

    return {
      id: preset.model,
      label: preset.label,
      description: preset.description,
      installed,
      selected: settings.whisperModel === preset.model,
      warm,
      source: installed ? "managed" : null,
      sizeBytes,
    };
  });
}

export async function installLocalModel(modelId: string) {
  const preset = getRequiredPreset(modelId);
  ensureManagedWhisperAssets();

  try {
    emitProgress({
      modelId,
      stage: "installing",
      downloadedBytes: 0,
      totalBytes: null,
      message: "Preparing Whisper runtime...",
    });

    await ensureRuntimeInstalled();

    const destination = getWhisperModelPath(preset.model);
    if (!fs.existsSync(destination)) {
      const bundledPath = getBundledWhisperModelPath(preset.model);

      if (fs.existsSync(bundledPath)) {
        fs.copyFileSync(bundledPath, destination);
      } else {
        await downloadToFile(preset.downloadUrl, destination, (downloadedBytes, totalBytes) => {
          emitProgress({
            modelId,
            stage: "downloading",
            downloadedBytes,
            totalBytes,
            message: `Downloading ${preset.label}...`,
          });
        });
      }
    }

    emitProgress({
      modelId,
      stage: "ready",
      downloadedBytes: fs.statSync(destination).size,
      totalBytes: fs.statSync(destination).size,
      message: `${preset.label} is ready.`,
    });
  } catch (error) {
    emitProgress({
      modelId,
      stage: "error",
      downloadedBytes: 0,
      totalBytes: null,
      message: error instanceof Error ? error.message : "Model install failed.",
    });
    throw error;
  }
}

export async function removeLocalModel(modelId: string) {
  const settings = getSettings();

  if (settings.whisperModel === modelId) {
    throw new Error("Select a different local model before removing this one.");
  }

  const modelPath = getWhisperModelPath(modelId);
  if (fs.existsSync(modelPath)) {
    fs.unlinkSync(modelPath);
  }
}

async function ensureRuntimeInstalled() {
  const binaryPath = getWhisperExecutablePath();
  if (fs.existsSync(binaryPath)) {
    return;
  }

  const bundledBinaryPath = getBundledWhisperExecutablePath();
  if (fs.existsSync(bundledBinaryPath)) {
    ensureManagedRuntimeFromBundled();
    return;
  }

  const tempZipPath = path.join(getTempDir(), "whisper-bin-x64.zip");
  await downloadToFile(WHISPER_BINARY_RELEASE_URL, tempZipPath, (downloadedBytes, totalBytes) => {
    emitProgress({
      modelId: "runtime",
      stage: "downloading",
      downloadedBytes,
      totalBytes,
      message: "Downloading Whisper runtime...",
    });
  });

  emitProgress({
    modelId: "runtime",
    stage: "installing",
    downloadedBytes: 0,
    totalBytes: null,
    message: "Installing Whisper runtime...",
  });

  const whisperRoot = path.join(getManagedResourcesRoot(), "whisper");
  fs.mkdirSync(whisperRoot, { recursive: true });

  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Force -Path '${tempZipPath.replace(/'/g, "''")}' -DestinationPath '${whisperRoot.replace(/'/g, "''")}'`,
    ],
    { windowsHide: true }
  );
}

function ensureManagedRuntimeFromBundled() {
  const sourceRoot = path.dirname(path.dirname(getBundledWhisperExecutablePath()));
  const destinationRoot = path.dirname(path.dirname(getWhisperExecutablePath()));

  if (!fs.existsSync(sourceRoot) || fs.existsSync(destinationRoot)) {
    return;
  }

  fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
  fs.cpSync(sourceRoot, destinationRoot, { recursive: true });
  log.info("Migrated Whisper runtime to managed storage", {
    sourceRoot,
    destinationRoot,
  });
}

function ensureManagedModelsFromBundled() {
  const sourceDir = getBundledWhisperModelsDir();
  const destinationDir = getWhisperModelsDir();

  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".bin")) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (!fs.existsSync(destinationPath)) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

async function downloadToFile(
  url: string,
  destinationPath: string,
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void
) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}.`);
  }

  const totalBytesHeader = response.headers.get("content-length");
  const totalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : null;
  const reader = response.body.getReader();
  const output = fs.createWriteStream(destinationPath);
  let downloadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      output.write(Buffer.from(value));
      downloadedBytes += value.byteLength;
      onProgress(downloadedBytes, totalBytes);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function emitProgress(progress: LocalModelProgress) {
  broadcast(IPC_CHANNELS.settingsLocalModelProgress, progress);
}

function getRequiredPreset(modelId: string) {
  const preset = LOCAL_WHISPER_PRESETS.find((item) => item.model === modelId);

  if (!preset) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  return preset;
}
