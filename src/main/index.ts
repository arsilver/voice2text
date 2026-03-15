import electronMain from "electron/main";

import { getDb, closeDb } from "@main/db/database";
import { getSettings } from "@main/db/settings";
import { unregisterHotkeys, registerHotkeys } from "@main/hotkeys";
import { registerIpcHandlers } from "@main/ipc-handlers";
import { ensureManagedWhisperAssets } from "@main/local-models";
import { setRecordingState } from "@main/recording";
import { closeAllSessions, startSessionCleanup } from "@main/transcribe/session-manager";
import { createTray } from "@main/tray";
import { stopServer } from "@main/transcribe/whisper-server";
import { getLogger } from "@main/utils/logger";
import { configureAppPaths } from "@main/utils/paths";
import { createMainWindow, createWidgetWindow, getMainWindow, getWidgetWindow, showMainWindow, setWidgetVisibility } from "@main/windows";

const log = getLogger("bootstrap");
const { app } = electronMain;
const appPaths = configureAppPaths();

const gotLock = app.requestSingleInstanceLock();
log.info("Configured app paths", appPaths);
log.info(`Single instance lock acquired=${gotLock}`);

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

  ensureManagedWhisperAssets();
  getDb();
  const settings = getSettings();

  registerIpcHandlers();
  registerHotkeys();
  createTray();
  setRecordingState("idle");
  startSessionCleanup();

  const mainWindow = await createMainWindow();
  showMainWindow();
  void createWidgetWindow().then(() => setWidgetVisibility(settings.showFloatingWidget));
  mainWindow.on("close", (event: Electron.Event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  log.info("CraftVoice ready");
}

async function revealPrimaryInstance() {
  await app.whenReady();

  if (!getMainWindow()) {
    await createMainWindow();
  }

  if (!getWidgetWindow()) {
    await createWidgetWindow();
    setWidgetVisibility(getSettings().showFloatingWidget);
  }

  showMainWindow();
}

app.on("before-quit", () => {
  app.isQuitting = true;
  unregisterHotkeys();
  closeAllSessions();
  void stopServer();
  closeDb();
});

declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean;
    }
  }
}
