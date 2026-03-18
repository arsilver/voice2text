import crypto from "node:crypto";

import electron from "electron";
import electronMain from "electron/main";

import { getDb, closeDb } from "@main/db/database";
import { applyStabilityResetMigration, applyWidgetRestoreMigration, getSettings } from "@main/db/settings";
import { configureHotkeyRegistration, registerHotkeys, unregisterHotkeys } from "@main/hotkeys";
import { registerIpcHandlers } from "@main/ipc-handlers";
import { setRecordingState } from "@main/recording";
import { STARTUP_HEARTBEAT_TIMEOUT_MS, createStartupGate, resolveDeferredStartupServices } from "@main/startup";
import { createTray, rebuildTrayMenu } from "@main/tray";
import { stopServer } from "@main/transcribe/whisper-server";
import { getCurrentLogFilePath, getLogger } from "@main/utils/logger";
import { getStartupRuntimeFlags } from "@main/utils/runtime-flags";
import { configureAppPaths } from "@main/utils/paths";
import { createMainWindow, getMainWindow, setWidgetVisibility, setWindowDiagnosticsContext, showMainWindow } from "@main/windows";
import { hasTray } from "@main/tray";
import type { StartupStage } from "@shared/types";

const log = getLogger("bootstrap");
const { crashReporter } = electron;
const { app } = electronMain;
const launchId = crypto.randomUUID();
const startupFlags = getStartupRuntimeFlags();
const startupGate = createStartupGate(startupFlags);
let startupExtrasActivated = false;
let startupHeartbeatTimer: NodeJS.Timeout | null = null;
const appPaths = configureAppPaths();
setWindowDiagnosticsContext({
  launchId,
  startupProfile: startupFlags.profile,
});
if (startupFlags.disableGpu) {
  app.disableHardwareAcceleration();
}
startCrashReporter();
registerProcessDiagnostics();

const gotLock = app.requestSingleInstanceLock();
log.info("Configured app paths", {
  launchId,
  ...appPaths,
});
log.info("Startup runtime flags", {
  launchId,
  ...startupFlags,
});
log.info(`Single instance lock acquired=${gotLock}`, {
  launchId,
  startupProfile: startupFlags.profile,
});

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void revealPrimaryInstance();
  });

  app.on("activate", () => {
    void revealPrimaryInstance();
  });

  void bootstrap().catch((error) => {
    log.error("CraftVoice bootstrap failed", error);
    app.exit(1);
  });
}

async function bootstrap() {
  await app.whenReady();

  getDb();
  applyStabilityResetMigration();
  applyWidgetRestoreMigration();

  configureHotkeyRegistration({
    enabled: false,
    reason: startupFlags.disableHotkeys
      ? "Hotkeys are disabled for this launch."
      : "Hotkeys activate after the UI heartbeat completes.",
  });
  registerIpcHandlers({
    getStartupProfile: () => startupFlags.profile,
    reportStartupHeartbeat: handleStartupHeartbeat,
  });
  setRecordingState("idle");

  const mainWindow = await createMainWindow();
  armStartupHeartbeatTimeout();
  showMainWindow();
  mainWindow.on("close", (event: Electron.Event) => {
    if (!app.isQuitting && hasTray()) {
      event.preventDefault();
      mainWindow.hide();
      log.info("Main window close redirected to tray", {
        launchId,
        startupProfile: startupFlags.profile,
      });
    }
  });

  log.info("CraftVoice ready", {
    launchId,
    logFile: getCurrentLogFilePath(),
    startupProfile: startupFlags.profile,
  });
}

async function revealPrimaryInstance() {
  await app.whenReady();

  if (!getMainWindow()) {
    await createMainWindow();
  }

  showMainWindow();
}

app.on("before-quit", () => {
  app.isQuitting = true;
  unregisterHotkeys();
  void stopServer();
  closeDb();
});

function registerProcessDiagnostics() {
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception", {
      launchId,
      startupProfile: startupFlags.profile,
    }, error);
  });

  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection", {
      launchId,
      startupProfile: startupFlags.profile,
    }, reason);
  });

  app.on("child-process-gone", (_event, details) => {
    log.warn("Child process exited unexpectedly", {
      launchId,
      startupProfile: startupFlags.profile,
      ...details,
    });
  });
}

function startCrashReporter() {
  crashReporter.start({
    companyName: "CraftVoice",
    compress: true,
    productName: "CraftVoice",
    submitURL: "https://example.invalid/crash",
    uploadToServer: false,
  });
}

function armStartupHeartbeatTimeout() {
  clearStartupHeartbeatTimeout();
  startupHeartbeatTimer = setTimeout(() => {
    const update = startupGate.markTimedOut();

    if (!update.changed) {
      return;
    }

    if (!startupFlags.disableHotkeys) {
      configureHotkeyRegistration({
        enabled: false,
        reason: "Startup heartbeat timed out. Hotkeys stay disabled for this launch.",
      });
    }

    log.warn("startup-heartbeat-timeout", {
      launchId,
      startupProfile: startupFlags.profile,
      ...update.snapshot,
    });
  }, STARTUP_HEARTBEAT_TIMEOUT_MS);
}

function clearStartupHeartbeatTimeout() {
  if (!startupHeartbeatTimer) {
    return;
  }

  clearTimeout(startupHeartbeatTimer);
  startupHeartbeatTimer = null;
}

function handleStartupHeartbeat(stage: StartupStage) {
  const update = startupGate.reportStage(stage);

  if (!update.changed) {
    return;
  }

  const snapshot = update.snapshot;
  log.info("startup-heartbeat", {
    launchId,
    stage,
    startupProfile: startupFlags.profile,
    ...snapshot,
  });

  if (!snapshot.healthy || startupExtrasActivated) {
    return;
  }

  clearStartupHeartbeatTimeout();
  activateDeferredStartupServices(snapshot);
}

function activateDeferredStartupServices(snapshot: ReturnType<typeof startupGate.getSnapshot>) {
  startupExtrasActivated = true;
  const settings = getSettings();
  const deferred = resolveDeferredStartupServices(startupFlags, snapshot, settings);

  if (deferred.enableTray) {
    createTray();
  }

  if (deferred.enableHotkeys) {
    configureHotkeyRegistration({ enabled: true });
    registerHotkeys();
  }

  setWidgetVisibility(deferred.showWidget);
  if (hasTray()) {
    rebuildTrayMenu();
  }

  log.info("Activated deferred startup services", {
    launchId,
    startupProfile: startupFlags.profile,
    showWidget: deferred.showWidget,
    ...snapshot,
  });
}

declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean;
    }
  }
}
