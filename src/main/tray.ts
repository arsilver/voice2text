import electronMain from "electron/main";

import { createAppIcon } from "@main/utils/icon";
import { setWidgetVisibility, showMainWindow } from "@main/windows";
import { getSettings, saveSettings } from "@main/db/settings";
import { toggleRecording } from "@main/hotkeys";
import { getLogger } from "@main/utils/logger";

let tray: Electron.Tray | null = null;
const log = getLogger("tray");
const { Menu, Tray, app } = electronMain;

export function createTray() {
  if (tray) {
    return tray;
  }

  log.info("Creating tray");
  tray = new Tray(createAppIcon().resize({ width: 16, height: 16 }));
  tray.setToolTip("CraftVoice");
  rebuildTrayMenu();
  tray.on("double-click", () => showMainWindow());

  return tray;
}

export function hasTray() {
  return tray !== null;
}

/** Rebuild the tray context menu (call after widget visibility changes). */
export function rebuildTrayMenu() {
  if (!tray) {
    return;
  }

  const widgetEnabled = getSettings().showFloatingWidget;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open CraftVoice", click: () => showMainWindow() },
      { label: "Toggle Recording", click: () => void toggleRecording("tray") },
      { type: "separator" },
      {
        label: widgetEnabled ? "Hide Widget" : "Show Widget",
        click: () => {
          const next = !widgetEnabled;
          setWidgetVisibility(next);
          saveSettings({ showFloatingWidget: next });
          rebuildTrayMenu(); // refresh label
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
}
