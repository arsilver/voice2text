import electronMain from "electron/main";

import { createAppIcon } from "@main/utils/icon";
import { getWidgetWindow, setWidgetVisibility, showMainWindow } from "@main/windows";
import { getSettings, saveSettings } from "@main/db/settings";
import { toggleRecording } from "@main/hotkeys";

let tray: Electron.Tray | null = null;
const { Menu, Tray, app } = electronMain;

export function createTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(createAppIcon().resize({ width: 16, height: 16 }));
  tray.setToolTip("CraftVoice");
  rebuildTrayMenu();
  tray.on("double-click", () => showMainWindow());

  return tray;
}

/** Rebuild the tray context menu (call after widget visibility changes). */
export function rebuildTrayMenu() {
  if (!tray) {
    return;
  }

  const widgetVisible = getWidgetWindow()?.isVisible() ?? false;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open CraftVoice", click: () => showMainWindow() },
      { label: "Toggle Recording", click: () => void toggleRecording("tray") },
      { type: "separator" },
      {
        label: widgetVisible ? "Hide Widget" : "Show Widget",
        click: () => {
          const next = !widgetVisible;
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
