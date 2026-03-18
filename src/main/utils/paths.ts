import electronMain from "electron/main";
import fs from "node:fs";
import path from "node:path";

const { app } = electronMain;

function getProjectRoot() {
  return path.resolve(import.meta.dirname, "..", "..");
}

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : getProjectRoot();
}

function getBundledResourcesRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "resources") : path.join(getProjectRoot(), "resources");
}

export function getManagedResourcesRoot() {
  return ensureDirectory(path.join(getUserDataDir(), "resources"));
}

export function ensureDirectory(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function getUserDataDir() {
  return ensureDirectory(app.getPath("userData"));
}

export function getSessionDataDir() {
  return ensureDirectory(path.join(getUserDataDir(), "session-data"));
}

export function getDiagnosticsDir() {
  return getUserDataDir();
}

export function getCrashDumpsDir() {
  return ensureDirectory(path.join(getDiagnosticsDir(), "crash-dumps"));
}

export function configureAppPaths() {
  const userDataDir = getUserDataDir();
  const sessionDataDir = getSessionDataDir();
  const crashDumpsDir = getCrashDumpsDir();

  app.setPath("sessionData", sessionDataDir);
  app.setPath("crashDumps", crashDumpsDir);

  return {
    crashDumpsDir,
    userDataDir,
    sessionDataDir,
  };
}

export function getTempDir() {
  return ensureDirectory(path.join(getUserDataDir(), "tmp"));
}

export function getLogsDir() {
  return ensureDirectory(path.join(getUserDataDir(), "logs"));
}

export function getDatabasePath() {
  return path.join(getUserDataDir(), "craftvoice.db");
}

export function getRendererHtmlPath(fileName: "index.html" | "widget.html") {
  return path.join(getAppRoot(), "dist", "renderer", fileName);
}

export function getPreloadPath() {
  return path.join(getAppRoot(), "dist", "preload", "index.cjs");
}

export function getWhisperExecutablePath() {
  return path.join(getManagedResourcesRoot(), "whisper", "Release", "whisper-cli.exe");
}

export function getWhisperWorkingDirectory() {
  return path.dirname(getWhisperExecutablePath());
}

export function getWhisperModelsDir() {
  return ensureDirectory(path.join(getManagedResourcesRoot(), "models"));
}

export function getWhisperModelPath(modelName: string) {
  return path.join(getWhisperModelsDir(), modelName);
}

export function getBundledWhisperExecutablePath() {
  return path.join(getBundledResourcesRoot(), "whisper", "Release", "whisper-cli.exe");
}

export function getBundledWhisperWorkingDirectory() {
  return path.dirname(getBundledWhisperExecutablePath());
}

export function getBundledWhisperModelsDir() {
  return path.join(getBundledResourcesRoot(), "models");
}

export function getBundledWhisperModelPath(modelName: string) {
  return path.join(getBundledWhisperModelsDir(), modelName);
}
