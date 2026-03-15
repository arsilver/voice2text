import fs from "node:fs";
import { spawn } from "node:child_process";

import { getLogger } from "@main/utils/logger";
import { getWhisperExecutablePath, getWhisperWorkingDirectory } from "@main/utils/paths";

const log = getLogger("whisper-server");

let serverProcess: ReturnType<typeof spawn> | null = null;
let activeModel = "";
let isStarting = false;
let startPromise: Promise<void> | null = null;

// The whisper server runs on localhost. Port 8080 is the default.
export const WHISPER_SERVER_URL = "http://127.0.0.1:8080";

export async function ensureServerReady(modelPath: string): Promise<void> {
  const binaryPath = getWhisperExecutablePath().replace("whisper-cli.exe", "whisper-server.exe");

  if (!fs.existsSync(binaryPath)) {
    throw new Error("Whisper server binary is missing. Run npm run assets:download.");
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found: ${modelPath}`);
  }

  // If already running with the correct model, just ensure it's healthy
  if (serverProcess && activeModel === modelPath) {
    if (await checkHealth()) {
      return;
    }
    // If unhealthy, kill it and restart
    log.warn("Server was running but reported unhealthy. Restarting...");
    await stopServer();
  }

  // If a different model is requested, restart the server
  if (serverProcess && activeModel !== modelPath) {
    log.info(`Model changed from ${activeModel} to ${modelPath}. Restarting server...`);
    await stopServer();
  }

  // If another request triggered a start, wait for it
  if (isStarting && startPromise) {
    return startPromise;
  }

  isStarting = true;
  startPromise = startServerInternal(binaryPath, modelPath);

  try {
    await startPromise;
  } finally {
    isStarting = false;
    startPromise = null;
  }
}

async function startServerInternal(binaryPath: string, modelPath: string): Promise<void> {
  log.info(`Starting persistent Whisper server with model: ${modelPath}`);

  return new Promise((resolve, reject) => {
    // Basic server options. 
    // -m: model
    // --port: 8080
    // --host: 127.0.0.1
    const args = ["-m", modelPath, "--port", "8080", "--host", "127.0.0.1"];

    serverProcess = spawn(binaryPath, args, {
      cwd: getWhisperWorkingDirectory(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let startupError = "";
    let resolved = false;

    if (!serverProcess.stdout || !serverProcess.stderr) {
      reject(new Error("Failed to attach to server stdio streams"));
      return;
    }

    function tryResolve() {
      if (resolved) return;
      resolved = true;
      clearInterval(checkInterval);
      clearTimeout(startupTimeout);
      activeModel = modelPath;
      log.info("Whisper server is ready to accept requests");
      resolve();
    }

    // whisper.cpp server logs everything to stderr, including the
    // "listening on ..." message. Check both streams.
    function handleOutput(text: string) {
      const lower = text.toLowerCase();
      if (lower.includes("listen") || lower.includes("http server") || lower.includes("all slots are idle")) {
        tryResolve();
      }
    }

    serverProcess.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      log.info(`[stdout] ${text.trim()}`);
      handleOutput(text);
    });

    serverProcess.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      startupError += text;
      log.info(`[stderr] ${text.trim()}`);
      handleOutput(text);
    });

    serverProcess.on("error", (error) => {
      log.error("Failed to spawn whisper-server", error);
      serverProcess = null;
      activeModel = "";
      if (!resolved) reject(error);
    });

    serverProcess.on("close", (code) => {
      log.info(`whisper-server exited with code ${code}`);
      serverProcess = null;
      activeModel = "";
      if (!resolved) {
        reject(new Error(`Server exited prematurely (code ${code}): ${startupError}`));
      }
    });

    // Also poll the HTTP endpoint as a fallback
    const checkInterval = setInterval(async () => {
      if (await checkHealth()) {
        tryResolve();
      }
    }, 500);

    // Give it up to 120 seconds to start up
    const startupTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(checkInterval);
        if (serverProcess) {
          serverProcess.kill();
          serverProcess = null;
          activeModel = "";
        }
        reject(new Error(`Whisper server failed to start within 120 seconds.`));
      }
    }, 120000);
  });
}

export async function stopServer(): Promise<void> {
  if (!serverProcess) {
    return;
  }

  log.info("Stopping persistent Whisper server...");
  
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    serverProcess.on("close", () => {
      serverProcess = null;
      activeModel = "";
      resolve();
    });

    serverProcess.kill();
  });
}

export function getWhisperServerStatus() {
  return {
    healthy: Boolean(serverProcess),
    activeModel,
    isStarting,
  };
}

async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${WHISPER_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    // Fall back to just trying the root
    try {
      const response = await fetch(WHISPER_SERVER_URL, {
        signal: AbortSignal.timeout(1000),
      });
      return response.ok || response.status === 404; // 404 means server is up
    } catch {
      return false;
    }
  }
}
